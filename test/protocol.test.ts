import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BUTTON_CONTROL_IDS, ENCODER_CONTROL_IDS, LC11Parser, type LC11Event } from '../src/protocol.js'

/**
 * test/fixtures/lc11-capture.txt is a capture from a real LC-11. Before each action the operator typed a
 * label (the `### LABEL:` lines); every message that follows is what the panel sent for that action.
 */
interface Section {
	label: string
	messages: string[]
}

function loadCapture(): Section[] {
	const sections: Section[] = []
	let current: Section | undefined
	for (const line of readFileSync(new URL('./fixtures/lc11-capture.txt', import.meta.url), 'utf8').split('\n')) {
		const label = /^### LABEL: (.*)$/.exec(line)
		if (label) {
			current = { label: label[1].trim(), messages: [] }
			sections.push(current)
			continue
		}
		const message = /^\d\d:\d\d:\d\d (.*)$/.exec(line)
		if (message && current) current.messages.push(message[1])
	}
	return sections
}

// The operator's typos, corrected
const TYPOS: Record<string, string> = { 'Effecs 2': 'Effects 2', 'Kive 4': 'Live 4', 'TXT Turn LEft': 'TXT Turn Left' }
const COLUMN: Record<string, string> = {
	'1': '1', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6',
	EXT: 'ext', 'DDR 1': 'ddr1', 'DDR 2': 'ddr2', TXT: 'txt', BKG: 'bkg',
}
const FIXED: Record<string, string> = {
	AUTO: 'auto', Take: 'take', Fade: 'fade', FX: 'fx', FTB: 'ftb', Alt: 'alt',
	'Fade All': 'fade-all', 'Take All': 'take-all', 'Fade Overlay': 'fade-overlay', 'Take Overlay': 'take-overlay',
	'Speed Press': 'speed-knob', 'FX Press': 'fx-knob', 'DDR1 Press': 'ddr1-knob', 'DDR2 Press': 'ddr2-knob', 'TXT Press': 'txt-knob',
	// After the knob tests the operator labelled the Overlay section's source buttons without a prefix
	EXT: 'overlay-ext', 'DDR 1': 'overlay-ddr1', 'DDR 2': 'overlay-ddr2', TXT: 'overlay-txt',
}

type Expectation =
	| { kind: 'button'; id: string }
	| { kind: 'knob'; id: string; sign: 1 | -1 }
	| { kind: 'joystick'; stick: 'a' | 'b' }
	| { kind: 'tbar' }

function expectationFor(rawLabel: string): Expectation | null {
	const label = TYPOS[rawLabel] ?? rawLabel
	let m: RegExpExecArray | null
	if ((m = /^(Effects|Live|Preview) (.+)$/.exec(label))) return { kind: 'button', id: `${m[1].toLowerCase()}-${COLUMN[m[2]]}` }
	if ((m = /^(Speed|FX|DDR1|DDR2|TXT) Turn (Left|Right)$/.exec(label)))
		return { kind: 'knob', id: `${m[1].toLowerCase()}-knob`, sign: m[2] === 'Left' ? -1 : 1 }
	if (label === 'Joystick A') return { kind: 'joystick', stick: 'a' }
	if (label === 'Joystick B') return { kind: 'joystick', stick: 'b' }
	if (label === 'T-Bar down' || label === 'T-Bar Up') return { kind: 'tbar' }
	if (label in FIXED) return { kind: 'button', id: FIXED[label] }
	return null
}

function run(sections: Section[]): Array<{ section: Section; exp: Expectation; events: LC11Event[] }> {
	const results: Array<{ section: Section; exp: Expectation; events: LC11Event[] }> = []
	let events: LC11Event[] = []
	const parser = new LC11Parser((e) => events.push(e))
	for (const section of sections) {
		if (section.label === 'idle' || section.messages.length === 0) continue
		events = []
		for (const m of section.messages) parser.feed(`${m}\r`)
		const exp = expectationFor(section.label)
		if (!exp) throw new Error(`No expectation for label "${section.label}"`)
		results.push({ section, exp, events })
	}
	return results
}

const results = run(loadCapture())

