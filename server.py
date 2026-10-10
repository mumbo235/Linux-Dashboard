#!/usr/bin/env python3
"""Linux Dashboard - a local web UI for things you'd normally do in a terminal.

Only listens on 127.0.0.1 and every API call needs a secret token that is
generated at startup, so other machines / websites can't run commands.
"""
import json
import os
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import uuid
import re
import tempfile
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import assistant
import controls
import vmtemplates
import harm
import tickets
import ai_providers as ai
import platform_info as plat
from rootsession import SESSION as ADMIN

VERSION = "alpha"  # the real one is read from the VERSION file below
# Programs that ship with the system (virt-manager, many KDE/GNOME tools) start with "#!/usr/bin/env python3".
# With Homebrew's folders first, that picks Homebrew's Python, which lacks the system libraries, and the app
# crashes. So everything the dashboard runs looks in the system folders first and Homebrew's last.
_dirs = os.environ.get("PATH", "/usr/bin").split(":")
os.environ["PATH"] = ":".join([d for d in _dirs if "linuxbrew" not in d] + [d for d in _dirs if "linuxbrew" in d])

HOST = "127.0.0.1"
PORT = int(os.environ.get("DASHBOARD_PORT", "8765"))
APP_DIR = Path(__file__).resolve().parent
WEB_DIR = APP_DIR / "web"
try:  # e.g. "alpha 0.4": `bash build.sh --bump` raises it by 0.1 for each major update
    VERSION = (APP_DIR / "VERSION").read_text().strip() or VERSION
except OSError:
    pass
