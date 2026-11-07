import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SurfaceContext } from '@companion-surface/base'
import { LC11Surface, LED_BATCH_MS, MAX_ROTATE_STEPS_PER_EVENT, VARIABLE_INTERVAL_MS, type SerialPortLike } from '../src/instance.js'

class FakePort extends EventEmitter implements SerialPortLike {
	isOpen = true
	/** Everything the surface wrote to the panel, one entry per write call */
	written: string[] = []
	write(data: string, cb?: (error?: Error | null) => void): void {
		this.written.push(data)
		cb?.(null)
	}
	close(cb?: (error?: Error | null) => void): void {
		this.isOpen = false
		cb?.(null)
		this.emit('close')
	}
	send(text: string): void {
		this.emit('data', Buffer.from(text, 'latin1'))
	}
}

function makeContext() {
	return {
		keyDownById: vi.fn(),
		keyUpById: vi.fn(),
		rotateLeftById: vi.fn(),
		rotateRightById: vi.fn(),
		sendVariableValue: vi.fn(),
		disconnect: vi.fn(),
	} as unknown as SurfaceContext & Record<'keyDownById' | 'keyUpById' | 'rotateLeftById' | 'rotateRightById' | 'sendVariableValue' | 'disconnect', ReturnType<typeof vi.fn>>
}

