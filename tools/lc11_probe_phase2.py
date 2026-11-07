#!/usr/bin/env python3
"""
LC-11 LED probe, phase 2: verify the LED map one LED at a time.

Hypothesis from phase 1: the host->panel LED commands use the same IDs and bit positions as the
panel's button messages, active-low (a 0 bit lights the LED). Before every step this script switches
everything OFF, then lights ONE predicted LED, so there is nothing left over to confuse you.

  python3 lc11_probe_phase2.py --serial /dev/cu.usbserial-FT0A1B2C

At each step the screen says which LED it EXPECTS to light. Then:
   Enter   = exactly that LED (and only that one) lit
   n       = nothing lit
   text    = something else lit: say what (eg "Live 4" or "Effects 3 and 4")
   r = resend, b = back, q = quit
Quit Companion, Central Control and the Python bridge first (only one program may use the port).
Options: --part A (the predicted map, 49 steps), --part B (a few unexplored IDs, 9 steps); default both.
"""
import argparse, os, select, sys, termios, time, tty

IDS = "0123456789ABCDEF"
COLS = ["1", "2", "3", "4", "5", "6", "EXT", "DDR 1", "DDR 2", "TXT", "BKG"]

def part_a():
    steps = []
    for rid, name in (("F", "Effects"), ("2", "Live"), ("1", "Preview")):
        for c, col in enumerate(COLS):
            bit = 11 - c
            steps.append((f"{name} row, button {col}", f"~{rid}{(0xFFF & ~(1 << bit)):03X}"))
    for bit, name in ((7, "Fade Overlay"), (6, "Take Overlay"), (5, "Fade All"), (4, "Take All"),
                      (3, "AUTO"), (2, "(unused bit 2, maybe a T-bar LED?)"), (1, "TAKE"), (0, "(unused bit 0, maybe a T-bar LED?)")):
        steps.append((name, f"~3{(0xFF & ~(1 << bit)):02X}"))
    for bit, name in ((7, "Fade"), (6, "FX")):
        steps.append((name, f"^F{(0xFF & ~(1 << bit)):02X}"))
    for bit, name in ((7, "FTB"), (6, "Alt"), (5, "Overlay EXT"), (4, "Overlay DDR 1"), (3, "Overlay DDR 2"), (2, "Overlay TXT")):
        steps.append((name, f"^1{(0xFF & ~(1 << bit)):02X}"))
    return steps

def part_b():
    out = []
    for p, i in [("~", "0")] + [("~", x) for x in "456789"] + [("^", "0"), ("^", "2")]:
        out.append((f"UNEXPLORED id {p}{i}, all bits 0 (lights whatever it controls)", f"{p}{i}000"))
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--serial", required=True)
    ap.add_argument("--baud", type=int, default=9600)
    ap.add_argument("--part", choices=["A", "B", "all"], default="all")
    ap.add_argument("--gap", type=float, default=0.02)
    ap.add_argument("--log", default="lc11_probe_phase2.log")
    a = ap.parse_args()

    fd = os.open(a.serial, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
    tty.setraw(fd)
    at = termios.tcgetattr(fd)
    at[4] = at[5] = getattr(termios, f"B{a.baud}")
    at[2] |= termios.CLOCAL | termios.CREAD
    termios.tcsetattr(fd, termios.TCSANOW, at)

    log = open(os.path.expanduser(a.log), "a", buffering=1)
    def say(s): print(s, flush=True); log.write(s + "\n")
    plan = (part_a() if a.part in ("A", "all") else []) + (part_b() if a.part in ("B", "all") else [])

    def drain():
        try: rx = os.read(fd, 4096)
        except BlockingIOError: return
        if rx: say(f"        REPLY {rx.hex(' ')}  |{''.join(chr(c) if 32 <= c < 127 else '.' for c in rx)}|")
    def write(msg):
        os.write(fd, msg.encode() + b"\r"); time.sleep(a.gap); drain()
    def send(n):
        label, msg = plan[n - 1]
        for p in "~^":
            for i in IDS: write(f"{p}{i}FFF")          # everything off
        time.sleep(0.15)
        say(f"\n#{n}/{len(plan)}  EXPECT: {label}      sent {msg}")
        write(msg)

    say(f"--- phase 2 start {time.strftime('%H:%M:%S')} ---")
    n = 1; send(n)
    while True:
        sys.stdout.write("  [Enter=as expected, n=nothing, or type what lit; r=resend, b=back, q=quit] > "); sys.stdout.flush()
        while True:
            r, _, _ = select.select([fd, sys.stdin], [], [], 0.2)
            if fd in r: drain()
            if sys.stdin in r: break
        line = sys.stdin.readline()
        if not line: break
        cmd = line.strip()
        if cmd == "q": break
        if cmd == "r": send(n); continue
        if cmd == "b": n = max(1, n - 1); send(n); continue
        say(f"   RESULT #{n}: {cmd or 'as expected'}")
        if n >= len(plan): break
        n += 1; send(n)
    say("--- done ---")

if __name__ == "__main__":
    try: main()
    except KeyboardInterrupt: print("\nstopped")
