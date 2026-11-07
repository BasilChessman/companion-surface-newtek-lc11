## NewTek LC-11

A Companion surface module for the **NewTek TriCaster LC-11 (LiveControl)** control surface.

Requires **Companion 5.0 or newer**. Close the TriCaster software, Central Control, or anything else that
uses the LC-11 first: only one program can use its serial port at a time.

### What you get

- All **52 buttons**: the Effects, Live and Preview rows (11 each), AUTO, TAKE, Fade, FX, FTB, Alt,
  Fade All, Take All, the four Overlay source buttons, Fade Overlay and Take Overlay.
- The **five push-knobs** (Speed, FX, DDR1, DDR2, TXT) as controls that can be pressed **and** turned.
- The **T-bar** and **both joysticks** as surface variables, with calibration, and **LEDs** that follow your button
  colours and the T-bar position (below).

### Layout

The surface is a grid of 4 rows by 18 columns, laid out so each row of the grid lines up with the same row
of the panel. The three source rows (Effects, Live, Preview) are rows 0 to 2 on the left, and AUTO and TAKE
are on row 3 in the centre. The Transition section is in columns 12 and 13. The Overlay section is in
columns 14 to 17: its three knobs are on row 1, its four source buttons on row 2, and Fade Overlay and
Take Overlay on row 3, level with AUTO and TAKE.

### Using the knobs for rotation

Companion only shows rotate actions on buttons that ask for them:

1. Select a knob position (for example the Speed knob) in the **Buttons** grid.
2. Open the **Options** tab of the button editor. If your window is narrow the tab can be off the right
   edge: widen the panel or zoom the browser out.
3. Turn on **Rotary Actions**.
4. On the first tab, add actions under **Rotate left actions** and **Rotate right actions**.

### T-bar and joysticks

The T-bar and joysticks are analog, so they come into Companion as variables rather than buttons.

**Connecting them (one time).** Companion cannot use them directly: you give each one a custom variable to
land in.

1. On the **Variables** page, open **Custom Variables** and add one for each value you want (for example
   `tbar`, `joya_x`, `joya_y`, `joyb_x`, `joyb_y`).
2. On the **Surfaces** page, click the LC-11 to open its settings. There is a dropdown for each value
   ("T-bar", "Joystick A X", and so on). Pick the custom variable for each.
3. Move the control: the custom variable now follows it, and can be used in expressions, triggers and button text,
   for example `$(custom:tbar)`.

| Value | Range |
|---|---|
| T-bar | 0 to 255. The last few counts at each end read exactly 0 and 255. |
| Joystick A X / Y, Joystick B X / Y | 0 to 255, calibrated: exactly 128 at rest, exactly 0 and 255 at the ends. |

The direction of each axis is not documented, so check which way is which on your panel.

**T-bar LEDs.** The two LEDs by the T-bar light when the T-bar is all the way up or all the way down. They
stay dark until the T-bar has moved once after the surface connects, because the panel does not report its
position until it moves.

**Joystick calibration.** A raw stick never quite reaches 0 or 255, each axis reaches a different place, and a
released stick settles a few counts either side of the middle. So the values are calibrated: a small dead zone
around the centre reads exactly 128, and each side of each axis is scaled so full travel reads exactly 0 or 255.
The module starts with settings measured on one LC-11 and widens them automatically if a stick goes further.
For the best result, calibrate your own panel in the LC-11's settings on the **Surfaces** page:

1. Leave both sticks **at rest** and tick **Calibrate joysticks**.
2. Move each stick through its full range, around the edge and into the corners, a few times.
3. Let go so they rest in the middle, then **untick** it.

While it is ticked the values show the raw numbers. If a stick did not move far enough, it keeps its previous
calibration (a warning is written to the log). **Joystick dead zone (%)** in the same settings changes how far
from the centre a stick has to move before the value leaves 128 (default 5).

**Keeping the calibration after Companion restarts.** A module cannot store anything itself, but Companion can store
it for you, using a custom variable. Do this once:

1. Go to **Variables > Custom Variables** and add a variable named `lc11_calibration`. Tick **Persist value**.
2. In the LC-11's settings on the **Surfaces** page, set **Saved joystick calibration (write to)** to `lc11_calibration`.
3. In the same settings, type `$(custom:lc11_calibration)` into **Saved joystick calibration (read from)**.
4. Calibrate as above. When you untick **Calibrate joysticks**, the result is written to the variable, and Companion
   gives it back to the module every time it starts.

Without these two settings everything still works. The calibration just lasts until Companion restarts.

### Known limits

- **The backlights are on/off only.** The LC-11's LEDs have no colours or brightness. A button lights when
  its background colour in Companion is anything other than (near) black, for example from a feedback, and
  is off when the button is black. AUTO, TAKE and the knob presses have no LED. The two T-bar LEDs show the
  T-bar position (above). All LEDs are switched off when the surface is closed.
- The LC-11 is found by its USB manufacturer name ("NewTek"). On systems that report the generic driver
  name instead (commonly Windows, which says "FTDI"), it may not be detected.
- Tested on macOS with Companion 5.1. It is built so that Companion 5.0 accepts it too; if you try 5.0, please
  report how it goes.

### Troubleshooting

- *The surface does not appear:* unplug and replug the LC-11, then use **Scan for devices** on the
  Surfaces page.
- *"Failed to open ... is another program using the LC-11":* quit the other program.
- *Buttons do nothing:* make sure the button on that grid position has actions, and the surface is on the
  page you expect.
