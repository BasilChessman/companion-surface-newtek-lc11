import { describe, expect, it } from 'vitest'
import { LED_CONTROL_IDS, LedState, TBAR_DOWN_LED, TBAR_UP_LED, colorIsLit } from '../src/leds.js'
import { BUTTON_CONTROL_IDS } from '../src/protocol.js'

/**
 * The expected command for each single lit LED is exactly what was sent to a real LC-11 in the
 * phase 2 probe (tools/lc11_probe_phase2.py), and confirmed by eye to light that LED alone.
 */
const CONFIRMED_ON_HARDWARE: Array<[controlId: string, line: string]> = [
	['effects-1', '~F7FF'],
	['effects-2', '~FBFF'],
	['effects-bkg', '~FFFD'],
	['live-1', '~27FF'],
	['live-ext', '~2FDF'],
	['live-bkg', '~2FFD'],
	['preview-1', '~17FF'],
	['preview-ddr2', '~1FF7'],
	['preview-bkg', '~1FFD'],
	['fade-overlay', '~37F'],
	['take-overlay', '~3BF'],
	['fade-all', '~3DF'],
	['take-all', '~3EF'],
	['fade', '^F7F'],
	['fx', '^FBF'],
	['ftb', '^17F'],
	['alt', '^1BF'],
	['overlay-ext', '^1DF'],
	['overlay-ddr1', '^1EF'],
	['overlay-ddr2', '^1F7'],
	['overlay-txt', '^1FB'],
]

describe('LC-11 LED commands', () => {
	it.each(CONFIRMED_ON_HARDWARE)('lighting %s sends %s', (controlId, line) => {
		const leds = new LedState()
		leds.allGroups()
		expect(leds.set(controlId, true)).toBe(true)
		expect(leds.takeChanges()).toEqual([`${line}\r`])
	})

	it('drives the two T-bar LEDs (confirmed on hardware: bit 2 = T-Bar Down, bit 0 = T-Bar Up)', () => {
		const leds = new LedState()
		leds.set(TBAR_DOWN_LED, true)
		expect(leds.takeChanges()).toEqual(['~3FB\r'])
		leds.set(TBAR_DOWN_LED, false)
		leds.set(TBAR_UP_LED, true)
		expect(leds.takeChanges()).toEqual(['~3FE\r'])
		leds.set(TBAR_DOWN_LED, true)
		expect(leds.takeChanges()).toEqual(['~3FA\r'])
		expect(LED_CONTROL_IDS).not.toContain(TBAR_UP_LED) // not a button, so not in the layout
	})

	it('turns an LED off again by setting its bit back to 1', () => {
		const leds = new LedState()
		leds.set('live-3', true)
		expect(leds.takeChanges()).toEqual(['~2DFF\r'])
		leds.set('live-3', false)
		expect(leds.takeChanges()).toEqual(['~2FFF\r'])
	})

	it('combines several LEDs of one group into one command', () => {
		const leds = new LedState()
		leds.set('effects-1', true)
		leds.set('effects-bkg', true)
		leds.set('live-2', true)
		expect(leds.takeChanges().sort()).toEqual(['~2BFF\r', '~F7FD\r'].sort())
	})

	it('only sends groups that changed, and nothing when nothing changed', () => {
		const leds = new LedState()
		leds.set('fade', true)
		expect(leds.takeChanges()).toEqual(['^F7F\r'])
		expect(leds.takeChanges()).toEqual([])
		expect(leds.set('fade', true)).toBe(false) // already lit
		expect(leds.takeChanges()).toEqual([])
	})

	it('starts from every LED off, writing every group', () => {
		expect(new LedState().allGroups()).toEqual(['~FFFF\r', '~2FFF\r', '~1FFF\r', '~3FF\r', '^FFF\r', '^1FF\r'])
	})

	it('never lights the unused row bit or the T-bar bits, even with everything on', () => {
		const leds = new LedState()
		for (const id of LED_CONTROL_IDS) leds.set(id, true)
		// Rows: bit 0 is unused and stays 1. ~3: bits 3..0 (AUTO, T-bar down, TAKE, T-bar up) stay 1.
		expect(leds.takeChanges().sort()).toEqual(['^103\r', '^F3F\r', '~1001\r', '~2001\r', '~30F\r', '~F001\r'])
	})

	it('ignores controls without an LED', () => {
		const leds = new LedState()
		for (const id of ['auto', 'take', 'speed-knob', 'fx-knob', 'ddr1-knob', 'nonsense']) {
			expect(leds.has(id)).toBe(false)
			expect(leds.set(id, true)).toBe(false)
		}
		expect(leds.takeChanges()).toEqual([])
	})

	it('covers every button except AUTO, TAKE and the knob presses', () => {
		const expected = BUTTON_CONTROL_IDS.filter((id) => !['auto', 'take'].includes(id) && !id.endsWith('-knob'))
		expect([...LED_CONTROL_IDS].sort()).toEqual([...expected].sort())
		expect(LED_CONTROL_IDS.length).toBe(45)
	})

	it('decides on/off from the colour', () => {
		expect(colorIsLit('#000000')).toBe(false)
		expect(colorIsLit('#ff0000')).toBe(true)
		expect(colorIsLit('#00ff00')).toBe(true)
		expect(colorIsLit('#202020')).toBe(false) // near black
		expect(colorIsLit('#404040')).toBe(true)
		expect(colorIsLit('ffffff')).toBe(true)
		expect(colorIsLit('not a colour')).toBe(false)
	})
})
