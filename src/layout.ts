import type { SurfaceInputVariable, SurfaceOutputVariable, SurfaceSchemaLayoutDefinition } from '@companion-surface/base'
import { CALIBRATION_INPUT_VARIABLE, CALIBRATION_OUTPUT_VARIABLE } from './analog.js'
import { ROW_COLUMNS } from './protocol.js'

export const MODEL_ID = 'newtek-lc11'
export const MODEL_NAME = 'NewTek LC-11'

interface ControlDef {
	/** Control id, shared by the layout, the appearance and the parser */
	id: string
	/** Zero-based grid position in Companion */
	row: number
	column: number
	/** Legend printed on the panel */
	label: string
	kind: 'button' | 'encoder'
	/** Position and size of the control on the drawn face, in face units (an approximation) */
	x: number
	y: number
	width: number
	height: number
}

export const FACE_SIZE = { width: 1273, height: 500 } as const

const SOURCE_ROWS = [
	{ name: 'effects', y: 76 },
	{ name: 'live', y: 165 },
	{ name: 'preview', y: 254 },
] as const
const COLUMN_LABELS: Record<(typeof ROW_COLUMNS)[number], string> = {
	'1': '1',
	'2': '2',
	'3': '3',
	'4': '4',
	'5': '5',
	'6': '6',
	ext: 'EXT',
	ddr1: 'DDR 1',
	ddr2: 'DDR 2',
	txt: 'TXT',
	bkg: 'BKG',
}

function button(id: string, row: number, column: number, label: string, x: number, y: number, w: number, h: number): ControlDef {
	return { id, row, column, label, kind: 'button', x, y, width: w, height: h }
}
function knob(id: string, row: number, column: number, label: string, cx: number, cy: number): ControlDef {
	return { id, row, column, label, kind: 'encoder', x: cx - 20, y: cy - 20, width: 40, height: 40 }
}

export const CONTROLS: readonly ControlDef[] = [
	// The three 11-button source rows: Effects, Live, Preview
	...SOURCE_ROWS.flatMap((r, row) =>
		ROW_COLUMNS.map((col, column) =>
			button(`${r.name}-${col}`, row, column, COLUMN_LABELS[col], 26 + 63.2 * column, r.y, 56, 46),
		),
	),
	button('auto', 3, 7, 'AUTO', 455, 343, 107, 57),
	button('take', 3, 8, 'TAKE', 570, 343, 107, 57),

	// Transition section
	button('fade', 0, 12, 'Fade', 848, 82, 54, 38),
	button('fx', 0, 13, 'FX', 905, 82, 52, 38),
	knob('speed-knob', 1, 12, 'SPEED', 873, 185),
	knob('fx-knob', 1, 13, 'FX', 932, 185),
	button('ftb', 2, 12, 'FTB', 848, 258, 54, 40),
	button('alt', 2, 13, 'Alt', 905, 258, 52, 40),
	button('fade-all', 3, 12, 'Fade All', 848, 355, 54, 42),
	button('take-all', 3, 13, 'Take All', 905, 355, 52, 42),

	// Overlay section. Grid rows follow the panel: the knobs are level with the Live row, the source
	// buttons with the Preview row, and Fade/Take Overlay with AUTO and TAKE.
	knob('ddr1-knob', 1, 15, 'DDR1', 1060, 185),
	knob('ddr2-knob', 1, 16, 'DDR2', 1118, 185),
	knob('txt-knob', 1, 17, 'TXT', 1176, 185),
	button('overlay-ext', 2, 14, 'EXT', 1006, 257, 46, 38),
	button('overlay-ddr1', 2, 15, 'DDR 1', 1062, 257, 46, 38),
	button('overlay-ddr2', 2, 16, 'DDR 2', 1119, 257, 46, 38),
	button('overlay-txt', 2, 17, 'TXT', 1177, 257, 46, 38),
	button('fade-overlay', 3, 15, 'Fade Overlay', 1006, 343, 104, 56),
	button('take-overlay', 3, 16, 'Take Overlay', 1118, 343, 108, 56),
]

/** The T-bar and joysticks are analog, so Companion receives them as variables rather than controls. */
export const TRANSFER_VARIABLES: Array<SurfaceInputVariable | SurfaceOutputVariable> = [
	{ id: 'tbar', type: 'input', name: 'T-bar', description: 'T-bar position, 0 to 255' },
	{ id: 'joystick-a-x', type: 'input', name: 'Joystick A X', description: '0 to 255, centre is about 128' },
	{ id: 'joystick-a-y', type: 'input', name: 'Joystick A Y', description: '0 to 255, centre is about 128' },
	{ id: 'joystick-b-x', type: 'input', name: 'Joystick B X', description: '0 to 255, centre is about 128' },
	{ id: 'joystick-b-y', type: 'input', name: 'Joystick B Y', description: '0 to 255, centre is about 128' },
	{
		id: CALIBRATION_INPUT_VARIABLE,
		type: 'input',
		name: 'Saved joystick calibration (write to)',
		description: 'Optional. A custom variable with Persist value ticked, to keep the joystick calibration across restarts.',
	},
	{
		id: CALIBRATION_OUTPUT_VARIABLE,
		type: 'output',
		name: 'Saved joystick calibration (read from)',
		description: 'Optional. The same custom variable, written as an expression, eg $(custom:lc11_calibration)',
	},
]

export function createLayout(): SurfaceSchemaLayoutDefinition {
	const layout: SurfaceSchemaLayoutDefinition = {
		// No bitmaps or text: the panel has no displays. Colours are requested so the host passes
		// each control's feedback colour to draw(), ready for the button backlights.
		stylePresets: { default: { colors: 'hex' } },
		controls: {},
	}
	for (const c of CONTROLS) layout.controls[c.id] = { row: c.row, column: c.column }
	return layout
}

/**
 * A drawn face for the panel, so Companion's UI can show the LC-11 rather than a plain grid.
 *
 * NOT USED YET. `surfaceAppearance`, `modelId` and `getSurfaceModels` exist on the main branch of
 * bitfocus/companion-surface-api but not in the published @companion-surface/base 1.4.1. Once a
 * release has them, pass this as `registerProps.surfaceAppearance` and return a model from
 * `getSurfaceModels`. Positions are approximate (measured from the manufacturer's diagram).
 */
export function createAppearance() {
	return {
		size: { width: FACE_SIZE.width, height: FACE_SIZE.height },
		bodyColor: '#2d2d2d',
		controls: Object.fromEntries(
			CONTROLS.map((c) => [
				c.id,
				{
					x: Math.round(c.x),
					y: Math.round(c.y),
					width: c.width,
					height: c.height,
					kind: c.kind,
					label: c.label,
				},
			]),
		),
	}
}
