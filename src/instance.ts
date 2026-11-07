import {
	createModuleLogger,
	type CardGenerator,
	type ModuleLogger,
	type SurfaceContext,
	type SurfaceDrawProps,
	type SurfaceInstance,
} from '@companion-surface/base'
import { LC11Parser, type LC11Event } from './protocol.js'
import { MODEL_NAME } from './layout.js'
import { LedState, TBAR_DOWN_LED, TBAR_UP_LED, colorIsLit } from './leds.js'
import {
	CALIBRATION_INPUT_VARIABLE,
	CALIBRATION_OUTPUT_VARIABLE,
	DEFAULT_CALIBRATION,
	DEFAULT_DEADZONE_PERCENT,
	JoystickAxis,
	TbarEnds,
	formatCalibration,
	parseCalibration,
	snapTbar,
} from './analog.js'

/** The small part of a serial port this surface needs, so tests can supply a fake. */
export interface SerialPortLike {
	on(event: 'data', listener: (data: Buffer) => void): unknown
	on(event: 'error', listener: (error: Error) => void): unknown
	on(event: 'close', listener: () => void): unknown
	write(data: string, callback?: (error?: Error | null) => void): unknown
	/** Wait until everything written has left the port. Optional so a simple fake need not have it. */
	drain?(callback?: (error?: Error | null) => void): unknown
	close(callback?: (error?: Error | null) => void): unknown
	readonly isOpen: boolean
}

/** Draw calls arrive in bursts (a page change redraws every control); LED commands are batched over this long. */
export const LED_BATCH_MS = 10

/** A knob reading never really jumps by this much; if it does (glitch), do not flood Companion with actions. */
export const MAX_ROTATE_STEPS_PER_EVENT = 16

/** Minimum gap between updates of any one variable. The T-bar and joysticks can report hundreds of times a second. */
export const VARIABLE_INTERVAL_MS = 50

export class LC11Surface implements SurfaceInstance {
	readonly #logger: ModuleLogger
	readonly #surfaceId: string
	readonly #port: SerialPortLike
	readonly #context: SurfaceContext
	readonly #parser: LC11Parser

	readonly #pendingVariables = new Map<string, number>()
	readonly #sentVariables = new Map<string, number>()
	#flushTimer: NodeJS.Timeout | undefined
	#closing = false

	readonly #leds = new LedState()
	#ledTimer: NodeJS.Timeout | undefined

