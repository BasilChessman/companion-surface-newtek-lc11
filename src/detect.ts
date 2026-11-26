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
 * device's own string (typically Windows, which says "FTDI"), the LC-11 will not be recognized.
 */
export function isLC11Port(port: PortInfoLike): boolean {
	return (
		port.vendorId?.toLowerCase() === FTDI_VENDOR_ID &&
		port.productId?.toLowerCase() === FT232_PRODUCT_ID &&
		/newtek/i.test(port.manufacturer ?? '')
	)
}

/**
 * The TriCaster Mini control surface uses the same chip and the same "NewTek" string, so isLC11Port() alone
 * also matches it. The two are told apart by a short probe: after receiving `1600` the Mini sends a bare CR
 * about every 0.25 s, while the LC-11 stays silent (it ignores lines that do not start with `~` or `^`).
 */
export const PROBE_COMMAND = '1600\r'
/** How long to listen for the answer. The Mini's first CR comes after about 0.2 s. */
export const PROBE_LISTEN_MS = 800

export type PanelKind = 'lc11' | 'other'

/**
 * Decide what a NewTek panel is from what it sent while being probed. Undefined means "can't tell",
 * which only happens when Mini-looking and LC-11-looking messages both arrived.
 */
export function classifyProbeReply(reply: string): PanelKind | undefined {
	const lines = reply.split('\r').slice(0, -1) // only complete lines
	const mini = lines.some((l) => l.trim() === '' || /^[0-9A-Fa-f]{4}$/.test(l.trim()))
	const lc11 = /[~^]/.test(reply)
	if (mini && lc11) return undefined
	return mini ? 'other' : 'lc11'
}

/** The small part of a serial port the probe needs, so tests can supply a fake. */
export interface ProbePort {
	on(event: 'data', listener: (data: Buffer) => void): unknown
	removeListener?(event: 'data', listener: (data: Buffer) => void): unknown
	write(data: string, callback?: (error?: Error | null) => void): unknown
	close(callback?: (error?: Error | null) => void): unknown
}

/** Shows what a probe heard, for the log: CR as "\\r", at most 40 characters. */
export function describeReply(reply: string): string {
	if (reply === '') return 'nothing'
	const shown = reply.slice(0, 40).replace(/\r/g, '\\r')
	return `${reply.length} bytes "${shown}${reply.length > 40 ? '...' : ''}"`
}

/**
 * Probe a port that is already open: send the probe command and listen. The port stays open.
 * `kind` is undefined when the answer was unclear or the write failed.
 */
export async function checkOpenPort(
	port: ProbePort,
	listenMs = PROBE_LISTEN_MS,
): Promise<{ kind: PanelKind | undefined; reply: string }> {
	let reply = ''
	const listener = (data: Buffer): void => {
		reply += Buffer.from(data).toString('latin1')
	}
	port.on('data', listener)
	try {
		await new Promise<void>((resolve, reject) => port.write(PROBE_COMMAND, (e) => (e ? reject(e) : resolve())))
		await new Promise((resolve) => setTimeout(resolve, listenMs))
		return { kind: classifyProbeReply(reply), reply }
	} catch {
		return { kind: undefined, reply }
	} finally {
		port.removeListener?.('data', listener)
	}
}

/**
 * Probe one NewTek port. `open` must open it exclusively (so a panel another program is using is left
 * alone) and reject if that is not possible; the probe then resolves undefined (unknown, try again later).
 * `report`, if given, is told what was heard (for the log).
 */
export async function probePanel(
	open: () => Promise<ProbePort>,
	listenMs = PROBE_LISTEN_MS,
	report?: (reply: string, kind: PanelKind | undefined) => void,
): Promise<PanelKind | undefined> {
	let port: ProbePort
	try {
		port = await open()
	} catch {
		return undefined
	}
	try {
		const { kind, reply } = await checkOpenPort(port, listenMs)
		report?.(reply, kind)
		return kind
	} finally {
		await new Promise<void>((resolve) => port.close(() => resolve()))
	}
}
