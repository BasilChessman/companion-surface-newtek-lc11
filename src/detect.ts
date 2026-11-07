/** The fields of a serial port listing that detection looks at (a subset of serialport's PortInfo). */
export interface PortInfoLike {
	path: string
	manufacturer?: string
	vendorId?: string
	productId?: string
	serialNumber?: string
}

/** The LC-11 uses a stock FTDI FT232 serial chip. */
export const FTDI_VENDOR_ID = '0403'
export const FT232_PRODUCT_ID = '6001'

/**
 * True when a serial port looks like an LC-11.
 *
 * 0403:6001 is the generic FTDI FT232 ID, shared by thousands of unrelated devices (3D printers,
 * lab gear, radios...), so the ID alone must never be enough: opening someone else's serial port and
 * listening to it could upset it. The LC-11 also reports "NewTek" as its manufacturer string, which
 * is what tells it apart.
 *
 * Known limit: where the operating system reports the driver's manufacturer rather than the
 * device's own string (typically Windows, which says "FTDI"), the LC-11 will not be recognised.
 */
export function isLC11Port(port: PortInfoLike): boolean {
	return (
		port.vendorId?.toLowerCase() === FTDI_VENDOR_ID &&
		port.productId?.toLowerCase() === FT232_PRODUCT_ID &&
		/newtek/i.test(port.manufacturer ?? '')
	)
}
