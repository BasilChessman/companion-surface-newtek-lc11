import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
	DEFAULT_CALIBRATION,
	formatCalibration,
	parseCalibration,
	END_MARGIN,
	JoystickAxis,
	MIN_USEFUL_TRAVEL,
	MIN_TBAR_TRAVEL,
	TBAR_END_MARGIN,
	TBAR_END_OFF,
	TbarAxis,
	TbarEnds,
} from '../src/analog.js'
import { LC11Parser, type LC11Event } from '../src/protocol.js'

describe('joystick axis calibration', () => {
	const cal = { min: 4, centre: 128, max: 238 } // like Joystick A's X axis in the real capture
	const axis = () => new JoystickAxis(cal)

	it('maps the centre to exactly 128 and the ends to exactly 0 and 255', () => {
		const a = axis()
		expect(a.map(128)).toBe(128)
		expect(a.map(4)).toBe(0)
		expect(a.map(238)).toBe(255)
	})

	it('reaches full scale a little before the very end, and stays there', () => {
		const a = axis()
		expect(a.map(238 - END_MARGIN)).toBe(255)
		expect(a.map(4 + END_MARGIN)).toBe(0)
	})

	it('treats rest-position jitter as exactly centred', () => {
		const a = axis()
		for (const raw of [124, 125, 126, 127, 128, 129, 130, 131, 132]) expect(a.map(raw)).toBe(128)
	})

	it('is monotonic: a larger raw value never gives a smaller output', () => {
		const a = axis()
		let previous = -1
		for (let raw = 4; raw <= 238; raw++) {
			const out = a.map(raw)
			expect(out).toBeGreaterThanOrEqual(previous)
			previous = out
		}
	})

	it('stays within 0 to 255 for any raw value', () => {
		const a = axis()
		for (let raw = 0; raw <= 255; raw++) {
			const out = a.map(raw)
			expect(out).toBeGreaterThanOrEqual(0)
			expect(out).toBeLessThanOrEqual(255)
		}
	})

	it('gives each side its own scale, so an asymmetric stick still reaches both ends', () => {
		const a = new JoystickAxis({ min: 28, centre: 128, max: 253 })
		expect(a.map(28)).toBe(0)
		expect(a.map(253)).toBe(255)
		expect(a.map(78)).toBeGreaterThan(40) // halfway out to the left is a good way along
		expect(a.map(78)).toBeLessThan(90)
	})

	it('honours the dead zone setting', () => {
		const a = axis()
		a.setDeadzonePercent(0)
		expect(a.map(129)).not.toBe(128)
		a.setDeadzonePercent(20) // about 25 counts
		expect(a.map(150)).toBe(128)
		expect(a.map(160)).not.toBe(128)
	})

	it('widens its range when the stick goes further than expected, but never narrows it', () => {
		const a = axis()
		expect(a.map(245)).toBe(255) // beyond the old max
		expect(a.calibration.max).toBe(245)
		a.map(200)
		expect(a.calibration.max).toBe(245)
		expect(a.map(245)).toBe(255)
	})

	describe('calibration mode', () => {
		it('learns the centre and both ends, then uses them', () => {
			const a = axis()
			a.map(140) // the stick rests at 140 on this panel
			a.startCalibration()
			expect(a.calibrating).toBe(true)
			expect(a.map(140)).toBe(140) // raw is passed through while learning
			for (const raw of [100, 40, 20, 60, 140, 200, 230, 250, 180, 142]) a.map(raw)
			expect(a.finishCalibration()).toBe(true)
			expect(a.calibrating).toBe(false)
			expect(a.calibration).toEqual({ min: 20, centre: 140, max: 250 })
			expect(a.map(140)).toBe(128)
			expect(a.map(20)).toBe(0)
			expect(a.map(250)).toBe(255)
		})

		it('throws the result away, keeping the old calibration, if the stick barely moved', () => {
			const a = axis()
			a.startCalibration()
			a.map(130)
			a.map(120)
			a.map(135)
			expect(135 - 128).toBeLessThan(MIN_USEFUL_TRAVEL)
			expect(a.finishCalibration()).toBe(false)
			expect(a.calibration).toEqual(cal)
		})

		it('uses the default centre if the stick has not reported anything yet', () => {
			const a = axis()
			a.startCalibration()
			for (const raw of [10, 250]) a.map(raw)
			expect(a.finishCalibration()).toBe(true)
			expect(a.calibration.centre).toBe(128)
		})
	})
})

