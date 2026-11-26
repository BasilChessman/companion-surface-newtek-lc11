import {
	createModuleLogger,
	type DetectionSurfaceInfo,
	type OpenSurfaceResult,
	type SurfaceContext,
	type SurfacePlugin,
} from '@companion-surface/base'
import { SerialPort } from 'serialport'
import { LC11Surface } from './instance.js'
import { MODEL_NAME, TRANSFER_VARIABLES, createLayout } from './layout.js'
import { DEFAULT_DEADZONE_PERCENT } from './analog.js'
import { checkOpenPort, describeReply, isLC11Port, probePanel, type PanelKind, type ProbePort } from './detect.js'

export interface LC11PluginInfo {
	/** Serial port path, eg /dev/cu.usbserial-FT0A1B2C or COM3 */
	path: string
}

const BAUD_RATE = 9600

/** If a port is busy while probing (the TriCaster Mini module may be probing it too), try again this many times. */
const PROBE_ATTEMPTS = 3
const PROBE_RETRY_MS = 1200

const logger = createModuleLogger('Plugin')

/** What each NewTek port turned out to be, by serial number (or path). Kept until the port disappears. */
const known = new Map<string, PanelKind>()
/** Ports found not to be an LC-11 when opening them (by path). Kept until the port disappears. */
const rejectedPaths = new Set<string>()

const keyOf = (port: { path: string; serialNumber?: string }): string => port.serialNumber ?? port.path

async function identify(path: string): Promise<PanelKind | undefined> {
	for (let attempt = 1; attempt <= PROBE_ATTEMPTS; attempt++) {
		const kind = await probePanel(
			() => openPort(path) as Promise<ProbePort>,
			undefined,
			(reply, result) => logger.info(`Checked the NewTek panel at ${path}: heard ${describeReply(reply)}, so ${result ?? 'unclear'}`),
		)
		if (kind) return kind
		if (attempt < PROBE_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, PROBE_RETRY_MS))
	}
	return undefined
}

function openPort(path: string): Promise<SerialPort> {
	return new Promise((resolve, reject) => {
		const port = new SerialPort({ path, baudRate: BAUD_RATE, dataBits: 8, stopBits: 1, parity: 'none', autoOpen: false, lock: true })
		port.open((error) => {
			if (error) {
				reject(
					new Error(
						`Failed to open ${path}: ${error.message}. Is another program, such as the TriCaster software or Central Control, using the LC-11?`,
					),
				)
			} else {
				resolve(port)
			}
		})
	})
}

const LC11Plugin: SurfacePlugin<LC11PluginInfo> = {
	async init() {
		logger.info('NewTek LC-11 plugin initialized')
	},

	async destroy() {
		known.clear()
		rejectedPaths.clear()
	},

	async scanForSurfaces(): Promise<DetectionSurfaceInfo<LC11PluginInfo>[]> {
		const ports = (await SerialPort.list()).filter(isLC11Port)

		// Forget panels that have been unplugged, so a different panel on the same port is checked afresh
		const present = new Set(ports.map(keyOf))
		for (const key of known.keys()) if (!present.has(key)) known.delete(key)
		const paths = new Set(ports.map((p) => p.path))
		for (const p of rejectedPaths) if (!paths.has(p)) rejectedPaths.delete(p)

		const found: DetectionSurfaceInfo<LC11PluginInfo>[] = []
		for (const port of ports) {
			// The TriCaster Mini control surface looks the same in the port list, so ask the panel
			if (rejectedPaths.has(port.path)) continue
			let kind = known.get(keyOf(port))
			if (!kind) {
				kind = await identify(port.path)
				if (!kind) {
					logger.debug(`Could not check the NewTek panel at ${port.path} (busy?); will try again on the next scan`)
					continue
				}
				known.set(keyOf(port), kind)
				if (kind !== 'lc11') logger.info(`NewTek panel at ${port.path} is not an LC-11 (probably a TriCaster Mini control surface); leaving it alone`)
			}
			if (kind !== 'lc11') continue
			found.push({
				surfaceId: `newtek-lc11:${port.serialNumber ?? port.path}`,
				surfaceIdIsNotUnique: port.serialNumber === undefined,
				description: MODEL_NAME,
				deviceHandle: port.path,
				pluginInfo: { path: port.path },
			})
		}
		return found
	},

	async openSurface(surfaceId: string, pluginInfo: LC11PluginInfo, context: SurfaceContext): Promise<OpenSurfaceResult> {
		const port = await openPort(pluginInfo.path)

		// Check again now that this module has the panel to itself: a TriCaster Mini control surface looks the
		// same in the port list, and a check during scanning can be unlucky. Hand a Mini straight back.
		const check = await checkOpenPort(port as ProbePort)
		if (check.kind === 'other') {
			rejectedPaths.add(pluginInfo.path)
			await new Promise<void>((resolve) => port.close(() => resolve()))
			logger.info(`The panel at ${pluginInfo.path} is not an LC-11 (heard ${describeReply(check.reply)}); letting it go`)
			throw new Error('This NewTek panel is not an LC-11 (it answers like a TriCaster Mini control surface)')
		}
		logger.info(`Opened LC-11 at ${pluginInfo.path} (${surfaceId})`)

		return {
			surface: new LC11Surface(surfaceId, port, context),
			registerProps: {
				brightness: false,
				surfaceLayout: createLayout(),
				transferVariables: TRANSFER_VARIABLES,
				pincodeMap: null,
				location: null,
				configFields: [
				{
					id: 'joystick_calibrate',
					type: 'checkbox',
					label: 'Calibrate joysticks and T-bar',
					default: false,
					tooltip:
						'Leave both sticks at rest and tick this. Then move each stick through its full range, including the corners, and let go. Move the T-bar all the way to both ends. Then untick it. The result is used straight away. To keep it across restarts, fill in the two Saved calibration settings below (see the help page).',
				},
				{
					id: 'joystick_deadzone',
					type: 'number',
					label: 'Joystick dead zone (%)',
					default: DEFAULT_DEADZONE_PERCENT,
					min: 0,
					max: 40,
					step: 1,
					tooltip: 'How far from the center a stick can move before the value changes from 128.',
				},
			],
			},
		}
	},
}

export default LC11Plugin
