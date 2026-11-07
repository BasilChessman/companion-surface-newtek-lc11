#!/usr/bin/env python3
"""
LC-11 LED probe, phase 1: which command format controls the LEDs, and is a 0 or a 1 "on"?

Each step sends the SAME value to every command ID (0-9, A-F) using one prefix (~ or ^) and one
message layout, so if that layout works the whole panel should go uniformly ALL ON or ALL OFF.
That makes every step easy to read, with nothing left over from the previous one.

  python3 lc11_probe_phase1.py --serial /dev/cu.usbserial-FT0A1B2C

Unplug and replug the panel before starting, so you begin from a known state.
At each step look at the panel and type what you see, then Enter:
   a = ALL LEDs on     o = ALL LEDs off     s = SOME changed (type which, eg "s effects row")     n = nothing changed
(Any text is fine; it is saved in the log. Enter alone = "no change". r = resend, b = back, q = quit.)
Quit Companion, Central Control and the Python bridge first (only one program may use the port).
"""
import argparse, os, select, sys, termios, time, tty

IDS = "0123456789ABCDEF"

def steps(term):
    out = []
    for prefix in "~^":
        for layout in ("3 digits", "2 digits", "split 2+1"):
            for value in ("zeros", "ones", "zeros"):
                d = "0" if value == "zeros" else "F"
                msgs = []
                for i in IDS:
                    if layout == "3 digits":   msgs.append(f"{prefix}{i}{d*3}{term}".encode())
                    elif layout == "2 digits": msgs.append(f"{prefix}{i}{d*2}{term}".encode())
                    else:                      msgs.append(f"{prefix}{i}{d*2}\r{d}\r".encode())
                out.append((f"prefix {prefix}   layout {layout:<10}  value {value}", msgs))
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--serial", required=True)
    ap.add_argument("--baud", type=int, default=9600)
    ap.add_argument("--term", default="\r")
    ap.add_argument("--gap", type=float, default=0.03, help="seconds between messages")
    ap.add_argument("--log", default="lc11_probe_phase1.log")
    a = ap.parse_args()
    term = a.term.encode().decode("unicode_escape")

    fd = os.open(a.serial, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
    tty.setraw(fd)
    attrs = termios.tcgetattr(fd)
    attrs[4] = attrs[5] = getattr(termios, f"B{a.baud}")
    attrs[2] |= termios.CLOCAL | termios.CREAD
    termios.tcsetattr(fd, termios.TCSANOW, attrs)

    log = open(os.path.expanduser(a.log), "a", buffering=1)
    def say(s): print(s, flush=True); log.write(s + "\n")
    plan = steps(term)

    def drain():
        try: rx = os.read(fd, 4096)
        except BlockingIOError: return
        if rx: say(f"        REPLY {rx.hex(' ')}  |{''.join(chr(c) if 32 <= c < 127 else '.' for c in rx)}|")

    def send(n):
        label, msgs = plan[n - 1]
        say(f"\n#{n}/{len(plan)}  {label}")
        say(f"   first message: {msgs[0].hex(' ')}   (sent to all {len(msgs)} IDs)")
        for m in msgs:
            os.write(fd, m); time.sleep(a.gap); drain()

    say(f"--- phase 1 start {time.strftime('%H:%M:%S')} ---")
    n = 1; send(n)
    while True:
        sys.stdout.write("  What do the LEDs show? [a=all on, o=all off, s=some, n/Enter=no change, r=resend, b=back, q=quit] > "); sys.stdout.flush()
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
        say(f"   RESULT #{n}: {cmd or 'no change'}")
        if n >= len(plan): break
        n += 1; send(n)
    say("--- done ---")

if __name__ == "__main__":
    try: main()
    except KeyboardInterrupt: print("\nstopped")
