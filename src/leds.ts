import { ROW_COLUMNS } from './protocol.js'

/**
 * NewTek LC-11 LED commands (host -> panel direction).
 *
 * Found by probing a real panel (see tools/lc11_probe_phase*.py). Every command is one ASCII line,
 * CR terminated: a prefix (`~` or `^`), an id character, then hex digits. The ids and bit positions are
 * the same as the panel's own button messages, and the logic is ACTIVE-LOW like the buttons: a 0 bit
 * lights the LED, a 1 bit turns it off.
 *
 *   ~F fff   Effects row  \
 *   ~2 fff   Live row      > 3 hex digits (12 bits); bit 11 = button 1 ... bit 1 = BKG, bit 0 unused
 *   ~1 fff   Preview row  /
 *   ~3 ff    bit7 Fade Overlay, 6 Take Overlay, 5 Fade All, 4 Take All,
 *            bit2 T-bar "down" LED, bit0 T-bar "up" LED        (bits 3 and 1, AUTO and TAKE, have no LED)
 *            (the T-bar LEDs light at the ends of the T-bar's travel; see analog.ts)
 *   ^F ff    bit7 Fade, bit6 FX
 *   ^1 ff    bit7 FTB, 6 Alt, 5 Overlay EXT, 4 Overlay DDR 1, 3 Overlay DDR 2, 2 Overlay TXT
 *
 * Two hex digits are enough for the 8-bit groups. The LEDs are single-colour on/off: there is no
 * brightness or colour, and the panel keeps each LED's state until it is changed or the panel is
 * unplugged.
 */

/** The two LEDs by the T-bar. They are not buttons, so they have no control id in the layout. */
export const TBAR_DOWN_LED = 'tbar-down-led'
export const TBAR_UP_LED = 'tbar-up-led'

interface LedGroup {
	/** Message prefix and id, eg `~F` */
	readonly head: string
	/** Hex digits in the value */
	readonly digits: 2 | 3
	/** Bit number for each control id that has an LED in this group */
	readonly bits: Readonly<Record<string, number>>
}

const rowGroup = (id: string, row: string): LedGroup => ({
	head: `~${id}`,
	digits: 3,
	bits: Object.fromEntries(ROW_COLUMNS.map((col, i) => [`${row}-${col}`, 11 - i])),
})

export const LED_GROUPS: readonly LedGroup[] = [
	rowGroup('F', 'effects'),
	rowGroup('2', 'live'),
	rowGroup('1', 'preview'),
	{
		head: '~3',
		digits: 2,
		bits: { 'fade-overlay': 7, 'take-overlay': 6, 'fade-all': 5, 'take-all': 4, [TBAR_DOWN_LED]: 2, [TBAR_UP_LED]: 0 },
	},
	{ head: '^F', digits: 2, bits: { fade: 7, fx: 6 } },
	{ head: '^1', digits: 2, bits: { ftb: 7, alt: 6, 'overlay-ext': 5, 'overlay-ddr1': 4, 'overlay-ddr2': 3, 'overlay-txt': 2 } },
]

/** Control ids of the buttons that have an LED (the T-bar LEDs are driven separately, from the T-bar position). */
export const LED_CONTROL_IDS: readonly string[] = LED_GROUPS.flatMap((g) => Object.keys(g.bits)).filter(
	(id) => id !== TBAR_DOWN_LED && id !== TBAR_UP_LED,
)

/**
 * Whether a Companion background colour should light the LED. The LEDs are on/off only, so any
 * visible colour means on and black (an unused button) means off.
 */
export function colorIsLit(color: string): boolean {
	const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color.trim())
	if (!m) return false
	return Math.max(parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)) >= 0x30
}

/** Tracks which LEDs are lit and produces the command lines that change them. */
export class LedState {
	readonly #lit = new Set<string>()
	readonly #groupOf = new Map<string, LedGroup>()
	readonly #dirty = new Set<LedGroup>()

	constructor() {
		for (const group of LED_GROUPS) for (const id of Object.keys(group.bits)) this.#groupOf.set(id, group)
	}

	/** True if the control has an LED. */
	has(controlId: string): boolean {
		return this.#groupOf.has(controlId)
	}

	/** Set one LED. Returns true if that changed anything. */
	set(controlId: string, lit: boolean): boolean {
		const group = this.#groupOf.get(controlId)
		if (!group || this.#lit.has(controlId) === lit) return false
		if (lit) this.#lit.add(controlId)
		else this.#lit.delete(controlId)
		this.#dirty.add(group)
		return true
	}

	/** Turn every LED off in the state (use `allOff()` for the commands that do it on the panel). */
	clear(): void {
		this.#lit.clear()
		for (const group of LED_GROUPS) this.#dirty.add(group)
	}

	static #line(group: LedGroup, lit: ReadonlySet<string>): string {
		let value = group.digits === 3 ? 0xfff : 0xff
		for (const [id, bit] of Object.entries(group.bits)) if (lit.has(id)) value &= ~(1 << bit)
		return `${group.head}${value.toString(16).toUpperCase().padStart(group.digits, '0')}\r`
	}

	/** The command lines for every group changed since the last call, then forgets them. */
	takeChanges(): string[] {
		const lines = [...this.#dirty].map((g) => LedState.#line(g, this.#lit))
		this.#dirty.clear()
		return lines
	}

	/** Command lines that put every LED of the panel into its current state (used on connect). */
	allGroups(): string[] {
		this.#dirty.clear()
		return LED_GROUPS.map((g) => LedState.#line(g, this.#lit))
	}
}
