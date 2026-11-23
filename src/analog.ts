/**
 * Calibration for the LC-11's analog controls.
 *
 * The raw values from the panel are 0 to 255, but a real stick never quite reaches either end, each axis
 * reaches a different place, and a stick let go of settles a few counts either side of the middle (and
 * not always on the same value). So the raw numbers are not directly usable for something like PTZ
 * control, where "full left" should be exactly 0, "centered" exactly 128 and "full right" exactly 255.
 */

export interface AxisCalibration {
	/** Raw value with the stick fully at the low end of this axis */
	min: number
	/** Raw value with the stick at rest */
	centre: number
	/** Raw value with the stick fully at the high end of this axis */
	max: number
}

/**
 * Starting point until the user calibrates: the ranges and rest positions measured on one real LC-11
 * (see test/fixtures/lc11-capture.txt). Other panels differ a little, which is what calibration and the
 * automatic range widening below are for.
 */
export const DEFAULT_CALIBRATION = {
	a: { x: { min: 4, centre: 128, max: 238 }, y: { min: 9, centre: 128, max: 255 } },
	b: { x: { min: 18, centre: 130, max: 253 }, y: { min: 15, centre: 139, max: 255 } },
} as const satisfies Record<'a' | 'b', Record<'x' | 'y', AxisCalibration>>

/** Transfer variable the module writes the calibration to (Companion: surface -> custom variable) */
export const CALIBRATION_INPUT_VARIABLE = 'joystick-calibration'
/** Transfer variable the module reads the saved calibration back from (Companion: expression -> surface) */
export const CALIBRATION_OUTPUT_VARIABLE = 'joystick-calibration-saved'

/** Everything the calibration covers. The T-bar part is optional: calibrations saved by older versions do not have it. */
export interface SavedCalibration {
	/** The four joystick axes in the order A X, A Y, B X, B Y */
	axes: AxisCalibration[]
	tbar?: TbarCalibration
}

/**
 * Calibration as one line of text: `min,centre,max` per joystick axis in the order A X, A Y, B X, B Y,
 * then `min,max` for the T-bar, separated by `;`
 */
export function formatCalibration(cal: SavedCalibration): string {
	const parts = cal.axes.map((c) => `${c.min},${c.centre},${c.max}`)
	if (cal.tbar) parts.push(`${cal.tbar.min},${cal.tbar.max}`)
	return parts.join(';')
}

const parseNumbers = (part: string): number[] | undefined => {
	const nums = part.split(',').map((n) => (n.trim() === '' ? NaN : Number(n)))
	return nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? nums : undefined
}

/**
 * The reverse of formatCalibration. Undefined unless all four joystick axes are present and sensible.
 * Text from older versions (joysticks only) is accepted. A T-bar part that is not sensible is left out.
 */
export function parseCalibration(text: string): SavedCalibration | undefined {
	const parts = text.trim().split(';')
	if (parts.length !== 4 && parts.length !== 5) return undefined
	const axes: AxisCalibration[] = []
	for (const part of parts.slice(0, 4)) {
		const nums = parseNumbers(part)
		if (!nums || nums.length !== 3) return undefined
		const [min, centre, max] = nums
		if (!(min < centre && centre < max)) return undefined
		axes.push({ min, centre, max })
	}
	const result: SavedCalibration = { axes }
	if (parts.length === 5) {
		const nums = parseNumbers(parts[4])
		if (nums && nums.length === 2 && tbarCalibrationOk({ min: nums[0], max: nums[1] })) {
			result.tbar = { min: nums[0], max: nums[1] }
		}
	}
	return result
}

/** Half the output range: the calibrated output is 0 to 255 with 128 in the middle. */
const MID = 128

/** Default size of the neutral band around the center, as a percentage of the travel. */
export const DEFAULT_DEADZONE_PERCENT = 5

/** Raw counts short of the learned end that already count as full deflection (a stick is rarely pushed to the exact same spot twice). */
export const END_MARGIN = 5

/** A calibration where the stick moved less than this far each way from the center is thrown away. */
export const MIN_USEFUL_TRAVEL = 30

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/** One axis of one joystick. */
export class JoystickAxis {
	#cal: AxisCalibration
	#deadzonePercent = DEFAULT_DEADZONE_PERCENT
	#lastRaw: number | undefined
	/** Range being learned while calibrating; undefined when not calibrating */
	#learning: AxisCalibration | undefined

	constructor(defaults: AxisCalibration) {
		this.#cal = { ...defaults }
	}

	get calibrating(): boolean {
		return this.#learning !== undefined
	}