THUMB_DIR = Path.home() / ".cache" / "linux-dashboard" / "thumbs"
MIME = {".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".svg": "image/svg+xml"}
CONFIG_DIR = Path.home() / ".config" / "linux-dashboard"
FAVORITES_FILE = CONFIG_DIR / "favorites.json"
SETTINGS_FILE = CONFIG_DIR / "settings.json"
TOKEN = secrets.token_urlsafe(24)

JOBS = {}  # job id -> Popen
JOBS_LOCK = threading.Lock()

RUN_ENV = dict(os.environ, NO_COLOR="1", TERM="dumb", PAGER="cat", SYSTEMD_PAGER="",
               SYSTEMD_COLORS="0", LANG=os.environ.get("LANG", "C.UTF-8"))


def sh(cmd, timeout=20):
    """Run a command quickly and return stdout (empty string on failure)."""
    try:
        return subprocess.run(cmd, shell=isinstance(cmd, str), capture_output=True, text=True,
                              timeout=timeout, env=RUN_ENV).stdout
    except Exception:
        return ""


def read(path, default=""):
    try:
        return Path(path).read_text().strip()
    except Exception:
        return default


# ---------- system stats ----------

_last_cpu = None


def cpu_percent():
    global _last_cpu
    parts = [int(x) for x in read("/proc/stat").splitlines()[0].split()[1:]]
    idle, total = parts[3] + parts[4], sum(parts)
    prev, _last_cpu = _last_cpu, (idle, total)
    if not prev:
        time.sleep(0.2)
        return cpu_percent()
    d_total = total - prev[1]
    return round(100 * (1 - (idle - prev[0]) / d_total), 1) if d_total else 0.0


def meminfo():
    info = {}
    for line in read("/proc/meminfo").splitlines():
        k, v = line.split(":", 1)
        info[k] = int(v.split()[0]) * 1024
    return info


def temperature():
    best = None
    for hw in Path("/sys/class/hwmon").glob("hwmon*"):
        name = read(hw / "name")
        if name in ("coretemp", "k10temp", "zenpower", "cpu_thermal", "applesmc"):
            for t in sorted(hw.glob("temp*_input")):
                try:
                    return round(int(read(t)) / 1000, 1)
                except ValueError:
                    pass
    for z in Path("/sys/class/thermal").glob("thermal_zone*"):
        try:
            v = int(read(z / "temp")) / 1000
            best = max(best or 0, v)
        except ValueError:
            pass
    return round(best, 1) if best else None


def battery():
    for ps in Path("/sys/class/power_supply").glob("*"):
        if read(ps / "type") == "Battery":
            return {"percent": int(read(ps / "capacity", "0")), "status": read(ps / "status")}
    return None


_last_net = None


def net_rate():
    """Bytes/sec down and up across real interfaces since the previous call."""
    global _last_net
    rx = tx = 0
    for line in read("/proc/net/dev").splitlines()[2:]:
        name, data = line.split(":", 1)
        name = name.strip()
        if name == "lo" or name.startswith(("virbr", "vnet", "docker", "veth", "br-")):
            continue
        f = data.split()
        rx += int(f[0])
        tx += int(f[8])
    now = time.time()
    prev, _last_net = _last_net, (now, rx, tx)
    if not prev or now - prev[0] <= 0:
        return 0, 0
    dt = now - prev[0]
    return max(0, (rx - prev[1]) / dt), max(0, (tx - prev[2]) / dt)


def hwmon_value(chip, prefix):
    for hw in Path("/sys/class/hwmon").glob("hwmon*"):
        if read(hw / "name") == chip or read(hw / "device" / "name") == chip:
            base = hw if (hw / f"{prefix}_input").exists() else hw / "device"
            try:
                return int(read(base / f"{prefix}_input"))
            except ValueError:
                return None
    return None


def stats():
    mem = meminfo()
    down, up_ = net_rate()
    gpu = hwmon_value("amdgpu", "temp1")
    fan = hwmon_value("applesmc", "fan1")
    disk = shutil.disk_usage("/")
    home = shutil.disk_usage(str(Path.home()))
    up = float(read("/proc/uptime", "0").split()[0])
    load = read("/proc/loadavg").split()[:3]
    ips = []
    for line in sh(["ip", "-4", "-o", "addr", "show", "scope", "global"]).splitlines():
        f = line.split()
        ips.append({"iface": f[1], "ip": f[3].split("/")[0]})
    os_name = "Linux"
    for line in read("/etc/os-release").splitlines():
        if line.startswith("PRETTY_NAME="):
            os_name = line.split("=", 1)[1].strip('"')
    return {
        "hostname": socket.gethostname(),
        "user": os.environ.get("USER", ""),
        "os": os_name,
        "kernel": os.uname().release,
        "cpu": cpu_percent(),
        "cores": os.cpu_count(),
        "load": load,
        "mem_total": mem.get("MemTotal", 0),
        "mem_used": mem.get("MemTotal", 0) - mem.get("MemAvailable", 0),
        "swap_total": mem.get("SwapTotal", 0),
        "swap_used": mem.get("SwapTotal", 0) - mem.get("SwapFree", 0),
        "disk_total": disk.total, "disk_used": disk.used,
        "home_total": home.total, "home_used": home.used,
        "same_disk": disk.total == home.total and disk.used == home.used,
        "uptime": up,
        "temp": temperature(),
        "battery": battery(),
        "ips": ips,
        "net_down": down, "net_up": up_,
        "gpu_temp": round(gpu / 1000) if gpu else None,
        "fan": fan,
    }


def diskinfo():
    def du(path, root=False):
        out = sh(["du", "-sb", path], 30).split()
        return int(out[0]) if out else 0
    return {
        "cache": du(str(Path.home() / ".cache")),
        "trash": du(str(Path.home() / ".local/share/Trash")),
        "pkgcache": du(plat.PKG["cache_dir"]) if plat.PKG["cache_dir"] else 0,
        "journal": sum(f.stat().st_size for f in Path("/var/log/journal").rglob("*.journal*") if f.is_file()) if os.access("/var/log/journal", os.R_OK) else 0,
        "orphans": plat.orphan_count(),
        "packages": plat.package_count(),
        "flatpaks": len(sh(["flatpak", "list", "--app", "--columns=application"]).split()),
        "failed": len(sh("systemctl --failed --no-legend --plain; systemctl --user --failed --no-legend --plain").splitlines()),
    }


THUMB_ROOTS = ("/usr/share/wallpapers/", "/usr/share/backgrounds/", str(Path.home() / "Pictures") + "/")


def thumbnail(path):
    """Small cached JPEG of a wallpaper so the gallery loads fast."""
    real = os.path.realpath(path)
    if not real.startswith(THUMB_ROOTS) or not real.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
        return None
    THUMB_DIR.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha1(f"{real}:{os.path.getmtime(real)}".encode()).hexdigest()
    out = THUMB_DIR / f"{key}.jpg"
    if not out.exists():
        import gi
        gi.require_version("GdkPixbuf", "2.0")
        from gi.repository import GdkPixbuf
        pb = GdkPixbuf.Pixbuf.new_from_file_at_scale(real, 360, 240, True)
        if pb.get_has_alpha():  # JPEG has no transparency: put the picture on a dark background first
            flat = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, False, 8, pb.get_width(), pb.get_height())
            flat.fill(0x1b1e20ff)
            pb.composite(flat, 0, 0, pb.get_width(), pb.get_height(), 0, 0, 1, 1, GdkPixbuf.InterpType.BILINEAR, 255)
            pb = flat
        pb.savev(str(out), "jpeg", ["quality"], ["82"])
    return out.read_bytes()


# ---------- structured lists ----------

def processes(sort="cpu"):
    key = "-%cpu" if sort == "cpu" else "-rss"
    out = sh(["ps", "-eo", "pid,user,%cpu,%mem,rss,comm,args", f"--sort={key}"])
    rows = []
    for line in out.splitlines()[1:62]:
        f = line.split(None, 6)
        if len(f) < 6:
            continue
        rows.append({"pid": int(f[0]), "user": f[1], "cpu": float(f[2]), "mem": float(f[3]),
                     "rss": int(f[4]) * 1024, "name": f[5], "args": f[6] if len(f) > 6 else f[5]})
    return rows


