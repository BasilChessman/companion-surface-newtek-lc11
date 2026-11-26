import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { PROBE_COMMAND, checkOpenPort, classifyProbeReply, describeReply, isLC11Port, probePanel, type ProbePort } from '../src/detect.js'

describe('isLC11Port', () => {
	it('accepts the LC-11 as macOS reports it', () => {
		expect(
			isLC11Port({ path: '/dev/cu.usbserial-FT0A1B2C', manufacturer: 'NewTek', vendorId: '0403', productId: '6001', serialNumber: 'FT0A1B2C' }),
		).toBe(true)
	})

	it('is case-insensitive about the IDs and the manufacturer', () => {
		expect(isLC11Port({ path: 'x', manufacturer: 'NEWTEK INC', vendorId: '0403', productId: '6001' })).toBe(true)
	})

	it('rejects other devices that share the generic FTDI FT232 ID', () => {
		for (const manufacturer of ['FTDI', undefined, '', 'Prusa Research']) {
			expect(isLC11Port({ path: 'x', manufacturer, vendorId: '0403', productId: '6001' }), String(manufacturer)).toBe(false)
		}
	})

	it('rejects NewTek-named devices with other USB IDs', () => {
		expect(isLC11Port({ path: 'x', manufacturer: 'NewTek', vendorId: '0403', productId: '6010' })).toBe(false)
		expect(isLC11Port({ path: 'x', manufacturer: 'NewTek', vendorId: '1234', productId: '6001' })).toBe(false)
		expect(isLC11Port({ path: 'x', manufacturer: 'NewTek' })).toBe(false)
	})
})

describe('telling the LC-11 from a TriCaster Mini', () => {
	it('calls a silent panel, or one sending LC-11 messages, an LC-11', () => {
		expect(classifyProbeReply('')).toBe('lc11')
		expect(classifyProbeReply('~47F\r')).toBe('lc11')
		expect(classifyProbeReply('80')).toBe('lc11') // unfinished line
	})
	it('calls a panel sending the Mini heartbeat or Mini messages something else', () => {
		expect(classifyProbeReply('\r\r')).toBe('other')
		expect(classifyProbeReply('13BF\r')).toBe('other')
		expect(classifyProbeReply('\r~47F\r')).toBeUndefined()
	})

	class FakeProbePort extends EventEmitter implements ProbePort {
		written: string[] = []
		closed = false
		constructor(private readonly reply: string) {
			super()
		}
		write(data: string, cb?: (error?: Error | null) => void): void {
			this.written.push(data)
			cb?.(null)
			if (this.reply) setTimeout(() => this.emit('data', Buffer.from(this.reply, 'latin1')), 5)
		}
		close(cb?: (error?: Error | null) => void): void {
			this.closed = true
			cb?.(null)
		}
	}

	it('probes, listens and closes the port', async () => {
		const mini = new FakeProbePort('\r')
		expect(await probePanel(async () => mini, 30)).toBe('other')
		expect(mini.written).toEqual([PROBE_COMMAND])
		expect(mini.closed).toBe(true)
		expect(await probePanel(async () => new FakeProbePort(''), 30)).toBe('lc11')
	})

	it('reports "unknown" when the port is busy', async () => {
		expect(
			await probePanel(async () => {
				throw new Error('Resource busy')
			}, 30),
		).toBeUndefined()
	})

	it('checks a port that is already open without closing it, and stops listening afterwards', async () => {
		const mini = new FakeProbePort('\r\r')
		expect(await checkOpenPort(mini, 30)).toEqual({ kind: 'other', reply: '\r\r' })
		expect(mini.closed).toBe(false)
		expect(mini.listenerCount('data')).toBe(0)
	})

	it('describes what was heard for the log', () => {
		expect(describeReply('')).toBe('nothing')
		expect(describeReply('\r\r')).toBe('2 bytes "\\r\\r"')
	})
})