	/** The calibration currently in use (a copy). */
	get calibration(): AxisCalibration {
		return { ...this.#cal }
	}

	/** Use a calibration saved earlier. Returns false (and changes nothing) if it is not sensible. */
	restore(saved: AxisCalibration): boolean {
		const { min, centre, max } = saved
		if (!(min < centre && centre < max)) return false
		if (centre - min < MIN_USEFUL_TRAVEL || max - centre < MIN_USEFUL_TRAVEL) return false
		this.#cal = { min, centre, max }
		return true
	}

	setDeadzonePercent(percent: number): void {
		this.#deadzonePercent = Number.isFinite(percent) ? Math.min(40, Math.max(0, percent)) : DEFAULT_DEADZONE_PERCENT
	}

	/**
	 * Begin learning the range. The stick should be at rest now: wherever it is becomes the center.
	 * Until finishCalibration() the output is the raw value, so the movement can be watched.
	 */
	startCalibration(): void {
		const centre = this.#lastRaw ?? this.#cal.centre
		this.#learning = { min: centre, centre, max: centre }
	}

	/** Stop learning. Returns true if the new range was used, false if the stick did not move enough. */
	finishCalibration(): boolean {
		const learned = this.#learning
		this.#learning = undefined
		if (!learned) return false
		if (learned.centre - learned.min < MIN_USEFUL_TRAVEL || learned.max - learned.centre < MIN_USEFUL_TRAVEL) return false
		this.#cal = learned
		return true
	}

	/** Raw panel value in, calibrated value out: 0 at the low end, 128 at rest, 255 at the high end. */
	map(raw: number): number {
		this.#lastRaw = raw
		const range = this.#learning ?? this.#cal
		// A stick going further than the range known so far widens it, so a panel that differs from the
		// defaults gets fixed by moving the stick to its limits once.
		if (raw < range.min) range.min = raw
		if (raw > range.max) range.max = raw
		if (this.#learning) return raw

		const { min, centre, max } = this.#cal
		const deadzone = Math.round((this.#deadzonePercent / 100) * (MID - 1))
		const d = raw - centre
		if (Math.abs(d) <= deadzone) return MID
		if (d > 0) {
			const span = Math.max(1, max - centre - deadzone - END_MARGIN)
			return MID + Math.round(clamp01((d - deadzone) / span) * (255 - MID))
		}
		const span = Math.max(1, centre - min - deadzone - END_MARGIN)
		return MID - Math.round(clamp01((-d - deadzone) / span) * MID)
	}
}

/** Default T-bar range until it is calibrated: the full 0 to 255 the panel can report. */
export const DEFAULT_TBAR_CALIBRATION: TbarCalibration = { min: 0, max: 255 }

/** Raw counts inside each learned end that still count as fully at that end (the bar rests a few counts short). */
export const TBAR_END_MARGIN = 5

/** A T-bar calibration where the bar moved less than this far is thrown away. */
export const MIN_TBAR_TRAVEL = 128

/** Once an end LED is on, the T-bar must move this far (in output counts) from the end before it turns off (avoids flicker). */
export const TBAR_END_OFF = 8

/** Where the T-bar's two ends are, as raw panel values. */
export interface TbarCalibration {
	/** Raw value with the bar all the way up (the 0 end) */
	min: number
	/** Raw value with the bar all the way down (the 255 end) */
	max: number
}

/**
 * The T-bar. Its output is 0 at the up end and 255 at the down end. The last few counts at each end
 * read as exactly 0 or 255, and the travel in between is stretched over the whole 0 to 255, so the
 * value moves smoothly off each end instead of jumping.
 */
export class TbarAxis {
	#cal: TbarCalibration
	#lastRaw: number | undefined
	/** Range being learned while calibrating; undefined when not calibrating */
	#learning: TbarCalibration | undefined

	constructor(defaults: TbarCalibration = DEFAULT_TBAR_CALIBRATION) {
		this.#cal = { ...defaults }
	}

	get calibrating(): boolean {
		return this.#learning !== undefined
	}

	/** The calibration currently in use (a copy). */
	get calibration(): TbarCalibration {
		return { ...this.#cal }
	}

	/** Use a calibration saved earlier. Returns false (and changes nothing) if it is not sensible. */
	restore(saved: TbarCalibration): boolean {
		if (!tbarCalibrationOk(saved)) return false
		this.#cal = { min: saved.min, max: saved.max }
		return true
	}

	/** Begin learning the range. Until finishCalibration() the output is the raw value, so the movement can be watched. */
	startCalibration(): void {
		const at = this.#lastRaw ?? 128
		this.#learning = { min: at, max: at }
	}

	/** Stop learning. Returns true if the new range was used, false if the bar did not move far enough. */
	finishCalibration(): boolean {
		const learned = this.#learning
		this.#learning = undefined
		if (!learned || !tbarCalibrationOk(learned)) return false
		this.#cal = learned
		return true
	}

	/** Raw panel value in, calibrated value out: 0 at the up end, 255 at the down end. */
	map(raw: number): number {
		this.#lastRaw = raw
		const range = this.#learning ?? this.#cal
		// Going further than the range known so far widens it
		if (raw < range.min) range.min = raw
		if (raw > range.max) range.max = raw
		if (this.#learning) return raw

		const lo = this.#cal.min + TBAR_END_MARGIN
		const hi = this.#cal.max - TBAR_END_MARGIN
		return Math.round(clamp01((raw - lo) / Math.max(1, hi - lo)) * 255)
	}
}

function tbarCalibrationOk(cal: TbarCalibration): boolean {
	const { min, max } = cal
	return Number.isInteger(min) && Number.isInteger(max) && min >= 0 && max <= 255 && max - min >= MIN_TBAR_TRAVEL
}

/**
 * Works out whether the T-bar is at one of its ends, from the calibrated value. In the capture, pulling
 * the T-bar down ends on 255 and pushing it up ends on 0.
 */
export class TbarEnds {
	#end: 'up' | 'down' | null = null

	update(value: number): 'up' | 'down' | null {
		if (value <= 0) this.#end = 'up'
		else if (value >= 255) this.#end = 'down'
		else if (this.#end === 'up' && value > TBAR_END_OFF) this.#end = null
		else if (this.#end === 'down' && value < 255 - TBAR_END_OFF) this.#end = null
		return this.#end
	}
}
