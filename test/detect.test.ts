import { describe, expect, it } from 'vitest'
import { isLC11Port } from '../src/detect.js'

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