	#restoredText = ''
	readonly #tbarEnds = new TbarEnds()
	readonly #axes = {
		a: { x: new JoystickAxis(DEFAULT_CALIBRATION.a.x), y: new JoystickAxis(DEFAULT_CALIBRATION.a.y) },
		b: { x: new JoystickAxis(DEFAULT_CALIBRATION.b.x), y: new JoystickAxis(DEFAULT_CALIBRATION.b.y) },
	}

	public get surfaceId(): string {
		return this.#surfaceId
	}
	public get productName(): string {
		return MODEL_NAME
	}

	constructor(surfaceId: string, port: SerialPortLike, context: SurfaceContext) {
		this.#logger = createModuleLogger(`Instance/${surfaceId}`)
		this.#surfaceId = surfaceId
		this.#port = port
		this.#context = context
		this.#parser = new LC11Parser((event) => this.#handleEvent(event))

		port.on('data', (data) => this.#parser.feed(data))
		port.on('error', (error) => {
			this.#logger.error(`Serial error: ${error.message}`)
			if (!this.#closing) context.disconnect(error)
		})
		port.on('close', () => {
			if (!this.#closing) context.disconnect(new Error('The LC-11 serial port closed. Was it unplugged?'))
		})
	}

	#handleEvent(event: LC11Event): void {
		switch (event.type) {
			case 'button':
				if (event.pressed) this.#context.keyDownById(event.controlId)
				else this.#context.keyUpById(event.controlId)
				break
			case 'rotate':
				// API 1.3 (the oldest this module supports, Companion 5.0) can only turn a control one step per
				// call; the newer rotateById(delta) does not exist there. A fast turn reports several steps at once.
				for (let i = 0, n = Math.min(Math.abs(event.delta), MAX_ROTATE_STEPS_PER_EVENT); i < n; i++) {
					if (event.delta < 0) this.#context.rotateLeftById(event.controlId)
					else this.#context.rotateRightById(event.controlId)
				}
				break
			case 'tbar': {
				this.#pendingVariables.set('tbar', snapTbar(event.value))
				// The two LEDs by the T-bar show when it is all the way up or all the way down
				const end = this.#tbarEnds.update(event.value)
				const upChanged = this.#leds.set(TBAR_UP_LED, end === 'up')
				const downChanged = this.#leds.set(TBAR_DOWN_LED, end === 'down')
				if (upChanged || downChanged) this.#scheduleLeds()
				break
			}
			case 'joystick':
				this.#pendingVariables.set(`joystick-${event.stick}-x`, this.#axes[event.stick].x.map(event.x))
				this.#pendingVariables.set(`joystick-${event.stick}-y`, this.#axes[event.stick].y.map(event.y))
				break
		}
	}

	#flushVariables = (): void => {
		for (const [name, value] of this.#pendingVariables) {
			if (this.#sentVariables.get(name) === value) continue
			this.#sentVariables.set(name, value)
			this.#context.sendVariableValue(name, value)
		}
		this.#pendingVariables.clear()
	}

	#writeLines(lines: string[]): void {
		if (lines.length === 0 || !this.#port.isOpen) return
		this.#port.write(lines.join(''), (error) => {
			if (error) this.#logger.error(`Failed to write LED state: ${error.message}`)
		})
	}

	#flushLeds = (): void => {
		this.#ledTimer = undefined
		this.#writeLines(this.#leds.takeChanges())
	}

	#scheduleLeds(): void {
		this.#ledTimer ??= setTimeout(this.#flushLeds, LED_BATCH_MS)
	}

	async init(): Promise<void> {
		this.#writeLines(this.#leds.allGroups()) // start from a known state: every LED off
		this.#flushTimer = setInterval(this.#flushVariables, VARIABLE_INTERVAL_MS)
		this.#flushTimer.unref?.()
	}

	async close(): Promise<void> {
		this.#closing = true
		if (this.#flushTimer) clearInterval(this.#flushTimer)
		this.#flushTimer = undefined
		if (this.#ledTimer) clearTimeout(this.#ledTimer)
		this.#ledTimer = undefined
		this.#leds.clear()
		this.#writeLines(this.#leds.takeChanges()) // leave the panel dark: it keeps LED states until unplugged
		if (this.#port.isOpen) {
			// Let the final all-LEDs-off command leave before the port is closed
			await new Promise<void>((resolve) => {
				if (this.#port.drain) this.#port.drain(() => resolve())
				else resolve()
			})
			await new Promise<void>((resolve) => this.#port.close(() => resolve()))
		}
	}

	/** The four axes in the order they are stored: A X, A Y, B X, B Y */
	get #axisList(): JoystickAxis[] {
		return [this.#axes.a.x, this.#axes.a.y, this.#axes.b.x, this.#axes.b.y]
	}

	/**
	 * Companion gives a module nowhere to keep data, but it does keep custom variables (when set to persist).
	 * So the calibration is handed to Companion as text through a variable the user links once, and handed
	 * back through a second one when Companion starts.
	 */
	#publishCalibration(): void {
		const text = formatCalibration(this.#axisList.map((axis) => axis.calibration))
		this.#restoredText = text // our own value coming back round is not news
		this.#context.sendVariableValue(CALIBRATION_INPUT_VARIABLE, text)
	}

	onVariableValue(name: string, value: any): void {
		if (name !== CALIBRATION_OUTPUT_VARIABLE || typeof value !== 'string') return
		if (value === this.#restoredText || this.#axisList[0].calibrating) return
		const parsed = parseCalibration(value)
		if (!parsed) {
			if (value.trim() !== '') this.#logger.warn(`Ignoring the saved joystick calibration, it is not valid: ${value}`)
			return
		}
		this.#restoredText = value
		const axes = this.#axisList
		const used = parsed.filter((cal, i) => axes[i].restore(cal)).length
		if (used > 0) this.#logger.info('Using the joystick calibration saved in Companion')
	}

	async updateConfig(config: Record<string, any>): Promise<void> {
		const axes = [this.#axes.a.x, this.#axes.a.y, this.#axes.b.x, this.#axes.b.y]
		const deadzone = Number(config?.joystick_deadzone ?? DEFAULT_DEADZONE_PERCENT)
		for (const axis of axes) axis.setDeadzonePercent(deadzone)

		const wantCalibrating = !!config?.joystick_calibrate
		const isCalibrating = axes[0].calibrating
		if (wantCalibrating && !isCalibrating) {
			for (const axis of axes) axis.startCalibration()
			this.#logger.info('Joystick calibration started: move both sticks through their full range, then untick the setting')
		} else if (!wantCalibrating && isCalibrating) {
			const results = axes.map((axis) => axis.finishCalibration())
			if (results.some(Boolean)) this.#publishCalibration()
			if (results.every(Boolean)) {
				this.#logger.info('Joystick calibration finished')
			} else {
				const names = ['A X', 'A Y', 'B X', 'B Y']
				const skipped = names.filter((_, i) => !results[i]).join(', ')
				this.#logger.warn(`Joystick calibration: not enough movement on ${skipped}; the previous calibration was kept for those axes`)
			}
		}
	}

	async ready(): Promise<void> {}

	async setBrightness(_percent: number): Promise<void> {
		// The panel has no brightness control
	}

	async blank(): Promise<void> {
		this.#leds.clear()
		this.#scheduleLeds()
	}

	async draw(_signal: AbortSignal, drawProps: SurfaceDrawProps): Promise<void> {
		// The LEDs are single-colour on/off, so a lit colour means on and black means off
		if (drawProps.color !== undefined && this.#leds.set(drawProps.controlId, colorIsLit(drawProps.color))) {
			this.#scheduleLeds()
		}
	}

	async showStatus(_signal: AbortSignal, _cardGenerator: CardGenerator, _statusMessage: string): Promise<void> {
		// No display to show a status on
	}
}
