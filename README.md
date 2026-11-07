# Companion module: NewTek LC-11

A [Bitfocus Companion](https://bitfocus.io/companion) surface module for the **NewTek TriCaster LC-11
(LiveControl)** control surface. It lets you use the LC-11 as a Companion surface: every button, the five
push-knobs, the T-bar and both joysticks, with the panel's LEDs following your button colours.

> **Status: early (0.1.0).** Developed and tested on macOS with Companion 5.1 and one LC-11. It is built against surface API 1.3, so
> Companion 5.0 should work too, but that is not yet confirmed. Reports from
> other systems and panels are very welcome, please open an issue.

## What works

- All 52 buttons (the Effects, Live and Preview rows, AUTO, TAKE, Fade, FX, FTB, Alt, Fade All, Take All,
  the Overlay buttons and the five knob presses).
- The five knobs as Companion rotary actions (left/right).
- T-bar and joysticks as Companion variables, 0 to 255. The joysticks are calibrated (exactly 128 at rest,
  exactly 0 and 255 at the ends, with a dead zone), and there is a calibration option in the surface settings. The result can be kept across restarts in a persistent custom variable (see the help page).
- Button LEDs, on or off: a button lights when its colour in Companion is not black.
- The two T-bar LEDs light when the T-bar is all the way up or all the way down.

Not supported: AUTO and TAKE have no LED on this panel, and the joysticks' Z axis / twist has not been seen
(the panel only sent X and Y).

## Installing

Needs Companion 5.0 or newer (built on surface API 1.3, which Companion 5.0 and 5.1 both accept).

1. Download the `.tgz` package from the [Releases](../../releases) page.
2. In Companion, open the modules page and choose **Import module package**, then pick the file.
3. Plug in the LC-11. It appears under **Surfaces**.

Only one program can use the panel at a time: quit Central Control, the TriCaster software and any other
bridge first. More detail, including how to switch on rotary actions for the knobs, is in
[companion/HELP.md](companion/HELP.md).

## How it works

The LC-11 is a plain USB serial device (an FTDI FT232 chip, 9600 baud). [PROTOCOL.md](PROTOCOL.md)
documents the messages in both directions, including the LED commands. The `tools/` folder holds the small
Python scripts used to work the protocol out.

## Building it yourself

Needs Node.js 22 and Yarn 4.

```
yarn install
yarn test
yarn package      # writes newtek-lc11-<version>.tgz
```

### Notes for developers

The module is built against the oldest surface API that current Companion releases accept (`@companion-surface/base`
1.3.x), so one package works in 5.0 and 5.1. Because of that it turns knobs with one `rotateLeftById` /
`rotateRightById` call per click (1.3 has no `rotateById(delta)`). The test suite also pulls in the newer base
package under the name `@companion-surface/base-latest`, only to reuse its layout validator.

## Licence

MIT. See [LICENSE](LICENSE). This project is not affiliated with or endorsed by NewTek, Vizrt or Bitfocus.
