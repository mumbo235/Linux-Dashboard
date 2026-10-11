"""Remember the admin password for a few minutes, like `sudo` does - but only for this dashboard.

The first admin command starts a small root helper with the real `pkexec` (one password prompt).
Commands the dashboard runs find a stand-in `pkexec` first on their PATH, which hands them to
that helper over a private socket. The helper quits after a few idle minutes, when you press
Lock, or when the dashboard closes. Nothing in the system configuration changes.
"""
import json
import os
import secrets
import socket
import subprocess
import threading
import time
from pathlib import Path

REAL_PKEXEC = "/usr/bin/pkexec"
RUNTIME = Path(os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}"))
SOCK = RUNTIME / "linux-dashboard-admin.sock"
SHIM_DIR = Path.home() / ".cache" / "linux-dashboard" / "bin"
TOKEN = secrets.token_urlsafe(24)

# Runs as root: executes the commands it's sent, streams their output back, quits when idle.
HELPER = r'''
import json, os, select, subprocess, sys, threading, time
idle = float(sys.argv[1])
env = {"PATH": "/usr/local/sbin:/usr/local/bin:/usr/bin", "LANG": "C.UTF-8", "HOME": "/root", "TERM": "dumb"}
lock = threading.Lock(); procs = {}; running = [0]; last = [time.time()]
def send(o):
    with lock:
        sys.stdout.write(json.dumps(o) + "\n"); sys.stdout.flush()
def run(req):
    rid = req["id"]
    try:
        p = subprocess.Popen(req["argv"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                             cwd=req.get("cwd") if os.path.isdir(req.get("cwd") or "") else "/", env=env, start_new_session=True)
    except OSError as e:
        send({"id": rid, "out": f"{e}\n"}); send({"id": rid, "exit": 127}); return
    procs[rid] = p
    for chunk in iter(lambda: p.stdout.read1(4096), b""):
        send({"id": rid, "out": chunk.decode(errors="replace")})
    code = p.wait(); procs.pop(rid, None)
    with lock:
        running[0] -= 1; last[0] = time.time()
    send({"id": rid, "exit": code})
send({"ready": True})
while True:
    r, _, _ = select.select([sys.stdin], [], [], 2)
    if r:
        line = sys.stdin.readline()
        if not line:
            break  # the dashboard closed
        req = json.loads(line)
        if req.get("quit"):
            break
        if req.get("kill"):
            p = procs.get(req["kill"])
            if p:
                os.killpg(p.pid, 15)
            continue
        with lock:
            running[0] += 1; last[0] = time.time()
        threading.Thread(target=run, args=(req,), daemon=True).start()
    elif running[0] == 0 and time.time() - last[0] > idle:
        break
for p in list(procs.values()):
    try: os.killpg(p.pid, 15)
    except OSError: pass
'''

SHIM = f'''#!/usr/bin/python3
# Linux Dashboard: stands in for pkexec in commands the dashboard runs, so one password
# unlocks admin commands for a few minutes. Anything unusual goes to the real pkexec.
import json, os, socket, sys
REAL = "{REAL_PKEXEC}"
args = sys.argv[1:]
sock, tok = os.environ.get("DASHBOARD_ADMIN_SOCK"), os.environ.get("DASHBOARD_ADMIN_TOKEN")
if not sock or not tok or not args or args[0].startswith("-"):
    os.execv(REAL, [REAL] + args)
try:
    s = socket.socket(socket.AF_UNIX); s.connect(sock)
except OSError:
    os.execv(REAL, [REAL] + args)
s.sendall((json.dumps({{"token": tok, "argv": args, "cwd": os.getcwd()}}) + "\\n").encode())
for line in s.makefile("rb"):
    m = json.loads(line)
    if "out" in m:
        sys.stdout.write(m["out"]); sys.stdout.flush()
    elif "exit" in m:
        sys.exit(m["exit"])
sys.exit(1)
'''