describe('T-bar', () => {
	it('reads exactly 0 and 255 for the last few counts at each end', () => {
		const t = new TbarAxis()
		expect(t.map(0)).toBe(0)
		expect(t.map(TBAR_END_MARGIN)).toBe(0)
		expect(t.map(255)).toBe(255)
		expect(t.map(255 - TBAR_END_MARGIN)).toBe(255)
		expect(t.map(128)).toBe(128)
	})

	it('moves smoothly off each end instead of jumping', () => {
		const t = new TbarAxis()
		// One count off the end is one step of output (a little over one, as the travel is stretched)
		expect(t.map(TBAR_END_MARGIN + 1)).toBe(1)
		expect(t.map(255 - TBAR_END_MARGIN - 1)).toBe(254)
		// Every raw count moves the output by 1 or 2, never more
		let last = t.map(0)
		for (let raw = 1; raw <= 255; raw++) {
			const v = t.map(raw)
			expect(v - last, `raw ${raw}`).toBeGreaterThanOrEqual(0)
			expect(v - last, `raw ${raw}`).toBeLessThanOrEqual(2)
			last = v
		}
	})

	it('calibrates to where the ends of this panel really are', () => {
		const t = new TbarAxis()
		t.map(128)
		t.startCalibration()
		expect(t.map(20)).toBe(20) // raw values while calibrating
		t.map(230)
		t.map(128)
		expect(t.finishCalibration()).toBe(true)
		expect(t.calibration).toEqual({ min: 20, max: 230 })
		expect(t.map(20 + TBAR_END_MARGIN)).toBe(0)
		expect(t.map(230 - TBAR_END_MARGIN)).toBe(255)
		expect(t.map(125)).toBe(128)
	})

	it('keeps the old calibration if the T-bar barely moved', () => {
		const t = new TbarAxis()
		t.map(10)
		t.startCalibration()
		t.map(10 + MIN_TBAR_TRAVEL - 1)
		expect(t.finishCalibration()).toBe(false)
		expect(t.calibration).toEqual({ min: 0, max: 255 })
	})

	it('restores only sensible saved calibrations', () => {
		const t = new TbarAxis()
		expect(t.restore({ min: 200, max: 10 })).toBe(false)
		expect(t.restore({ min: 0, max: 300 })).toBe(false)
		expect(t.restore({ min: 12, max: 244 })).toBe(true)
		expect(t.calibration).toEqual({ min: 12, max: 244 })
	})

	it('reports the end it is at, with hysteresis so the LED does not flicker', () => {
		const ends = new TbarEnds()
		expect(ends.update(128)).toBeNull()
		expect(ends.update(0)).toBe('up')
		expect(ends.update(3)).toBe('up') // moved a little: still counts as at the end
		expect(ends.update(TBAR_END_OFF)).toBe('up')
		expect(ends.update(TBAR_END_OFF + 1)).toBeNull()
		expect(ends.update(255)).toBe('down')
		expect(ends.update(255 - TBAR_END_OFF)).toBe('down')
		expect(ends.update(255 - TBAR_END_OFF - 1)).toBeNull()
	})
})

