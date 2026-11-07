/**
 * NewTek LC-11 serial protocol (panel -> host direction only).
 *
 * Decoded from a labelled capture of a real LC-11: an FTDI FT232 serial port
 * (USB 0403:6001), 9600 baud, 8N1. Every message is ASCII and CR (0x0D)
 * terminated. A message starts with `~` or `^`, then an id character, then hex
 * data. Buttons are ACTIVE-LOW: a bit reads 0 while the button is held.
 *
 *   ~F nn CR n   Effects row     12-bit value; bit 11 = button 1 ... bit 1 = BKG
 *   ~2 nn CR n   Live row        column order: 1 2 3 4 5 6 EXT DDR1 DDR2 TXT BKG
 *   ~1 nn CR n   Preview row     (the 3rd nibble arrives as its own CR line)
 *   ~3 nn        bit7 Fade Overlay, 6 Take Overlay, 5 Fade All, 4 Take All, 3 AUTO, 1 TAKE
 *   ~4 hh        T-bar position, 0x00..0xFF
 *   ~5..~9 hh    knob counters (8-bit, wrap): DDR1 DDR2 TXT SPEED FX
 *                (the counter falls when turned left and rises when turned right)
 *   ^F nn        bit7 Fade, bit6 FX
 *   ^2 nn        knob presses: bit7 Speed, 6 FX, 5 DDR1, 4 DDR2, 3 TXT
 *   ^1 nn        bit7 FTB, 6 Alt, 5 Overlay EXT, 4 Overlay DDR1, 3 Overlay DDR2, 2 Overlay TXT
 *   ^5 xxyy      Joystick A (X then Y), 0x00..0xFF, rest is near 0x80
 *   ^7 xxyy      Joystick B
 */

export type LC11Event =
	| { type: 'button'; controlId: string; pressed: boolean }
	| { type: 'rotate'; controlId: string; delta: number }
	| { type: 'tbar'; value: number }
	| { type: 'joystick'; stick: 'a' | 'b'; x: number; y: number }

const ROWS: Record<string, string> = { F: 'effects', '2': 'live', '1': 'preview' }
export const ROW_COLUMNS = ['1', '2', '3', '4', '5', '6', 'ext', 'ddr1', 'ddr2', 'txt', 'bkg'] as const

/** Counter-id character -> knob control id */
const ENCODERS: Record<string, string> = {
	'5': 'ddr1-knob',
	'6': 'ddr2-knob',
	'7': 'txt-knob',
	'8': 'speed-knob',
	'9': 'fx-knob',
}

type BitMap = ReadonlyArray<readonly [bit: number, controlId: string]>

const TRANSPORT: BitMap = [
	[7, 'fade-overlay'],
	[6, 'take-overlay'],
	[5, 'fade-all'],
	[4, 'take-all'],
	[3, 'auto'],
	[1, 'take'],
]
const FADE_FX: BitMap = [
	[7, 'fade'],
	[6, 'fx'],
]
const KNOB_PRESS: BitMap = [
	[7, 'speed-knob'],
	[6, 'fx-knob'],
	[5, 'ddr1-knob'],
	[4, 'ddr2-knob'],
	[3, 'txt-knob'],
]
const OVERLAY_SOURCES: BitMap = [
	[7, 'ftb'],
	[6, 'alt'],
	[5, 'overlay-ext'],
	[4, 'overlay-ddr1'],
	[3, 'overlay-ddr2'],
	[2, 'overlay-txt'],
]

/** Control ids of every button the parser can report: the three source rows plus the groups above. */
export const BUTTON_CONTROL_IDS: readonly string[] = [
	...Object.values(ROWS).flatMap((row) => ROW_COLUMNS.map((col) => `${row}-${col}`)),
	...[TRANSPORT, FADE_FX, KNOB_PRESS, OVERLAY_SOURCES].flatMap((group) => group.map(([, id]) => id)),
]
/** Control ids of the knobs that also report rotation. */
export const ENCODER_CONTROL_IDS: readonly string[] = Object.values(ENCODERS)