describe('LC-11 parser against a labelled capture from real hardware', () => {
	it('recognises every labelled action', () => {
		expect(results.length).toBeGreaterThan(60)
	})

	it('reports each button as exactly one press then one release, and nothing else', () => {
		const buttons = results.filter((r) => r.exp.kind === 'button')
		expect(buttons.length).toBeGreaterThan(50)
		for (const { section, exp, events } of buttons) {
			const id = (exp as { id: string }).id
			expect(events, section.label).toEqual([
				{ type: 'button', controlId: id, pressed: true },
				{ type: 'button', controlId: id, pressed: false },
			])
		}
	})

	it('covers all 52 buttons the parser can report', () => {
		const seen = new Set(results.filter((r) => r.exp.kind === 'button').map((r) => (r.exp as { id: string }).id))
		expect([...seen].sort()).toEqual([...BUTTON_CONTROL_IDS].sort())
		expect(seen.size).toBe(52)
	})

	it.each(ENCODER_CONTROL_IDS.flatMap((id) => [[id, 'Left'], [id, 'Right']] as const))(
		'turns %s %s in the right direction',
		(id, side) => {
			const sign = side === 'Left' ? -1 : 1
			const r = results.find((x) => x.exp.kind === 'knob' && x.exp.id === id && x.exp.sign === sign)
			expect(r, `no capture for ${id} ${side}`).toBeDefined()
			const steps = r!.events.filter((e): e is Extract<LC11Event, { type: 'rotate' }> => e.type === 'rotate')
			expect(steps.length).toBe(r!.events.length) // nothing but rotation
			expect(steps.every((e) => e.controlId === id)).toBe(true)
			const net = steps.reduce((sum, e) => sum + e.delta, 0)
			expect(Math.sign(net)).toBe(sign)
			// Mechanical encoders jitter: tolerate a few single-tick reversals, but the net must be clear
			const reversed = steps.filter((e) => Math.sign(e.delta) !== sign).length
			expect(reversed).toBeLessThanOrEqual(steps.length * 0.1)
			expect(Math.abs(net)).toBeGreaterThan(steps.length * 0.8)
		},
	)

	it('reports the T-bar across its whole range', () => {
		const down = results.find((r) => r.section.label === 'T-Bar down')!.events
		const up = results.find((r) => r.section.label === 'T-Bar Up')!.events
		for (const events of [down, up]) {
			expect(events.every((e) => e.type === 'tbar')).toBe(true)
		}
		const values = (events: LC11Event[]) => events.map((e) => (e as { value: number }).value)
		expect(values(down).at(-1)).toBe(255)
		expect(values(up).at(-1)).toBe(0)
		expect(Math.min(...values(down))).toBeLessThan(10)
	})

	it('reports both joysticks as X/Y pairs', () => {
		for (const stick of ['a', 'b'] as const) {
			const r = results.find((x) => x.exp.kind === 'joystick' && x.exp.stick === stick)!
			expect(r.events.length).toBeGreaterThan(100)
			for (const e of r.events) {
				expect(e).toMatchObject({ type: 'joystick', stick })
			}
		}
	})
})

describe('LC-11 parser robustness', () => {
	function collect(feed: (p: LC11Parser) => void): LC11Event[] {
		const out: LC11Event[] = []
		feed(new LC11Parser((e) => out.push(e)))
		return out
	}

	it('handles messages split across serial reads at any byte boundary', () => {
		const stream = '~F7F\rF\r~FFF\rF\r^F77\r^FF7\r~4A5\r'
		const whole = collect((p) => p.feed(stream))
		for (let cut = 1; cut < stream.length; cut++) {
			const split = collect((p) => {
				p.feed(stream.slice(0, cut))
				p.feed(stream.slice(cut))
			})
			expect(split, `cut at ${cut}`).toEqual(whole)
		}
		expect(whole).toEqual([
			{ type: 'button', controlId: 'effects-1', pressed: true },
			{ type: 'button', controlId: 'effects-1', pressed: false },
			{ type: 'button', controlId: 'fade', pressed: true },
			{ type: 'button', controlId: 'fade', pressed: false },
			{ type: 'tbar', value: 0xa5 },
		])
	})

	it('ignores garbage and recovers on the next valid message', () => {
		const out = collect((p) => {
			p.feed('\x00\xff???\r')
			p.feed('~3ZZ\r')
			p.feed('x'.repeat(200))
			p.feed('\r~3F7\r~3FF\r')
		})
		expect(out).toEqual([
			{ type: 'button', controlId: 'auto', pressed: true },
			{ type: 'button', controlId: 'auto', pressed: false },
		])
	})

	it('does not report a button held when the panel is first read', () => {
		// The first row message after connecting with a button already down reports a press, not a missed one
		const out = collect((p) => p.feed('~27F\rF\r'))
		expect(out).toEqual([{ type: 'button', controlId: 'live-1', pressed: true }])
	})

	it('treats the first knob reading as a baseline, then reports signed steps across the 0xFF wrap', () => {
		const out = collect((p) => p.feed('~8FE\r~8FF\r~800\r~801\r~800\r'))
		expect(out).toEqual([
			{ type: 'rotate', controlId: 'speed-knob', delta: 1 },
			{ type: 'rotate', controlId: 'speed-knob', delta: 1 },
			{ type: 'rotate', controlId: 'speed-knob', delta: 1 },
			{ type: 'rotate', controlId: 'speed-knob', delta: -1 },
		])
	})
})