/** The real capture, as the panel sent it */
function captureEvents(labelPrefix: string): LC11Event[] {
	const events: LC11Event[] = []
	const parser = new LC11Parser((e) => events.push(e))
	let inside = false
	for (const line of readFileSync(new URL('./fixtures/lc11-capture.txt', import.meta.url), 'utf8').split('\n')) {
		const label = /^### LABEL: (.*)$/.exec(line)
		if (label) {
			inside = label[1].trim().startsWith(labelPrefix)
			continue
		}
		const message = /^\d\d:\d\d:\d\d (.*)$/.exec(line)
		if (inside && message) parser.feed(`${message[1]}\r`)
	}
	return events
}

describe('against the real joystick capture', () => {
	it.each([
		['A', 'Joystick A', 'a'],
		['B', 'Joystick B', 'b'],
	] as const)('Joystick %s: both axes now reach 0 and 255 and never leave that range', (_name, label, stick) => {
		const axes = { x: new JoystickAxis(DEFAULT_CALIBRATION[stick].x), y: new JoystickAxis(DEFAULT_CALIBRATION[stick].y) }
		const outX: number[] = []
		const outY: number[] = []
		for (const e of captureEvents(label)) {
			if (e.type !== 'joystick') continue
			outX.push(axes.x.map(e.x))
			outY.push(axes.y.map(e.y))
		}
		expect(outX.length).toBeGreaterThan(100)
		for (const out of [outX, outY]) {
			expect(Math.min(...out)).toBe(0)
			expect(Math.max(...out)).toBe(255)
		}
	})

	it('the raw values did not reach the ends, which is what calibration fixes', () => {
		const xs = captureEvents('Joystick A').flatMap((e) => (e.type === 'joystick' ? [e.x] : []))
		expect(Math.min(...xs)).toBeGreaterThan(0)
		expect(Math.max(...xs)).toBeLessThan(255)
	})

	it('the first and last readings of each stick (at rest) come out centred', () => {
		for (const [label, stick] of [['Joystick A', 'a'], ['Joystick B', 'b']] as const) {
			const sticks = captureEvents(label).filter((e): e is Extract<LC11Event, { type: 'joystick' }> => e.type === 'joystick')
			const axes = { x: new JoystickAxis(DEFAULT_CALIBRATION[stick].x), y: new JoystickAxis(DEFAULT_CALIBRATION[stick].y) }
			for (const e of [sticks[0], sticks.at(-1)!]) {
				expect(axes.x.map(e.x), `${label} x`).toBe(128)
				expect(axes.y.map(e.y), `${label} y`).toBe(128)
			}
		}
	})
})

describe('calibration text', () => {
	const cals = [
		{ min: 4, centre: 128, max: 238 },
		{ min: 9, centre: 128, max: 255 },
		{ min: 18, centre: 130, max: 253 },
		{ min: 15, centre: 139, max: 255 },
	]
	it('round trips, with the T-bar', () => {
		const cal = { axes: cals, tbar: { min: 3, max: 250 } }
		expect(formatCalibration(cal)).toBe('4,128,238;9,128,255;18,130,253;15,139,255;3,250')
		expect(parseCalibration(formatCalibration(cal))).toEqual(cal)
	})
	it('still reads text saved by the older joystick-only version', () => {
		expect(parseCalibration('4,128,238;9,128,255;18,130,253;15,139,255')).toEqual({ axes: cals })
	})
	it('keeps the joysticks but drops a T-bar part that is not sensible', () => {
		for (const tbar of ['x', '3', '250,3', '3,300', '3,4']) {
			expect(parseCalibration(`4,128,238;9,128,255;18,130,253;15,139,255;${tbar}`), tbar).toEqual({ axes: cals })
		}
	})
	it('rejects anything without four sensible joystick axes', () => {
		for (const bad of ['', '1,2,3', '4,128,238;9,128,255;18,130,253', '4,128,238;9,128,255;18,130,253;15,139,x', '4,128,238;9,128,255;18,130,253;15,139,300', '4,128,238;9,128,255;18,130,253;139,15,255']) {
			expect(parseCalibration(bad), bad).toBeUndefined()
		}
	})
})
