#!/usr/bin/env python3
"""
LC-11 serial tap: sits between Central Control and the real LC-11 and logs what the host sends.

  Central Control  <-->  virtual port (this script)  <-->  real LC-11

Usage:
  python3 lc11_tap.py --serial /dev/cu.usbserial-FT0A1B2C --log ~/lc11_tx.log
Then choose the printed virtual path in Central Control's COM Port list. If the list only shows existing
ports, create a link inside /dev so it appears there (needs sudo; the link disappears when you stop):
  sudo python3 lc11_tap.py --serial /dev/cu.usbserial-FT0A1B2C --link /dev/cu.lc11tap --log ~/lc11_tx.log
then restart Central Control so it rescans, and pick /dev/cu.lc11tap.
Type a label + Enter at any time to put a marker in the log (eg "Effects 1 on").
Ctrl-C to stop. Quit Companion / other LC-11 programs first: only one program can own the port.
"""
import argparse, os, select, sys, time, tty, termios

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--serial", required=True, help="real LC-11 port, eg /dev/cu.usbserial-FT0A1B2C")
    ap.add_argument("--baud", type=int, default=9600)
    ap.add_argument("--log", default="lc11_tx.log")
    ap.add_argument("--link", default=os.path.expanduser("~/lc11-virtual"), help="symlink to create for the virtual port")
    ap.add_argument("--log-rx", action="store_true", help="also log panel->host bytes (button presses)")
    a = ap.parse_args()

    rfd = os.open(a.serial, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
    tty.setraw(rfd)
    attrs = termios.tcgetattr(rfd)
    speed = getattr(termios, f"B{a.baud}")
    attrs[4] = attrs[5] = speed          # input / output speed
    attrs[2] |= termios.CLOCAL | termios.CREAD
    termios.tcsetattr(rfd, termios.TCSANOW, attrs)
    master, slave = os.openpty()
    tty.setraw(slave)
    slave_name = os.ttyname(slave)
    os.chmod(slave_name, 0o666)   # so an app running as you can open it even when this script runs under sudo
    try:
        os.unlink(a.link)
    except FileNotFoundError:
        pass
    try:
        os.symlink(slave_name, a.link)
    except OSError as e:
        sys.exit(f"Could not create {a.link}: {e}. (For a link inside /dev, run this script with sudo.)")
    # keep `slave` open for our whole run so the master never sees EIO when the app closes/reopens it

    log = open(os.path.expanduser(a.log), "a", buffering=1)
    t0 = time.time()
    def emit(kind, text):
        line = f"{time.time()-t0:9.3f} {kind} {text}"
        log.write(line + "\n"); print(line, flush=True)
    def fmt(b):
        return b.hex(" ") + "   |" + "".join(chr(c) if 32 <= c < 127 else "." for c in b) + "|"

    print(f"Virtual port: {a.link}  ->  {slave_name}")
    print(f"Use either path in Central Control's COM Port field. Logging to {a.log}")
    print("Type a label and press Enter to mark the log. Ctrl-C to stop.\n")
    while True:
        r, _, _ = select.select([master, rfd, sys.stdin], [], [], 1.0)
        if master in r:   # host -> panel
            try: data = os.read(master, 4096)
            except OSError: data = b""
            if data:
                os.write(rfd, data); emit("TX", fmt(data))
        if rfd in r:      # panel -> host
            try: data = os.read(rfd, 4096)
            except BlockingIOError: data = b""
            if data:
                os.write(master, data)
                if a.log_rx: emit("RX", fmt(data))
        if sys.stdin in r:
            line = sys.stdin.readline()
            if not line: sys.stdin = open(os.devnull)
            elif line.strip(): emit("##", line.strip())

if __name__ == "__main__":
    link = None
    for i, arg in enumerate(sys.argv):
        if arg == "--link" and i + 1 < len(sys.argv): link = sys.argv[i + 1]
        if arg.startswith("--link="): link = arg.split("=", 1)[1]
    try: main()
    except KeyboardInterrupt: print("\nstopped")
    finally:
        if link and os.path.islink(os.path.expanduser(link)):
            os.unlink(os.path.expanduser(link))
