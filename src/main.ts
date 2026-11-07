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
import { isLC11Port } from './detect.js'

export interface LC11PluginInfo {
	/** Serial port path, eg /dev/cu.usbserial-FT0A1B2C or COM3 */
	path: string
}

const BAUD_RATE = 9600

const logger = createModuleLogger('Plugin')

function openPort(path: string): Promise<SerialPort> {
	return new Promise((resolve, reject) => {
		const port = new SerialPort({ path, baudRate: BAUD_RATE, dataBits: 8, stopBits: 1, parity: 'none', autoOpen: false })
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
		/* nothing global to clean up */
	},

	async scanForSurfaces(): Promise<DetectionSurfaceInfo<LC11PluginInfo>[]> {
		const ports = await SerialPort.list()
		return ports.filter(isLC11Port).map((port) => ({
			surfaceId: `newtek-lc11:${port.serialNumber ?? port.path}`,
			surfaceIdIsNotUnique: port.serialNumber === undefined,
			description: MODEL_NAME,
			deviceHandle: port.path,
			pluginInfo: { path: port.path },
		}))
	},

	async openSurface(surfaceId: string, pluginInfo: LC11PluginInfo, context: SurfaceContext): Promise<OpenSurfaceResult> {
		const port = await openPort(pluginInfo.path)
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
					label: 'Calibrate joysticks',
					default: false,
					tooltip:
						'Leave both sticks at rest and tick this. Then move each stick through its full range, including the corners, let go, and untick it. The result is used straight away. To keep it across restarts, fill in the two Saved joystick calibration settings below (see the help page).',
				},
				{
					id: 'joystick_deadzone',
					type: 'number',
					label: 'Joystick dead zone (%)',
					default: DEFAULT_DEADZONE_PERCENT,
					min: 0,
					max: 40,
					step: 1,
					tooltip: 'How far from the centre a stick can move before the value changes from 128.',
				},
			],
			},
		}
	},
}

export default LC11Plugin
