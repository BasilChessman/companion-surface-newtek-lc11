import { describe, expect, it } from 'vitest'
// The layout validator only exists in newer releases of the base package, so the tests pull it in through a
// dev-only alias (see devDependencies). The module itself is built against the oldest supported base.
import { validateSurfaceLayout } from '@companion-surface/base-latest'
import { BUTTON_CONTROL_IDS, ENCODER_CONTROL_IDS } from '../src/protocol.js'
import { CONTROLS, TRANSFER_VARIABLES, createAppearance, createLayout } from '../src/layout.js'

describe('layout', () => {
	it('is valid according to the Companion layout schema', () => {
		expect(() => validateSurfaceLayout(createLayout())).not.toThrow()
	})

	it('has exactly the controls the parser can report, and no others', () => {
		expect(Object.keys(createLayout().controls).sort()).toEqual([...BUTTON_CONTROL_IDS].sort())
		expect(BUTTON_CONTROL_IDS.length).toBe(52)
		for (const id of ENCODER_CONTROL_IDS) expect(BUTTON_CONTROL_IDS).toContain(id)
	})

	it('puts every control in its own grid cell', () => {
		const cells = CONTROLS.map((c) => `${c.row}/${c.column}`)
		expect(new Set(cells).size).toBe(cells.length)
	})

	it('uses only characters Companion allows in a control id', () => {
		for (const id of Object.keys(createLayout().controls)) expect(id).toMatch(/^[a-zA-Z0-9\-/]+$/)
	})

	it('keeps the grid to 4 rows by 18 columns', () => {
		expect(Math.max(...CONTROLS.map((c) => c.row))).toBe(3)
		expect(Math.max(...CONTROLS.map((c) => c.column))).toBe(17)
	})

	it('lines the right-hand sections up with the rows of the centre and left sections', () => {
		const row = (id: string) => CONTROLS.find((c) => c.id === id)!.row
		// Fade Overlay / Take Overlay are level with AUTO / TAKE and with Fade All / Take All
		for (const id of ['fade-overlay', 'take-overlay', 'fade-all', 'take-all']) expect(row(id)).toBe(row('auto'))
		expect(row('take')).toBe(row('auto'))
		// The overlay source buttons are level with FTB / Alt and the Preview row
		for (const id of ['overlay-ext', 'overlay-ddr1', 'overlay-ddr2', 'overlay-txt', 'ftb', 'alt']) expect(row(id)).toBe(row('preview-1'))
		// The overlay knobs are level with the Speed / FX knobs and the Live row
		for (const id of ['ddr1-knob', 'ddr2-knob', 'txt-knob', 'fx-knob']) expect(row(id)).toBe(row('speed-knob'))
		expect(row('speed-knob')).toBe(row('live-1'))
	})

	it('declares the five analog values as input variables, plus the optional calibration pair', () => {
		const analog = TRANSFER_VARIABLES.slice(0, 5)
		expect(analog.map((v) => v.id)).toEqual(['tbar', 'joystick-a-x', 'joystick-a-y', 'joystick-b-x', 'joystick-b-y'])
		expect(analog.every((v) => v.type === 'input')).toBe(true)
		expect(TRANSFER_VARIABLES.slice(5).map((v) => [v.id, v.type])).toEqual([
			['joystick-calibration', 'input'],
			['joystick-calibration-saved', 'output'],
		])
	})

	it('has a drawn face covering every control (kept for a future API release)', () => {
		const face = createAppearance()
		expect(Object.keys(face.controls).sort()).toEqual(Object.keys(createLayout().controls).sort())
		for (const c of Object.values(face.controls)) {
			expect(c.x).toBeGreaterThanOrEqual(0)
			expect(c.x + c.width).toBeLessThanOrEqual(face.size.width)
			expect(c.y + c.height).toBeLessThanOrEqual(face.size.height)
		}
	})
})