describe('LC11Surface', () => {
	let port: FakePort
	let ctx: ReturnType<typeof makeContext>
	let surface: LC11Surface

	beforeEach(async () => {
		vi.useFakeTimers()
		port = new FakePort()
		ctx = makeContext()
		surface = new LC11Surface('newtek-lc11:TEST', port, ctx)
		await surface.init()
	})
	afterEach(async () => {
		await surface.close()
		vi.useRealTimers()
	})

	it('identifies itself', () => {
		expect(surface.surfaceId).toBe('newtek-lc11:TEST')
		expect(surface.productName).toBe('NewTek LC-11')
	})

	it('turns panel button presses into key down and key up', () => {
		port.send('~F7F\rF\r')
		expect(ctx.keyDownById).toHaveBeenCalledExactlyOnceWith('effects-1')
		port.send('~FFF\rF\r')
		expect(ctx.keyUpById).toHaveBeenCalledExactlyOnceWith('effects-1')
	})

	it('turns knob turns into left and right steps on the same control as the knob press', () => {
		port.send('~8F0\r~8F1\r~8F2\r~8F1\r') // baseline, +1, +1, -1
		expect(ctx.rotateRightById.mock.calls).toEqual([['speed-knob'], ['speed-knob']])
		expect(ctx.rotateLeftById.mock.calls).toEqual([['speed-knob']])
		port.send('^27F\r^2FF\r')
		expect(ctx.keyDownById).toHaveBeenCalledWith('speed-knob')
		expect(ctx.keyUpById).toHaveBeenCalledWith('speed-knob')
	})

	it('sends one step per click when a fast turn reports several clicks at once', () => {
		port.send('~9F0\r~9F3\r') // baseline, then +3
		expect(ctx.rotateRightById).toHaveBeenCalledTimes(3)
		port.send('~9F0\r') // -3
		expect(ctx.rotateLeftById).toHaveBeenCalledTimes(3)
		expect(ctx.rotateRightById.mock.calls.every((c) => c[0] === 'fx-knob')).toBe(true)
	})

	it('does not flood Companion if a knob reading jumps wildly', () => {
		port.send('~5F0\r~5F0\r') // baseline, no change
		port.send('~570\r') // +/-128 jump
		expect(ctx.rotateRightById.mock.calls.length + ctx.rotateLeftById.mock.calls.length).toBe(MAX_ROTATE_STEPS_PER_EVENT)
	})

	it('sends T-bar and joystick values as variables, throttled and only when changed', () => {
		for (let v = 0; v < 200; v++) port.send(`~4${v.toString(16).padStart(2, '0')}\r`)
		expect(ctx.sendVariableValue).not.toHaveBeenCalled() // nothing until the first flush
		vi.advanceTimersByTime(VARIABLE_INTERVAL_MS)
		expect(ctx.sendVariableValue).toHaveBeenCalledExactlyOnceWith('tbar', 199) // newest value wins

		port.send('~4C7\r') // same value again
		vi.advanceTimersByTime(VARIABLE_INTERVAL_MS)
		expect(ctx.sendVariableValue).toHaveBeenCalledTimes(1)

		// Joystick values are calibrated: these four readings are all near each stick's rest position, so they read 128
		port.send('^57F83\r^78090\r')
		vi.advanceTimersByTime(VARIABLE_INTERVAL_MS)
		expect(ctx.sendVariableValue.mock.calls.slice(1)).toEqual(
			expect.arrayContaining([
				['joystick-a-x', 128],
				['joystick-a-y', 128],
				['joystick-b-x', 128],
				['joystick-b-y', 128],
			]),
		)
	})

	describe('T-bar', () => {
		const lines = (data: string) => data.split('\r').filter(Boolean)

		it('lights the T-bar LEDs when the T-bar is all the way up or all the way down, and not in between', () => {
			port.written.length = 0
			port.send('~400\r') // all the way to the 0 end
			vi.advanceTimersByTime(LED_BATCH_MS)
			expect(port.written.map(lines).flat()).toEqual(['~3FE'])

			port.send('~480\r') // middle
			vi.advanceTimersByTime(LED_BATCH_MS)
			expect(port.written.map(lines).flat().at(-1)).toBe('~3FF')

			port.send('~4FF\r') // all the way to the 255 end
			vi.advanceTimersByTime(LED_BATCH_MS)
			expect(port.written.map(lines).flat().at(-1)).toBe('~3FB')
		})

		it('does not keep rewriting the LEDs while the T-bar is moving', () => {
			port.send('~480\r')
			vi.advanceTimersByTime(LED_BATCH_MS)
			port.written.length = 0
			for (let v = 0x30; v < 0x90; v++) port.send(`~4${v.toString(16)}\r`)
			vi.advanceTimersByTime(LED_BATCH_MS)
			expect(port.written).toEqual([])
		})

		it('sends the T-bar variable with the last few counts at each end snapped to 0 and 255', () => {
			port.send('~404\r')
			vi.advanceTimersByTime(VARIABLE_INTERVAL_MS)
			expect(ctx.sendVariableValue).toHaveBeenLastCalledWith('tbar', 0)
			port.send('~4FB\r')
			vi.advanceTimersByTime(VARIABLE_INTERVAL_MS)
			expect(ctx.sendVariableValue).toHaveBeenLastCalledWith('tbar', 255)
			port.send('~480\r')
			vi.advanceTimersByTime(VARIABLE_INTERVAL_MS)
			expect(ctx.sendVariableValue).toHaveBeenLastCalledWith('tbar', 128)
		})
	})

	describe('joysticks', () => {
		const lastValue = (name: string) => ctx.sendVariableValue.mock.calls.filter((c) => c[0] === name).at(-1)?.[1]

		it('sends calibrated values: at rest 128, at the ends exactly 0 and 255', () => {
			port.send('^57F83\r') // Joystick A at rest (127, 131), like the first reading in the real capture
			vi.advanceTimersByTime(VARIABLE_INTERVAL_MS)
			expect(lastValue('joystick-a-x')).toBe(128)
			expect(lastValue('joystick-a-y')).toBe(128)

			port.send('^5EEFF\r') // 238, 255: the furthest right and up this stick reached in the capture
			vi.advanceTimersByTime(VARIABLE_INTERVAL_MS)
			expect(lastValue('joystick-a-x')).toBe(255)
			expect(lastValue('joystick-a-y')).toBe(255)

			port.send('^70FFF\r') // Joystick B reaching low x (15), high y (255)
			vi.advanceTimersByTime(VARIABLE_INTERVAL_MS)
			expect(lastValue('joystick-b-x')).toBe(0)
			expect(lastValue('joystick-b-y')).toBe(255)
		})

		it('calibrates from the surface settings: tick, move the sticks, untick', async () => {
			port.send('^58C80\r') // Joystick A at rest, but this panel rests at x = 0x8C = 140, not the default 128
			vi.advanceTimersByTime(VARIABLE_INTERVAL_MS)
			expect(lastValue('joystick-a-x')).toBeGreaterThan(128) // uncalibrated, 140 reads as a push to the right

			await surface.updateConfig({ joystick_calibrate: true, joystick_deadzone: 5 })
			// While calibrating the raw values come through, so the movement can be watched
			port.send('^5140A\r') // x = 0x14 = 20, y = 0x0A = 10
			vi.advanceTimersByTime(VARIABLE_INTERVAL_MS)
			expect(lastValue('joystick-a-x')).toBe(20)
			port.send('^5FAF5\r') // x = 250, y = 245
			port.send('^58C80\r') // back to rest
			vi.advanceTimersByTime(VARIABLE_INTERVAL_MS)
			// Joystick B was not moved, so its calibration is rejected and the old one kept: this must not throw
			await surface.updateConfig({ joystick_calibrate: false, joystick_deadzone: 5 })

			for (const [message, expected] of [
				['^58C80', 128], // the new centre
				['^5FA80', 255], // new far end
				['^51480', 0], // new near end
			] as const) {
				port.send(`${message}\r`)
				vi.advanceTimersByTime(VARIABLE_INTERVAL_MS)
				expect(lastValue('joystick-a-x'), message).toBe(expected)
			}
		})

		it('hands a finished calibration to Companion to keep, and takes it back after a restart', async () => {
			await surface.updateConfig({ joystick_calibrate: true })
			port.send('^58C80\r')
			port.send('^5140A\r')
			port.send('^5FAF5\r')
			port.send('^58C80\r')
			await surface.updateConfig({ joystick_calibrate: false })
			const saved = ctx.sendVariableValue.mock.calls.filter(([name]) => name === 'joystick-calibration')
			expect(saved).toHaveLength(1)
			const text = saved[0][1] as string
			expect(text).toBe('20,128,250;10,128,245;18,130,253;15,139,255') // B was not moved, so it keeps its defaults

			// A fresh surface (Companion restarted) is given the saved text back and uses it
			const ctx2 = makeContext()
			const port2 = new FakePort()
			const fresh = new LC11Surface('newtek-lc11:TEST2', port2, ctx2)
			await fresh.init()
			fresh.onVariableValue('joystick-calibration-saved', text)
			port2.send('^5FA80\r')
			vi.advanceTimersByTime(VARIABLE_INTERVAL_MS)
			expect(ctx2.sendVariableValue).toHaveBeenCalledWith('joystick-a-x', 255)
			await fresh.close()
		})

		it('ignores a saved calibration that is empty, malformed or for the wrong variable', () => {
			for (const value of ['', 'garbage', '1,2,3', '20,10,250;10,128,245;18,130,253;15,139,255', undefined, 5]) {
				surface.onVariableValue('joystick-calibration-saved', value)
			}
			surface.onVariableValue('something-else', '20,128,250;10,128,245;18,130,253;15,139,255')
			port.send('^58C80\r')
			vi.advanceTimersByTime(VARIABLE_INTERVAL_MS)
			expect(lastValue('joystick-a-x')).toBeGreaterThan(128) // still the defaults
		})

		it('applies the dead zone setting', async () => {
			await surface.updateConfig({ joystick_deadzone: 0 })
			port.send('^58B80\r') // x = 139, 11 counts right of A's default centre 128
			vi.advanceTimersByTime(VARIABLE_INTERVAL_MS)
			const withNone = lastValue('joystick-a-x')
			expect(withNone).toBeGreaterThan(128)

			await surface.updateConfig({ joystick_deadzone: 20 })
			port.send('^58B81\r')
			vi.advanceTimersByTime(VARIABLE_INTERVAL_MS)
			expect(lastValue('joystick-a-x')).toBe(128)
		})
	})

	it('tells Companion when the serial port errors or closes unexpectedly', () => {
		const err = new Error('boom')
		port.emit('error', err)
		expect(ctx.disconnect).toHaveBeenCalledWith(err)
		ctx.disconnect.mockClear()
		port.emit('close')
		expect(ctx.disconnect).toHaveBeenCalledOnce()
	})

	it('does not report a disconnect when it is the one closing the port', async () => {
		await surface.close()
		expect(port.isOpen).toBe(false)
		expect(ctx.disconnect).not.toHaveBeenCalled()
	})

	describe('LEDs', () => {
		const signal = new AbortController().signal
		const draw = (controlId: string, color: string) => surface.draw(signal, { controlId, color })

		it('starts with every LED switched off', () => {
			expect(port.written).toEqual(['~FFFF\r~2FFF\r~1FFF\r~3FF\r^FFF\r^1FF\r'])
		})

		it('lights an LED when Companion draws a colour on it, and turns it off when drawn black', async () => {
			port.written.length = 0
			await draw('live-1', '#ff0000')
			expect(port.written).toEqual([]) // batched, not instant
			vi.advanceTimersByTime(LED_BATCH_MS)
			expect(port.written).toEqual(['~27FF\r'])

			await draw('live-1', '#000000')
			vi.advanceTimersByTime(LED_BATCH_MS)
			expect(port.written.at(-1)).toBe('~2FFF\r')
		})

		it('sends one write for a burst of draws, covering only the groups that changed', async () => {
			port.written.length = 0
			await draw('effects-1', '#ffffff')
			await draw('effects-2', '#ffffff')
			await draw('fade', '#00ff00')
			await draw('auto', '#00ff00') // no LED
			await draw('speed-knob', '#00ff00') // no LED
			await draw('preview-3', '#000000') // already off
			vi.advanceTimersByTime(LED_BATCH_MS)
			expect(port.written).toHaveLength(1)
			expect(port.written[0].split('\r').filter(Boolean).sort()).toEqual(['^F7F', '~F3FF'].sort())
		})

		it('writes nothing when a redraw does not change an LED', async () => {
			await draw('alt', '#ff0000')
			vi.advanceTimersByTime(LED_BATCH_MS)
			port.written.length = 0
			await draw('alt', '#ee0000')
			vi.advanceTimersByTime(LED_BATCH_MS)
			expect(port.written).toEqual([])
		})

		it('blank() switches every lit LED off', async () => {
			await draw('ftb', '#ff0000')
			await draw('live-bkg', '#ff0000')
			vi.advanceTimersByTime(LED_BATCH_MS)
			port.written.length = 0
			await surface.blank()
			vi.advanceTimersByTime(LED_BATCH_MS)
			// blank() rewrites every group in its all-off state
			expect(port.written.join('').split('\r').filter(Boolean).sort()).toEqual(
				['~FFFF', '~2FFF', '~1FFF', '~3FF', '^FFF', '^1FF'].sort(),
			)
		})

		it('leaves the panel dark when the surface closes', async () => {
			await draw('take-all', '#ff0000')
			vi.advanceTimersByTime(LED_BATCH_MS)
			port.written.length = 0
			await surface.close()
			expect(port.written.join('').split('\r').filter(Boolean).sort()).toEqual(
				['~FFFF', '~2FFF', '~1FFF', '~3FF', '^FFF', '^1FF'].sort(),
			)
		})
	})

	it('accepts draw, blank, brightness and status calls without a display', async () => {
		const signal = new AbortController().signal
		await expect(surface.draw(signal, { controlId: 'auto', color: '#00ff00' })).resolves.toBeUndefined()
		await expect(surface.blank()).resolves.toBeUndefined()
		await expect(surface.setBrightness(50)).resolves.toBeUndefined()
		await expect(surface.ready()).resolves.toBeUndefined()
	})
})