def services(scope="system"):
    base = ["systemctl", "--no-pager"] + (["--user"] if scope == "user" else [])
    try:
        units = json.loads(sh(base + ["list-units", "--type=service", "--all", "-o", "json"]) or "[]")
    except json.JSONDecodeError:
        units = []
    try:
        files = json.loads(sh(base + ["list-unit-files", "--type=service", "-o", "json"]) or "[]")
    except json.JSONDecodeError:
        files = []
    enabled = {f["unit_file"]: f["state"] for f in files}
    seen = set()
    rows = []
    for u in units:
        seen.add(u["unit"])
        rows.append({"unit": u["unit"], "active": u["active"], "sub": u["sub"],
                     "description": u["description"], "enabled": enabled.get(u["unit"], "")})
    for name, state in enabled.items():  # installed but never loaded
        if name not in seen and "@" not in name and state in ("enabled", "disabled"):
            rows.append({"unit": name, "active": "inactive", "sub": "dead", "description": "",
                         "enabled": state})
    return sorted(rows, key=lambda r: r["unit"].lower())


def wifi():
    out = sh(["nmcli", "-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY", "dev", "wifi", "list"])
    nets = {}
    for line in out.splitlines():
        f = line.replace("\\:", "\0").split(":")
        f = [x.replace("\0", ":") for x in f]
        if len(f) < 4 or not f[1]:
            continue
        n = {"active": f[0] == "*", "ssid": f[1], "signal": int(f[2] or 0), "security": f[3]}
        if f[1] not in nets or n["active"] or n["signal"] > nets[f[1]]["signal"]:
            nets[f[1]] = n
    devices = []
    for line in sh(["nmcli", "-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "dev", "status"]).splitlines():
        f = line.split(":")
        if len(f) >= 4 and f[1] not in ("loopback",):
            devices.append({"device": f[0], "type": f[1], "state": f[2], "connection": f[3]})
    radio = sh(["nmcli", "radio", "wifi"]).strip()
    return {"networks": sorted(nets.values(), key=lambda n: (-n["active"], -n["signal"])),
            "devices": devices, "wifi_radio": radio}


def pkg_search(q):
    if not q.strip():
        return []
    rows = plat.search(q)
    if shutil.which("flatpak"):
        out = sh(["flatpak", "search", "--columns=name,application,version,description", q], 30)
        installed = set(sh(["flatpak", "list", "--columns=application"]).split())
        for line in out.splitlines():
            f = line.split("\t")
            if len(f) >= 2 and "." in f[1]:
                rows.append({"repo": "flathub", "name": f[1], "version": f[2] if len(f) > 2 else "",
                             "desc": f"{f[0]} - {f[3] if len(f) > 3 else ''}",
                             "installed": f[1] in installed, "source": "flatpak"})
    ql = q.lower()
    rows.sort(key=lambda r: (r["name"].lower() != ql, ql not in r["name"].lower(), r["source"] == "aur"))
    return rows[:150]


def installed_pkgs():
    rows = plat.installed()
    for line in sh(["flatpak", "list", "--app", "--columns=name,application,version"]).splitlines():
        f = line.split("\t")
        if len(f) >= 2:
            rows.append({"name": f[1], "label": f[0], "version": f[2] if len(f) > 2 else "",
                         "source": "flatpak"})
    return sorted(rows, key=lambda r: (r.get("label") or r["name"]).lower())


def volume():
    out = sh(["wpctl", "get-volume", "@DEFAULT_AUDIO_SINK@"])
    try:
        v = float(out.split()[1])
    except (IndexError, ValueError):
        return {"volume": None, "muted": False}
    return {"volume": round(v * 100), "muted": "MUTED" in out}


def load_favorites():
    try:
        return json.loads(FAVORITES_FILE.read_text())
    except Exception:
        return [
            {"name": "What's using my disk space?", "cmd": "du -h -d1 ~ 2>/dev/null | sort -h | tail -15"},
            {"name": "My public IP address", "cmd": "curl -s https://ifconfig.me; echo"},
        ]


FONT_DIR = Path.home() / ".local/share/fonts/linux-dashboard"
FONT_EXT = (".ttf", ".otf", ".ttc", ".woff", ".woff2")


def fonts():
    fams = set()
    for line in sh(["fc-list", ":", "family"], 20).splitlines():
        name = line.split(",")[0].strip().replace("\\-", "-")
        if name and not name.startswith("."):
            fams.add(name)
    return sorted(fams, key=str.lower)


def add_font(path):
    """Copy a font file into ~/.local/share/fonts so every app (and this one) can use it."""
    src = Path(os.path.expanduser(str(path)))
    if not src.is_file() or src.suffix.lower() not in FONT_EXT:
        return {"error": "That isn't a font file (.ttf, .otf, .ttc, .woff or .woff2)."}
    FONT_DIR.mkdir(parents=True, exist_ok=True)
    dst = FONT_DIR / src.name
    shutil.copyfile(src, dst)
    sh(["fc-cache", "-f", str(FONT_DIR)], 60)
    fams = [f.split(",")[0].strip() for f in sh(["fc-scan", "--format", "%{family}\n", str(dst)]).splitlines() if f.strip()]
    if not fams:
        dst.unlink(missing_ok=True)
        return {"error": "Couldn't read a font from that file."}
    return {"family": fams[0], "file": str(dst), "cmd": f"cp {src} {dst} && fc-cache -f {FONT_DIR}"}


def about():
    """Facts for the About page."""
    import platform
    info = {"version": VERSION, "python": platform.python_version(), "port": PORT,
            "app_dir": str(APP_DIR), "config_dir": str(CONFIG_DIR)}
    try:
        import gi
        gi.require_version("Gtk", "4.0")
        gi.require_version("WebKit", "6.0")
        from gi.repository import Gtk, WebKit
        info["gtk"] = f"{Gtk.get_major_version()}.{Gtk.get_minor_version()}.{Gtk.get_micro_version()}"
        info["webkit"] = f"{WebKit.get_major_version()}.{WebKit.get_minor_version()}.{WebKit.get_micro_version()}"
    except Exception:
        pass
    st = ai.status()
    info["ai"] = st.get("label") if st.get("configured") else None
    s = stats()
    info.update(os=s["os"], kernel=s["kernel"], hostname=s["hostname"], user=s["user"], uptime=s["uptime"],
                desktop=f'{plat.DESKTOP_NAME} ({os.environ.get("XDG_SESSION_TYPE", "?")})', manager=plat.PKG["manager"] or "none",
                family=plat.FAMILY_NAME)
    info["counts"] = {"chats": len(assistant.list_chats()), "memory": len(assistant.load_memory()),
                      "favorites": len(load_favorites()), "suggestions": len(assistant.saved_suggestions().get("phrases", []))}
    info["lines"] = sum(len(f.read_text().splitlines()) for f in list(APP_DIR.glob("*.py")) + list(WEB_DIR.glob("*.*")) if f.suffix in (".py", ".js", ".css", ".html"))
    return info


def update_counts():
    """How many updates are waiting (checks a temporary copy of the package database, changes nothing)."""
    script = (f'R=$({plat.PKG["count_repo"]}); A=$({plat.PKG.get("count_aur") or "echo 0"}); '
              'F=$(flatpak remote-ls --updates --columns=application 2>/dev/null | sort -u | grep -c .); '
              'echo "${R:-0} ${A:-0} ${F:-0}"')
    parts = sh(["bash", "-c", script], 120).split()
    try:
        r, a, f = (int(x) for x in parts[:3])
    except ValueError:
        return {"error": "Couldn't check right now"}
    return {"repo": r, "aur": a, "flatpak": f, "total": max(0, r) + a + f, "offline": r < 0, "checked": time.strftime("%H:%M")}


PROFILE_FILE = CONFIG_DIR / "profile.json"
DOWNLOADS = Path(sh(["xdg-user-dir", "DOWNLOAD"]).strip() or Path.home() / "Downloads")


def scan_profile():
    """Look at the hardware and software once, so the dashboard (and the assistant) can fit this computer."""
    dmi = lambda k: read(f"/sys/class/dmi/id/{k}")
    lspci = sh(["lspci"])
    pci = lambda rx: [l.split(": ", 1)[-1].strip() for l in lspci.splitlines() if __import__("re").search(rx, l, __import__("re").I)]
    nm_types = sh(["nmcli", "-t", "-f", "TYPE", "dev"]).split()
    battery = any(read(p / "type") == "Battery" for p in Path("/sys/class/power_supply").glob("*"))
    product, vendor = dmi("product_name"), dmi("sys_vendor")
    kind = "laptop" if battery else "all-in-one" if product.lower().startswith("imac") else "desktop"
    has = lambda *names: [n for n in names if shutil.which(n)]
    pkgs = plat.installed_names() | set(sh(["flatpak", "list", "--app", "--columns=application"]).split())
    gaming = [n for n in ("steam", "lutris", "heroic-games-launcher-bin", "com.valvesoftware.Steam", "net.lutris.Lutris", "prismlauncher", "mangohud", "gamemode") if n in pkgs]
    dev = [n for n in ("git", "code", "docker", "podman", "python", "nodejs", "rustup", "go", "zed") if n in pkgs or shutil.which(n)]
    creative = [n for n in ("gimp", "krita", "inkscape", "blender", "kdenlive", "obs-studio", "audacity", "darktable") if n in pkgs]
    wifi_hw = pci(r"wireless|802\.11|wi-?fi|network controller")
    p = {
        "scanned": time.strftime("%Y-%m-%d %H:%M"),
        "vendor": vendor, "model": product, "kind": kind,
        "mac": "apple" in vendor.lower(), "t2": bool(pci(r"T2 ")) or "t2" in os.uname().release.lower(),
        "cpu": next((l.split(":", 1)[1].strip() for l in read("/proc/cpuinfo").splitlines() if l.startswith("model name")), "?"),
        "threads": os.cpu_count(), "ram_gb": round(meminfo().get("MemTotal", 0) / 1024 ** 3),
        "gpus": [g for g in (l.split(": ", 1)[-1].strip() for l in lspci.splitlines() if __import__("re").search(r"\bVGA compatible|3D controller|Display controller", l)) if "T2" not in g],
        "disks": [l.strip() for l in sh(["lsblk", "-dno", "SIZE,MODEL", "-e7,11"]).splitlines() if l.strip() and not l.strip().startswith("0B")],
        "wifi_hw": wifi_hw, "wifi": "wifi" in nm_types, "ethernet": "ethernet" in nm_types,
        "bluetooth": Path("/sys/class/bluetooth").exists() and any(Path("/sys/class/bluetooth").iterdir()),
        "battery": battery, "webcam": bool(list(Path("/dev").glob("video*"))),
        "pointers": [x["name"] for x in controls.ptrs()], "touchpad": any(x["touchpad"] for x in controls.ptrs()),
        "displays": len(controls.displays()), "fans": controls.SMC is not None,
        "governor": "performance" in read("/sys/devices/system/cpu/cpu0/cpufreq/scaling_available_governors"),
        "virt": bool(has("virsh")), "flatpak": bool(has("flatpak")), "aur": [plat.AUR] if plat.AUR else [],
        "distro": plat.PRETTY, "family": plat.FAMILY, "desk": plat.DESKTOP,
        "gaming": gaming, "dev": dev, "creative": creative,
        "desktop": os.environ.get("XDG_CURRENT_DESKTOP", "?"), "session": os.environ.get("XDG_SESSION_TYPE", "?"),
        "locale": os.environ.get("LANG", ""), "swap": meminfo().get("SwapTotal", 0) > 0,
    }
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    PROFILE_FILE.write_text(json.dumps(p, indent=1))
    return p


def load_profile():
    try:
        return json.loads(PROFILE_FILE.read_text())
    except Exception:
        return {}


APP_STARTED = time.time()


def platform_summary():
    p = plat.summary()
    p["controls"] = sorted(controls.CONTROLS)  # what this desktop supports; the page hides the rest
    p["features"] = sorted(controls.FEATURES)
    p["accents"] = list(controls.GNOME_ACCENTS.values()) if "accentNamed" in controls.FEATURES else []
    return p


PLATFORM = platform_summary()
SERVER_ERRORS = []  # recent server-side errors, for the developer panel


def record_error(where):
    import traceback
    SERVER_ERRORS.append({"at": time.strftime("%H:%M:%S"), "where": where, "trace": traceback.format_exc()[-3000:]})
    del SERVER_ERRORS[:-50]


def dev_prompt():
    """Exactly what the assistant is told (instructions, machine facts, memory)."""
    s = load_settings()
    system = (assistant.system_prompt()
              + assistant.STYLES.get(s.get("assistStyle", "short"), "") + (assistant.memory_prompt() if s.get("rememberChats", True) else ""))
    return {"system": system, "chars": len(system), "approx_tokens": len(system) // 4, "answer_fields": list(assistant.SCHEMA["properties"])}


def dev_clear_cache(what):
    done = []
    targets = {"thumbs": THUMB_DIR, "isos": controls.ISO_CACHE, "assistant": assistant.WORK_DIR}
    for k in (targets if what == "all" else [what]):
        p = targets.get(k)
        if p and p.exists():
            shutil.rmtree(p) if p.is_dir() else p.unlink()
            done.append(k)
    return {"cleared": done}


def dev_diagnostics(client):
    """One file with what's useful for a bug report (no chats, no notes, no passwords)."""
    s = {k: v for k, v in load_settings().items() if k not in ("name",)}
    data = {"app": "Linux Dashboard", "version": VERSION, "created": time.strftime("%Y-%m-%d %H:%M"), "dev": dev_info(),
            "profile": load_profile(), "settings": s, "server_errors": SERVER_ERRORS[-20:], "client": client}
    out = DOWNLOADS / f"linux-dashboard-diagnostics-{time.strftime('%Y%m%d-%H%M')}.json"
    out.write_text(json.dumps(data, indent=1, default=str))
    return {"path": str(out)}


def dev_info():
    """Numbers for the developer panel."""
    def rss(pid):
        try:
            return int(re.search(r"VmRSS:\s+(\d+)", Path(f"/proc/{pid}/status").read_text()).group(1)) * 1024
        except Exception:
            return 0
    me = os.getpid()
    kids = [int(p) for p in sh(["pgrep", "-P", str(me)]).split()]
    web = [int(p) for p in sh(["pgrep", "-f", "WebKitWebProcess|WebKitNetworkProcess"]).split()]
    files = {f.name: f.stat().st_size for f in sorted(list(APP_DIR.glob("*.py")) + list(WEB_DIR.glob("*.*")))}
    return {"pid": me, "port": PORT, "version": VERSION, "uptime": round(time.time() - APP_STARTED), "threads": threading.active_count(),
            "rss_app": rss(me), "rss_web": sum(rss(p) for p in web), "children": len(kids),
            "python": sys.version.split()[0], "files": files, "config": {f.name: f.stat().st_size for f in CONFIG_DIR.glob("*") if f.is_file()},
            "jobs": len(JOBS), "admin": ADMIN.status(), "env_path": os.environ.get("PATH", "")}


def notify(title, body=""):
    """Desktop notification (and optional sound) when a long task finishes."""
    sh(["notify-send", "--app-name=Linux Dashboard", "--icon=io.github.jarvis.LinuxDashboard", str(title)[:120], str(body)[:300]], 5)
    return {"ok": True}


def export_backup():
    """Save settings, saved commands and the assistant's notes to ~/Downloads."""
    data = {"app": "Linux Dashboard", "version": VERSION, "exported": time.strftime("%Y-%m-%d %H:%M"),
            "settings": load_settings(), "favorites": load_favorites(), "memory": assistant.load_memory()}
    out = Path(sh(["xdg-user-dir", "DOWNLOAD"]).strip() or Path.home() / "Downloads") / f"linux-dashboard-backup-{time.strftime('%Y-%m-%d')}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=2))
    return {"path": str(out)}


def load_settings():
    try:
        return json.loads(SETTINGS_FILE.read_text())
    except Exception:
        return {}


def save_settings(data):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(json.dumps(data, indent=2))


def save_favorites(favs):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    FAVORITES_FILE.write_text(json.dumps(favs, indent=2))


# ---------- HTTP ----------

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def log_message(self, *a):
        pass

    def _allowed(self):
        host = self.headers.get("Host", "")
        if host not in (f"127.0.0.1:{PORT}", f"localhost:{PORT}"):
            return False  # blocks DNS-rebinding tricks
        return True

    def _authed(self):
        return self._allowed() and secrets.compare_digest(self.headers.get("X-Token", ""), TOKEN)

    def _send(self, code, body, ctype="application/json"):
        try:
            data = body if isinstance(body, bytes) else (
                json.dumps(body) if ctype == "application/json" else body).encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype + "; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        if not self._allowed():
            return self._send(403, {"error": "forbidden"})
        url = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        if url.path in ("/", "/index.html"):
            html = (WEB_DIR / "index.html").read_text().replace("__TOKEN__", TOKEN).replace(
                '"__PLATFORM__"', json.dumps(PLATFORM).replace("</", "<\\/")).replace("__VERSION__", VERSION)
            return self._send(200, html, "text/html")
        if url.path.startswith("/web/"):
            f = WEB_DIR / Path(url.path).name
            if f.is_file() and f.suffix in MIME:
                return self._send(200, f.read_bytes(), MIME[f.suffix])
            return self._send(404, {"error": "not found"})
        if url.path == "/api/thumb" and secrets.compare_digest(q.get("t", ""), TOKEN):
            try:
                data = thumbnail(q.get("path", ""))
            except Exception:
                data = None
            return self._send(200, data, "image/jpeg") if data else self._send(404, {"error": "no thumb"})
        if not self._authed():
            return self._send(401, {"error": "bad token - reload the page"})
        routes = {
            "/api/stats": lambda: stats(),
            "/api/processes": lambda: processes(q.get("sort", "cpu")),
            "/api/services": lambda: services(q.get("scope", "system")),
            "/api/wifi": lambda: wifi(),
            "/api/pkgsearch": lambda: pkg_search(q.get("q", "")),
            "/api/installed": lambda: installed_pkgs(),
            "/api/volume": lambda: volume(),
            "/api/favorites": lambda: load_favorites(),
            "/api/settings": load_settings,
            "/api/chats": assistant.list_chats,
            "/api/chat": lambda: assistant.get_chat(q.get("id", "")),
            "/api/memory": assistant.load_memory,
            "/api/suggestions": assistant.saved_suggestions,
            "/api/fonts": fonts,
            "/api/admin/status": ADMIN.status,
            "/api/ai/status": ai.status,
            "/api/about": about,
            "/api/dev/info": dev_info,
            "/api/dev/errors": lambda: SERVER_ERRORS[::-1],
            "/api/defaultapps": controls.default_apps,
            "/api/profile": load_profile,
            "/api/isos": controls.isos,
            "/api/vm/limits": controls.vm_limits,
            "/api/vm/templates": lambda: vmtemplates.listing(DOWNLOADS),
            "/api/fan": controls.fan_state,
            "/api/fan/limitcmd": lambda: {"cmd": controls.fan_limit_cmd()},
            "/api/home": lambda: {"home": str(Path.home())},
            "/api/platform": lambda: PLATFORM,
            "/api/controls": controls.get_all,
            "/api/diskinfo": diskinfo,
            "/api/audio": controls.audio,
            "/api/displays": controls.displays,
            "/api/appearance": controls.appearance_options,
            "/api/timezones": controls.timezones,
            "/api/sensors": controls.sensors,
            "/api/vms": controls.vms,
            "/api/autostart": controls.autostart,
            "/api/bluetooth": controls.bluetooth_devices,
            "/api/drives": controls.drives,
            "/api/kdeconnect": controls.kdeconnect,
            "/api/app/update_check": controls.check_app_update,
            "/api/battery": controls.battery_info,
            "/api/battery_care": lambda: {"supported": controls.battery_care_supported(), "limit": controls.battery_care_get()},
            "/api/crashes": controls.list_crashes,
            "/api/crash/info": lambda: {"info": controls.crash_info(q.get("pid", 0))},
        }
        if url.path in routes:
            try:
                return self._send(200, routes[url.path]())
            except Exception as e:
                record_error("GET " + url.path)
                return self._send(500, {"error": str(e)})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        try:
            return self._do_post()
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            record_error("POST " + urlparse(self.path).path)
            try:
                self._send(500, {"error": str(e)})
            except OSError:
                pass

    def _do_post(self):
        if not self._authed():
            return self._send(401, {"error": "bad token - reload the page"})
        length = int(self.headers.get("Content-Length", 0))
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return self._send(400, {"error": "bad json"})
        path = urlparse(self.path).path
        if path == "/api/run":
            return self.run_stream(body)
        if path == "/api/stop":
            with JOBS_LOCK:
                p = JOBS.get(body.get("id"))
            if p:
                try:
                    os.killpg(p.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
            return self._send(200, {"ok": bool(p)})
        if path == "/api/control":
            return self.set_control(body)
        if path == "/api/app/update_apply":
            installer_url = str(body.get("url") or "").strip()
            if not installer_url or not installer_url.startswith("https://github.com/mumbo235/Linux-Dashboard/"):
                return self._send(400, {"error": "Invalid installer URL"})
            tmp_installer = Path("/tmp/linux-dashboard-update.sh")
            try:
                import urllib.request
                req = urllib.request.Request(installer_url, headers={"User-Agent": "Linux-Dashboard"})
                with urllib.request.urlopen(req, timeout=30) as resp:
                    tmp_installer.write_bytes(resp.read())
                tmp_installer.chmod(0o755)
                # Spawn in background so it can update the app
                subprocess.Popen(["bash", str(tmp_installer), "--yes"], cwd=str(Path.home()),
                                 stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
                return self._send(200, {"ok": True, "message": "Update started in background. App will update automatically."})
            except Exception as e:
                return self._send(500, {"error": f"Failed to download/run update: {e}"})
        if path == "/api/assist":
            return self._send(200, assistant.ask(body.get("messages", []), bool(body.get("memory", True)),
                                                body.get("effort", "medium"), body.get("style", "short"), body.get("model") or None))
        if path == "/api/ai/models":
            prov = str(body.get("provider", ""))
            if prov not in ai.PROVIDERS:
                return self._send(400, {"error": "unknown provider"})
            try:
                return self._send(200, {"models": ai.list_models(prov, body.get("key") or None, body.get("base_url") or None)})
            except ai.AIError as e:
                return self._send(200, {"error": str(e), "code": e.code})
        if path == "/api/ai/save":  # check the key and model work, then keep them
            prov = str(body.get("provider", ""))
            if prov not in ai.PROVIDERS:
                return self._send(400, {"error": "unknown provider"})
            key = str(body.get("key") or "").strip() or ai.get_key(prov)
            cfg = {"provider": prov, "model": str(body.get("model") or "").strip(), "base_url": str(body.get("base_url") or "").strip()}
            if not key and not ai.PROVIDERS[prov].get("nokey"):
                return self._send(200, {"error": "Paste your API key first."})
            try:
                info = ai.test(cfg, key)
            except ai.AIError as e:
                return self._send(200, {"error": str(e), "code": e.code})
            where = ai.set_key(prov, key) if key and body.get("key") else None
            ai.save(cfg)
            try:
                ai.refresh_models()
            except Exception:  # the menu just shows the chosen model until the list loads
                record_error("refresh models")
            return self._send(200, {"ok": True, "where": where, "model": info.get("model"), "seconds": info.get("seconds"), "status": ai.status()})
        if path in ("/api/ai/model", "/api/ai/refresh"):
            try:
                return self._send(200, ai.set_model(str(body.get("model", ""))) if path == "/api/ai/model" else ai.refresh_models())
            except ai.AIError as e:
                return self._send(200, {"error": str(e), "code": e.code})
        if path == "/api/ai/forget":
            prov = str(body.get("provider", ""))
            if prov in ai.PROVIDERS:
                ai.forget_key(prov)
                if ai.load().get("provider") == prov:
                    ai.AI_FILE.unlink(missing_ok=True)
            return self._send(200, ai.status())
        # ---- problem reports, for everyone ----
        if path == "/api/tickets/mine":
            return self._send(200, tickets.my_tickets())
        if path == "/api/tickets/new":
            if isinstance(body.get("diag"), dict):
                body["diag"]["serverErrors"] = [{"at": e["at"], "where": e["where"], "trace": e["trace"][-600:]} for e in SERVER_ERRORS[-5:]]
            return self._send(200, tickets.new_ticket(body))
        if path == "/api/tickets/reply":
            return self._send(200, tickets.my_reply(body.get("id", ""), body.get("text", ""), body.get("close")))
        if path == "/api/tickets/read":
            return self._send(200, tickets.mark_mine_read(str(body.get("id", ""))))
        if path == "/api/dev/diagnostics":
            return self._send(200, dev_diagnostics(body.get("client", {})))
        if path == "/api/notify":
            if body.get("sound"):
                subprocess.Popen("f=$(find /usr/share/sounds -name 'complete.oga' 2>/dev/null | head -1); [ -n \"$f\" ] && (pw-play \"$f\" || paplay \"$f\")",
                                 shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
            return self._send(200, notify(body.get("title", "Done"), body.get("body", "")))
        if path == "/api/vm/template":
            info = vmtemplates.resolve(str(body.get("id", "")), DOWNLOADS)
            if "error" not in info and not info["downloaded"]:
                info["cmd"] = vmtemplates.download_cmd(info)
            return self._send(200, info)
        if path == "/api/vm/createcmd":
            try:
                return self._send(200, {"cmd": controls.vm_create_cmd(body)})
            except (ValueError, TypeError) as e:
                return self._send(200, {"error": str(e)})
        if path == "/api/vm/meta":
            name = str(body.get("name", ""))
            if body.get("save"):
                return self._send(200, controls.vm_meta_save(name, body.get("data", {})))
            return self._send(200, controls.vm_meta_get(name))
        if path == "/api/vm/deletecmd":
            try:
                return self._send(200, {"cmd": controls.vm_delete_cmd(str(body.get("name", "")))})
            except ValueError as e:
                return self._send(200, {"error": str(e)})
        if path == "/api/profile/scan":
            return self._send(200, scan_profile())
        if path == "/api/updates/count":
            return self._send(200, update_counts())
        if path == "/api/export":
            return self._send(200, export_backup())
        if path == "/api/risk":
            return self._send(200, harm.report(body.get("cmd", "")))
        if path == "/api/control/preview":
            try:
                cmd, admin = controls.command_for(body.get("id", ""), body.get("value"))
            except (KeyError, ValueError, TypeError) as e:
                return self._send(400, {"error": str(e)})
            return self._send(200, dict(harm.report(cmd), cmd=cmd))
        if path == "/api/admin/config":
            ADMIN.idle = int(body.get("idle", 300))
            if ADMIN.idle == 0:
                ADMIN.end()
            return self._send(200, ADMIN.status())
        if path == "/api/admin/lock":
            ADMIN.end()
            return self._send(200, {"ok": True})
        if path == "/api/fonts/add":
            return self._send(200, add_font(body.get("path", "")))
        if path == "/api/complete":
            return self._send(200, assistant.complete(body.get("text", "")))
        if path == "/api/suggestions/generate":
            return self._send(200, assistant.generate_suggestions())
        if path == "/api/chat/save":
            try:
                assistant.save_chat(body["id"], body.get("title", "Chat"), body.get("messages", []))
            except (KeyError, ValueError) as e:
                return self._send(400, {"error": str(e)})
            return self._send(200, {"ok": True})
        if path == "/api/chat/delete":
            try:
                assistant.delete_chat(body.get("id", ""))
            except ValueError as e:
                return self._send(400, {"error": str(e)})
            return self._send(200, {"ok": True})
        if path == "/api/memory":
            assistant.save_memory([m for m in body.get("items", []) if isinstance(m, dict) and m.get("text")])
            return self._send(200, {"ok": True})
        if path == "/api/settings":
            save_settings(body.get("settings", {}))
            return self._send(200, {"ok": True})
        if path == "/api/favorites":
            save_favorites(body.get("favorites", []))
            return self._send(200, {"ok": True})
        if path == "/api/launch":  # start a GUI program detached (e.g. open a folder)
            # watch it for a moment: if it crashes straight away, say why instead of failing silently
            log = tempfile.TemporaryFile()
            p = subprocess.Popen(body["cmd"], shell=True, start_new_session=True, stdin=subprocess.DEVNULL,
                                 stdout=log, stderr=subprocess.STDOUT)
            try:
                code = p.wait(timeout=2.5)
            except subprocess.TimeoutExpired:
                return self._send(200, {"ok": True})  # still running: it opened
            log.seek(0)
            out = log.read().decode(errors="replace").strip()
            if code == 0:
                return self._send(200, {"ok": True})
            last = [l for l in out.splitlines() if l.strip()][-3:]
            return self._send(200, {"ok": False, "code": code, "error": "\n".join(last) or f"It closed straight away (code {code})."})
        self._send(404, {"error": "not found"})


    def set_control(self, body):
        """Change one setting and report the command that did it."""
        try:
            cmd, admin = controls.command_for(body.get("id", ""), body.get("value"))
        except (KeyError, ValueError, TypeError) as e:
            return self._send(400, {"error": f"unknown control {e}"})
        try:
            r = subprocess.run(["bash", "-c", cmd], capture_output=True, text=True, timeout=300,
                               env=dict(RUN_ENV, **ADMIN.env()), cwd=str(Path.home()), stdin=subprocess.DEVNULL)
            out, code = (r.stdout + r.stderr).strip(), r.returncode
        except subprocess.TimeoutExpired:
            out, code = "Timed out", 124
        return self._send(200, {"ok": code == 0, "code": code, "cmd": cmd, "admin": admin, "output": out[-4000:]})

    def run_stream(self, body):
        """Run a shell command and stream its output back as it happens."""
        cmd = body.get("cmd", "")
        job = body.get("id") or uuid.uuid4().hex
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        p = subprocess.Popen(["bash", "-c", cmd], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                             stdin=subprocess.DEVNULL, cwd=body.get("cwd") or str(Path.home()),
                             env=dict(RUN_ENV, **ADMIN.env()), start_new_session=True)
        with JOBS_LOCK:
            JOBS[job] = p
        try:
            while True:
                chunk = p.stdout.read1(4096)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
            code = p.wait()
            self.wfile.write(f"\n\x00EXIT:{code}".encode())
        except (BrokenPipeError, ConnectionResetError):
            try:
                os.killpg(p.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        finally:
            with JOBS_LOCK:
                JOBS.pop(job, None)


def main():
    try:
        server = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError:
        print(f"Port {PORT} is busy - the dashboard is probably already running.")
        print(f"Open http://127.0.0.1:{PORT}")
        sys.exit(1)
    server.daemon_threads = True
    ADMIN.serve()
    print(f"Linux Dashboard running at http://127.0.0.1:{PORT}  (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