class AdminSession:
    def __init__(self):
        self.idle = 300  # seconds; 0 = ask every time, -1 = until the dashboard closes
        self.proc = None
        self.lock = threading.Lock()
        self.wlock = threading.Lock()
        self.waiters = {}  # request id -> callback(msg)
        self.last = 0.0
        self.busy = 0
        self.starting = None

    # ----- the root helper -----
    def _start(self):
        idle = 86400 * 7 if self.idle < 0 else max(30, self.idle)
        p = subprocess.Popen([REAL_PKEXEC, "/usr/bin/python3", "-c", HELPER, str(idle)],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)
        first = p.stdout.readline()  # blocks while the password box is open
        if '"ready"' not in first:
            p.wait()
            return None
        threading.Thread(target=self._reader, args=(p,), daemon=True).start()
        return p

    def _reader(self, p):
        for line in p.stdout:
            try:
                m = json.loads(line)
            except json.JSONDecodeError:
                continue
            cb = self.waiters.get(m.get("id"))
            if cb:
                cb(m)
        with self.lock:  # helper ended (idle, locked, or killed)
            if self.proc is p:
                self.proc = None
            for cb in list(self.waiters.values()):
                cb({"exit": 126, "out": ""})
            self.waiters.clear()

    def ensure(self):
        with self.lock:
            if self.proc and self.proc.poll() is None:
                return True
            if self.starting is None:
                self.starting = threading.Event()
                owner = True
            else:
                owner, ev = False, self.starting
        if not owner:  # someone else is already asking for the password
            ev.wait(300)
            return bool(self.proc and self.proc.poll() is None)
        p = self._start()
        with self.lock:
            self.proc = p
            self.last = time.time()
            ev, self.starting = self.starting, None
        ev.set()
        return p is not None

    def run(self, argv, cwd, emit, rid=None):
        """Run argv as root through the helper; emit(text) for output. Returns the exit code."""
        if not self.ensure():
            emit("Administrator password was not entered.\n")
            return 126
        rid = rid or secrets.token_hex(8)
        done = threading.Event()
        result = {"code": 1}

        def cb(m):
            if "out" in m and m["out"]:
                try:
                    emit(m["out"])
                except OSError:  # whoever asked has gone (e.g. Stop was pressed): stop the command too
                    self.kill(rid)
            if "exit" in m:
                result["code"] = m["exit"]
                done.set()
        self.waiters[rid] = cb
        with self.lock:
            self.busy += 1
        try:
            with self.wlock:
                self.proc.stdin.write(json.dumps({"id": rid, "argv": argv, "cwd": cwd}) + "\n")
                self.proc.stdin.flush()
            done.wait()
        except (OSError, AttributeError, ValueError):
            emit("The admin helper stopped unexpectedly.\n")
            result["code"] = 126
        finally:
            self.waiters.pop(rid, None)
            with self.lock:
                self.busy -= 1
                self.last = time.time()
        return result["code"]

    def kill(self, rid):
        try:
            with self.wlock:
                self.proc.stdin.write(json.dumps({"kill": rid}) + "\n")
                self.proc.stdin.flush()
        except (OSError, AttributeError, ValueError):
            pass

    def end(self):
        with self.lock:
            p, self.proc = self.proc, None
        if p and p.poll() is None:
            try:
                with self.wlock:
                    p.stdin.write(json.dumps({"quit": True}) + "\n")
                    p.stdin.flush()
            except OSError:
                pass

    def status(self):
        active = bool(self.proc and self.proc.poll() is None)
        left = None
        if active and self.idle > 0:
            left = 0 if self.busy else max(0, int(self.idle - (time.time() - self.last)))
            if left == 0 and not self.busy:
                active = False
        return {"active": active, "left": left, "idle": self.idle, "busy": self.busy}

    # ----- the private socket the stand-in pkexec talks to -----
    def serve(self):
        SHIM_DIR.mkdir(parents=True, exist_ok=True)
        shim = SHIM_DIR / "pkexec"
        shim.write_text(SHIM)
        shim.chmod(0o755)
        try:
            SOCK.unlink()
        except FileNotFoundError:
            pass
        srv = socket.socket(socket.AF_UNIX)
        old = os.umask(0o177)  # socket readable by this user only
        srv.bind(str(SOCK))
        os.umask(old)
        srv.listen(8)
        threading.Thread(target=self._accept, args=(srv,), daemon=True).start()

    def _accept(self, srv):
        while True:
            conn, _ = srv.accept()
            threading.Thread(target=self._client, args=(conn,), daemon=True).start()

    def _client(self, conn):
        with conn:
            try:
                req = json.loads(conn.makefile("rb").readline())
            except (json.JSONDecodeError, OSError):
                return
            if not secrets.compare_digest(str(req.get("token", "")), TOKEN) or not isinstance(req.get("argv"), list):
                return
            send = lambda o: conn.sendall((json.dumps(o) + "\n").encode())
            rid, finished = secrets.token_hex(8), threading.Event()

            def watch():  # the stand-in pkexec never sends more, so recv() only returns when it's gone (e.g. Stop)
                try:
                    conn.recv(1)
                except OSError:
                    pass
                if not finished.is_set():
                    self.kill(rid)
            threading.Thread(target=watch, daemon=True).start()
            try:
                code = self.run([str(a) for a in req["argv"]], str(req.get("cwd") or "/"), lambda t: send({"out": t}), rid=rid)
                finished.set()
                send({"exit": code})
            except OSError:
                pass
            finally:
                finished.set()

    def env(self):
        """Extra environment for commands the dashboard runs."""
        if self.idle == 0:
            return {}
        return {"PATH": f"{SHIM_DIR}:{os.environ.get('PATH', '/usr/bin')}",
                "DASHBOARD_ADMIN_SOCK": str(SOCK), "DASHBOARD_ADMIN_TOKEN": TOKEN}


SESSION = AdminSession()
