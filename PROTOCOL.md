# NewTek LC-11 serial protocol

Worked out by capturing a real LC-11 and probing its LEDs. Everything here was observed on one panel, so
treat it as "verified on my hardware", not as an official specification.

## Connection

- USB device 0403:6001 (FTDI FT232), manufacturer string "NewTek". Not HID. It appears as a serial port,
  for example `/dev/cu.usbserial-XXXXXXXX` on macOS.
- 9600 baud, 8 data bits, no parity, 1 stop bit, no flow control.
- Every message is ASCII, starts with `~` or `^`, then one id character, then hex digits, and ends with CR
  (0x0D).
- Buttons and LEDs are both **active-low**: a button reads 0 while held, and a 0 bit lights an LED.

## Panel to host

| Message | Meaning |
| --- | --- |
| `~F nn CR n CR` | Effects row. 12-bit value: bit 11 = button 1 ... bit 1 = BKG. The third hex digit arrives as its own CR-terminated line. Columns: 1 2 3 4 5 6 EXT DDR1 DDR2 TXT BKG |
| `~2 nn CR n CR` | Live row, same layout |
| `~1 nn CR n CR` | Preview row, same layout |
| `~3 nn` | bit 7 Fade Overlay, 6 Take Overlay, 5 Fade All, 4 Take All, 3 AUTO, 1 TAKE |
| `~4 hh` | T-bar position, 0 to 255 |
| `~5 hh` ... `~9 hh` | Knob counters (8-bit, wrapping): DDR1, DDR2, TXT, SPEED, FX. Falls when turned left, rises when turned right. Single-tick reversals happen (encoder jitter). |
| `^F nn` | bit 7 Fade, bit 6 FX |
| `^2 nn` | Knob presses: bit 7 Speed, 6 FX, 5 DDR1, 4 DDR2, 3 TXT |
| `^1 nn` | bit 7 FTB, 6 Alt, 5 Overlay EXT, 4 Overlay DDR1, 3 Overlay DDR2, 2 Overlay TXT |
| `^5 xxyy` | Joystick A, X then Y, 0 to 255 (rest about 0x80) |
| `^7 xxyy` | Joystick B |

Bit numbers above are for the 8-bit value; for the rows the value has 12 bits.

## Host to panel (LEDs)

Same ids and bit positions as the button messages above, one line per group, CR-terminated. A **0** bit
lights the LED, a **1** bit turns it off. The rows need all three hex digits in one line; the 8-bit groups
need two.

| Command | LEDs |
| --- | --- |
| `~F fff`, `~2 fff`, `~1 fff` | Effects, Live, Preview rows, bit 11 = button 1 ... bit 1 = BKG (bit 0 unused) |
| `~3 ff` | bit 7 Fade Overlay, 6 Take Overlay, 5 Fade All, 4 Take All, **bit 2 T-bar "down" LED, bit 0 T-bar "up" LED** |
| `^F ff` | bit 7 Fade, bit 6 FX |
| `^1 ff` | bit 7 FTB, 6 Alt, 5 Overlay EXT, 4 Overlay DDR1, 3 Overlay DDR2, 2 Overlay TXT |

Examples (all LEDs are single-colour on/off):

- `~F7FF` lights Effects button 1 only; `~FFFF` turns the whole Effects row off.
- `~2FFD` lights the Live BKG button.
- `^1DF` lights Overlay EXT.

Notes:

- AUTO and TAKE have no LED (bits 3 and 1 of `~3` do nothing).
- The panel keeps each LED's state until it is changed or the panel is unplugged, so switch everything off
  when you are done.
- `^2` with LED data lights the same LEDs as `^1`; it is not needed.
- Not found: any reply or acknowledgement from the panel to a host command.