const HEX = /^[0-9A-Fa-f]+$/
function hex(s: string): number | undefined {
	return HEX.test(s) ? parseInt(s, 16) : undefined
}

export class LC11Parser {
	#buffer = ''
	#pendingRow: { row: string; n1: number; n2: number } | null = null
	readonly #bits = new Map<string, number>()
	readonly #counters = new Map<string, number>()

	constructor(private readonly emit: (event: LC11Event) => void) {}

	/** Feed raw bytes (or already-decoded text) from the serial port. */
	feed(data: Uint8Array | string): void {
		this.#buffer += typeof data === 'string' ? data : Buffer.from(data).toString('latin1')
		let end: number
		while ((end = this.#buffer.indexOf('\r')) >= 0) {
			const token = this.#buffer.slice(0, end).trim()
			this.#buffer = this.#buffer.slice(end + 1)
			if (token) this.#token(token)
		}
		// Garbage with no terminator: drop it so the next real message can resynchronise.
		if (this.#buffer.length > 64) this.#buffer = ''
	}

	#token(token: string): void {
		const first = token[0]
		if (first !== '~' && first !== '^') {
			// Not a message start: the 3rd nibble of a row message, or noise.
			const nibble = token.length === 1 ? hex(token) : undefined
			if (this.#pendingRow && nibble !== undefined) {
				const { row, n1, n2 } = this.#pendingRow
				this.#pendingRow = null
				const bits: BitMap = ROW_COLUMNS.map((col, i) => [11 - i, `${row}-${col}`] as const)
				this.#diff(`row-${row}`, (n1 << 8) | (n2 << 4) | nibble, bits, 0xfff)
			}
			return
		}
		this.#pendingRow = null
		const id = token.slice(1, 2)
		const body = token.slice(2)
		const value = hex(body)

		if (first === '~') {
			if (id in ROWS && body.length === 2 && value !== undefined) {
				this.#pendingRow = { row: ROWS[id], n1: hex(body[0]) ?? 0, n2: hex(body[1]) ?? 0 }
			} else if (id === '3' && body.length === 2 && value !== undefined) {
				this.#diff('~3', value, TRANSPORT, 0xff)
			} else if (id === '4' && body.length === 2 && value !== undefined) {
				this.emit({ type: 'tbar', value })
			} else if (id in ENCODERS && body.length === 2 && value !== undefined) {
				this.#encoder(ENCODERS[id], value)
			}
		} else if (id === 'F' && body.length === 2 && value !== undefined) {
			this.#diff('^F', value, FADE_FX, 0xff)
		} else if (id === '2' && body.length === 2 && value !== undefined) {
			this.#diff('^2', value, KNOB_PRESS, 0xff)
		} else if (id === '1' && body.length === 2 && value !== undefined) {
			this.#diff('^1', value, OVERLAY_SOURCES, 0xff)
		} else if ((id === '5' || id === '7') && body.length === 4 && value !== undefined) {
			this.emit({
				type: 'joystick',
				stick: id === '5' ? 'a' : 'b',
				x: parseInt(body.slice(0, 2), 16),
				y: parseInt(body.slice(2), 16),
			})
		}
	}

	#diff(key: string, value: number, bits: BitMap, idle: number): void {
		const previous = this.#bits.get(key) ?? idle
		this.#bits.set(key, value)
		for (const [bit, controlId] of bits) {
			const was = !(previous & (1 << bit))
			const now = !(value & (1 << bit))
			if (was !== now) this.emit({ type: 'button', controlId, pressed: now })
		}
	}

	#encoder(controlId: string, value: number): void {
		const previous = this.#counters.get(controlId)
		this.#counters.set(controlId, value)
		if (previous === undefined) return // the first reading only sets the baseline
		const delta = ((value - previous + 128) & 0xff) - 128
		if (delta !== 0) this.emit({ type: 'rotate', controlId, delta })
	}
}
