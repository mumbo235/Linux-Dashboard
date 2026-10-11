"""Settings the dashboard can read and change: toggles, sliders and pickers.

Every control has a getter (returns its current value) and a setter that
builds the shell command to run. The command is shown to the user, so it
doubles as a "here's how you'd do this in a terminal" lesson.
"""
import glob
import json
import os
import re
import shlex
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import platform_info as plat

q = shlex.quote
ENV = dict(os.environ, LANG="C.UTF-8", NO_COLOR="1")
HOME = Path.home()
APP_DIR = Path(__file__).resolve().parent
if not (APP_DIR / "web").is_dir() and (APP_DIR.parent / "web").is_dir():
    APP_DIR = APP_DIR.parent
DND_MARK = "linux-dashboard-dnd"
AWAKE_MARK = "linux-dashboard-keepawake"
QDBUS = plat.QDBUS
BRIGHT = f"{QDBUS} org.kde.Solid.PowerManagement /org/kde/Solid/PowerManagement/Actions/BrightnessControl org.kde.Solid.PowerManagement.Actions.BrightnessControl"
KWIN_RECONFIGURE = f"{QDBUS} org.kde.KWin /KWin reconfigure"


def sh(cmd, timeout=10):
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout, env=ENV)
        return r.stdout.strip()
    except Exception:
        return ""


def read(path, default=""):
    try:
        return Path(path).read_text().strip()
    except Exception:
        return default


def kread(file, groups, key, default=""):
    g = " ".join(f"--group {q(x)}" for x in groups)
    return sh(f"kreadconfig6 --file {file} {g} --key {key} --default {q(str(default))}")


def kwrite(file, groups, key, value):
    g = " ".join(f"--group {q(x)}" for x in groups)
    if isinstance(value, bool):
        return f"kwriteconfig6 --notify --file {file} {g} --key {key} --type bool {str(value).lower()}"
    sep = "-- " if str(value).startswith("-") else ""  # so "-0.3" isn't read as an option
    return f"kwriteconfig6 --notify --file {file} {g} --key {key} {sep}{q(str(value))}"


def truthy(s):
    return str(s).lower() in ("true", "1", "yes", "on")


def pct(s):
    try:
        return round(float(s.split()[1]) * 100)
    except (IndexError, ValueError):
        return None


def to_int(v, default=0):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def applesmc():
    for p in glob.glob("/sys/class/hwmon/hwmon*/device/name") + glob.glob("/sys/class/hwmon/hwmon*/name"):
        if read(p) == "applesmc":
            d = Path(p).parent
            if (d / "fan1_min").exists() or (d / "fan1_output").exists() or (d / "fan1_input").exists():
                return d
    for d in Path("/sys/devices/platform").glob("applesmc*"):
        if (d / "fan1_min").exists() or (d / "fan1_output").exists() or (d / "fan1_input").exists():
            return d
    return None


SMC = applesmc()


def unself(mark):
    """'[l]inux-...' matches the real process but not the shell running pgrep/pkill."""
    return f"[{mark[0]}]{mark[1:]}"


def held(mark):
    return bool(sh(f"pgrep -f {q(unself(mark))}"))


# ---------- the registry ----------
# id -> (getter, setter(value) -> shell command, admin?)

def svc_get(unit):
    return sh(f"systemctl is-enabled {q(unit)}") == "enabled"


def svc_set(unit):
    return lambda v: f"pkexec systemctl {'enable' if v else 'disable'} --now {q(unit)}"


def effect(name, default):
    key = f"{name}Enabled"
    return (lambda: truthy(kread("kwinrc", ["Plugins"], key, default)),
            lambda v: f"{kwrite('kwinrc', ['Plugins'], key, bool(v))} && {QDBUS} org.kde.KWin /Effects org.kde.kwin.Effects.{'loadEffect' if v else 'unloadEffect'} {name} >/dev/null",
            False)


def bt_get():
    blocked = '"soft": "blocked"' in sh("rfkill -J -o TYPE,SOFT")
    return not blocked and sh("systemctl is-active bluetooth") == "active"


def bt_set(v):
    if v:
        return "rfkill unblock bluetooth && (systemctl is-active -q bluetooth || pkexec systemctl enable --now bluetooth)"
    return "rfkill block bluetooth"


def dnd_set(v):
    if not v:
        return f"pkill -f {q(unself(DND_MARK))}"
    helper = Path(__file__).resolve().parent / "dnd-helper.py"
    return f"setsid -f /usr/bin/python3 {q(str(helper))} {DND_MARK} >/dev/null 2>&1; echo 'Notifications paused'"


def awake_set(v):
    if not v:
        return f"pkill -f {q(unself(AWAKE_MARK))}"
    return (f"setsid -f systemd-inhibit --what=idle:sleep --who={AWAKE_MARK} --why='Keep awake switch' "
            f"sleep infinity >/dev/null 2>&1; echo 'Screen will stay on and the PC will not sleep'")


def governor_get():
    return read("/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor") == "performance"


def governor_set(v):
    g = "performance" if v else "powersave"
    return f"echo {g} | pkexec tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor >/dev/null && echo 'CPU governor: {g}'"


def bright_get():
    try:
        return round(int(sh(f"{BRIGHT}.brightness")) * 100 / int(sh(f"{BRIGHT}.brightnessMax")))
    except ValueError:
        return None


def bright_set(v):
    mx = sh(f"{BRIGHT}.brightnessMax") or "10000"
    return f"{BRIGHT}.setBrightness {int(int(mx) * max(1, int(v)) / 100)}"


# ---------- fans (Macs) ----------
# Apple SMC fan control: drives the fans from a temperature curve, provides force-stop
# and overdrive modes, and hands control back to Apple's firmware when set to automatic.
FAN_CONF = Path("/etc/t2fand.conf")
FAN_CURVES = ("linear", "exponential", "logarithmic")
FAN_PRESETS = {  # mode: (start speeding up at °C, full speed at °C, curve, always full speed)
    "quiet": (60, 85, "exponential", False),
    "balanced": (55, 75, "linear", False),
    "cool": (45, 68, "logarithmic", False),
    "max": (55, 75, "linear", True),
}


def is_t2():
    try:
        lspci = sh(["lspci"])
        return bool(re.search(r"T2 ", lspci, re.I)) or "t2" in os.uname().release.lower()
    except Exception:
        return "t2" in os.uname().release.lower()


def fan_state():
    import configparser
    installed = bool(shutil_which("t2fanrd")) or Path("/usr/bin/t2fanrd").exists() or bool(SMC)
    t2 = is_t2()
    t2_active = sh(f"systemctl is-active {fan_unit()}") == "active"
    od_active = sh(f"systemctl is-active {OD_UNIT}") == "active"
    cfg = None

    od_conf_data = {}
    if OD_CONF.exists():
        for line in read(OD_CONF).splitlines():
            if "=" in line:
                k, v = line.split("=", 1)
                od_conf_data[k.strip().upper()] = v.strip()

    if od_active:
        m = od_conf_data.get("MODE", "overdrive").lower()
        if m == "curve":
            mode = od_conf_data.get("NAME", "custom").lower()
            cfg = {
                "low": int(od_conf_data.get("LOW", 55)),
                "high": int(od_conf_data.get("HIGH", 75)),
                "curve": od_conf_data.get("CURVE", "linear").strip().lower(),
                "full": truthy(od_conf_data.get("FULL", "false")),
            }
        elif m == "stop":
            mode = "stop"
        elif m == "overdrive" and to_int(od_conf_data.get("T", "0")) > 0:
            mode = "overdrive"
        else:  # no usable config: the helper hands the fans back to Apple's control
            mode = "auto"
    elif t2_active:
        if FAN_CONF.exists():
            cp = configparser.ConfigParser()
            try:
                cp.read_string(FAN_CONF.read_text())
                f1 = cp["Fan1"]
                cfg = {"low": int(f1.get("low_temp", 55)), "high": int(f1.get("high_temp", 75)),
                       "curve": f1.get("speed_curve", "linear").strip().lower(), "full": truthy(f1.get("always_full_speed", "false"))}
            except Exception:
                cfg = None
        mode = next((m for m, (lo, hi, cu, fu) in FAN_PRESETS.items()
                     if cfg and ((fu and cfg["full"]) or (not fu and not cfg["full"] and (lo, hi, cu) == (cfg["low"], cfg["high"], cfg["curve"])))), "custom")
    else:
        is_manual = bool(SMC and any(read(f) == "1" for f in SMC.glob("fan*_manual")))
        is_conf_stop = od_conf_data.get("MODE", "").lower() == "stop"
        if is_manual or is_conf_stop:
            mode = "stop"
        else:
            mode = "auto"

    fans = []
    for f in sorted(SMC.glob("fan*_input")) if SMC else []:
        n = f.name.split("_")[0]
        fans.append({"name": f"Fan {n[3:]}", "rpm": to_int(read(f, "0")), "min": to_int(read(SMC / f"{n}_min", "0")),
                     "max": to_int(read(SMC / f"{n}_max", "0"))})
    cpu = None
    for p in sorted(Path("/sys/devices/platform/coretemp.0/hwmon").glob("hwmon*/temp1_input")) + \
             sorted(Path("/sys/class/hwmon").glob("hwmon*/temp1_input")):
        v = to_int(read(p, "0")) // 1000
        if 10 < v < 125:
            cpu = v
            break
    gpu = None
    for p in sorted(Path("/sys/class/drm").glob("card*/device/hwmon/hwmon*/temp1_input")):
        v = to_int(read(p, "0")) // 1000
        if 10 < v < 125:
            gpu = v
            break
    return {"supported": bool(SMC), "installed": installed, "active": t2_active or od_active, "mode": mode,
            "t2": t2, "overdrive": {"active": od_active and mode == "overdrive", "target": od_target()}, "config": cfg or
            {"low": 55, "high": 75, "curve": "linear", "full": False}, "fans": fans, "cpu": cpu, "gpu": gpu}


FIND_UNIT = "U=$(systemctl list-unit-files --no-legend 't2fanrd*' 't2fand*' | awk 'NR==1{print $1}'); U=${U:-t2fanrd.service}"


def fan_unit():
    return sh(f"{FIND_UNIT}; echo $U") or "t2fanrd.service"


def shutil_which(name):
    import shutil
    return shutil.which(name)


# ---------- fan overdrive: hold the fans at or above their normal top speed ----------
OD_BIN = "/usr/local/lib/linux-dashboard/fan-overdrive"
OD_UNIT = "linux-dashboard-fans.service"
OD_CONF = Path("/etc/linux-dashboard-fans")
# The helper script and its service live in ~/linux-dashboard/system/ and get copied into place.
OD_SRC = APP_DIR / "system"


def od_install():
    """Shell (run as root) that installs the overdrive helper and its service."""
    return (f"install -Dm755 {q(str(OD_SRC / 'fan-overdrive'))} {OD_BIN} && "
            f"install -Dm644 {q(str(OD_SRC / OD_UNIT))} /etc/systemd/system/{OD_UNIT} && systemctl daemon-reload")


def od_target():
    m = re.search(r"^T=(\d+)$", read(OD_CONF), re.M)
    return int(m.group(1)) if m else None


def fan_limit_cmd():
    return f"pkexec bash -c {q(od_install() + ' && ' + OD_BIN + ' --find-limit')}"


def fan_overdrive_cmd(rpm):
    rpm = int(rpm)
    top = max((int(read(f, "0") or 0) for f in SMC.glob("fan*_max")), default=0) if SMC else 0
    if not top or not (top <= rpm <= top * 3 // 2):
        raise ValueError("speed out of range")
    smc_input = f"{SMC}/fan1_input" if SMC else ""
    script = (f"{od_install()} && printf 'MODE=overdrive\\nT={rpm}\\n' > {OD_CONF} && {FIND_UNIT} && (systemctl disable --now $U 2>/dev/null; true) && "
              f"systemctl enable {OD_UNIT} && systemctl restart {OD_UNIT} && sleep 1 && "
              f"echo \"Overdrive on: asked for {rpm} rpm, fans now at $(cat {smc_input} 2>/dev/null || echo {rpm}) rpm\"")
    return f"pkexec bash -c {q(script)}"


def fan_conf_text(low, high, curve, full):
    n = len(list(SMC.glob("fan*_input"))) if SMC else 1
    return "".join(f"[Fan{i}]\nlow_temp={low}\nhigh_temp={high}\nspeed_curve={curve}\nalways_full_speed={'true' if full else 'false'}\n\n"
                   for i in range(1, n + 1))


def fan_mode_cmd(mode, custom=None):
    if mode == "auto":  # stopping services gives control back to Apple's firmware
        # Disable each unit on its own: "systemctl disable --now A B" aborts entirely when A doesn't
        # exist (no t2fanrd on non-T2 Macs), which left our fan service running with no config.
        script = (f"(systemctl disable --now {OD_UNIT} 2>/dev/null; {FIND_UNIT}; systemctl disable --now $U 2>/dev/null; true) && "
                  f"(rm -f {OD_CONF}; {OD_BIN} --restore 2>/dev/null || (for f in {SMC}/fan*_manual; do echo 0 > $f; done 2>/dev/null); true)")
        return f"pkexec bash -c {q(script)} && echo 'Fans are back on Apple automatic control'"

    if mode == "stop":  # force fans off / to lowest speed
        script = (f"{od_install()} && ({FIND_UNIT}; systemctl disable --now $U 2>/dev/null; true) && "
                  f"echo 'MODE=stop' > {OD_CONF} && "
                  f"systemctl enable {OD_UNIT} && systemctl restart {OD_UNIT} && "
                  f"({OD_BIN} --stop 2>/dev/null || "
                  f"(for f in {SMC}/fan*_manual; do echo 1 > $f; done 2>/dev/null; "
                  f"for f in {SMC}/fan*_output; do echo 0 > $f; done 2>/dev/null); true)")
        return f"pkexec bash -c {q(script)} && echo 'Fans forced to stop'"

    if mode == "custom":
        low, high, curve = int(custom["low"]), int(custom["high"]), str(custom["curve"])
        if not (30 <= low <= 85 and 45 <= high <= 95 and high - low >= 5 and curve in FAN_CURVES):
            raise ValueError("temperatures out of the safe range")
        full = False
    else:
        low, high, curve, full = FAN_PRESETS[mode]

    use_t2fanrd = is_t2() and (Path("/usr/bin/t2fanrd").exists() or bool(shutil_which("t2fanrd")))
    if use_t2fanrd:
        conf = fan_conf_text(low, high, curve, full)
        script = (f"printf %s {q(conf)} > {FAN_CONF} && (systemctl disable --now {OD_UNIT} 2>/dev/null; true) && "
                  f"{FIND_UNIT} && systemctl enable $U && systemctl restart $U && "
                  f"echo 'Fan mode: {mode} (start speeding up at {low}°C, full speed at {high}°C, {curve} curve{', always full speed' if full else ''})'")
        return f"pkexec bash -c {q(script)}"

    conf_lines = f"MODE=curve\nNAME={mode}\nLOW={low}\nHIGH={high}\nCURVE={curve}\nFULL={'true' if full else 'false'}\n"
    script = (f"{od_install()} && printf %s {q(conf_lines)} > {OD_CONF} && "
              f"({FIND_UNIT}; systemctl disable --now $U 2>/dev/null; true) && "
              f"systemctl enable {OD_UNIT} && systemctl restart {OD_UNIT} && "
              f"echo 'Fan mode: {mode} (start speeding up at {low}°C, full speed at {high}°C, {curve} curve{', always full speed' if full else ''})'")
    return f"pkexec bash -c {q(script)}"


def fan_get():
    if not SMC:
        return None
    return int(read(SMC / "fan1_min", "0"))


def fan_set(v):
    if not SMC:
        raise ValueError("Apple SMC fans not found")
    v = int(v)
    return f"pkexec bash -c 'for f in {SMC}/fan*_min; do echo {v} > $f; done' && echo 'Minimum fan speed: {v} RPM'"


def ntp_get():
    return "NTP=yes" in sh("timedatectl show -p NTP")


def dark_get():
    return "dark" in kread("kdeglobals", ["KDE"], "LookAndFeelPackage", "").lower() or \
        "dark" in kread("kdeglobals", ["General"], "ColorScheme", "").lower()


def dark_set(v):
    return f"lookandfeeltool -a org.kde.breeze{'dark' if v else ''}.desktop"


def nightlight_set(v):
    if v:
        return f"{kwrite('kwinrc', ['NightColor'], 'Active', True)} && {kwrite('kwinrc', ['NightColor'], 'Mode', 'Constant')} && {KWIN_RECONFIGURE}"
    return f"{kwrite('kwinrc', ['NightColor'], 'Active', False)} && {KWIN_RECONFIGURE}"


NIGHTLIGHT = f"{QDBUS} org.kde.KWin /org/kde/KWin/NightLight org.kde.KWin.NightLight"


def nighttemp_set(v):
    # Warmth only shows while night light is on, so choosing a warmth switches it on
    return (f"{kwrite('kwinrc', ['NightColor'], 'NightTemperature', int(v))} && "
            f"{kwrite('kwinrc', ['NightColor'], 'Active', True)} && {kwrite('kwinrc', ['NightColor'], 'Mode', 'Constant')} && "
            f"{KWIN_RECONFIGURE} && {NIGHTLIGHT}.stopPreview")


# ---------- KDE panel (taskbar) ----------
# Plasma's scripting API changes the panel live; panels()[0] is the main panel.
import time as _time
_panel_cache = {"t": 0, "v": None}


def plasma_cmd(js):
    return f"{QDBUS} org.kde.plasmashell /PlasmaShell org.kde.PlasmaShell.evaluateScript {q(js)}"


WIDGET_JS = ("function widget(re){var ws=panels()[0].widgets();for(var i=0;i<ws.length;i++)if(re.test(ws[i].type))return ws[i];return null}"
             "function cfg(re,g,k,d){var w=widget(re);if(!w)return null;w.currentConfigGroup=[g];var v=w.readConfig(k,d);return v}")


def panel_state():
    if _time.time() - _panel_cache["t"] < 1.5 and _panel_cache["v"] is not None:
        return _panel_cache["v"]
    js = WIDGET_JS + (
        "var p=panels()[0];print(JSON.stringify(p?{location:p.location,height:p.height,hiding:p.hiding,floating:p.floating,"
        "alignment:p.alignment,lengthMode:p.lengthMode,opacity:p.opacity,widgets:p.widgets().map(function(w){return w.type}),"
        "seconds:cfg(/digitalclock/,'Appearance','showSeconds',1),date:cfg(/digitalclock/,'Appearance','showDate',true),"
        "h24:cfg(/digitalclock/,'Appearance','use24hFormat',1),group:cfg(/tasks/,'General','groupingStrategy',1),"
        "thisdesk:cfg(/tasks/,'General','showOnlyCurrentDesktop',true),audio:cfg(/tasks/,'General','indicateAudioStreams',true),"
        "launchers:cfg(/tasks/,'General','launchers',[])}:null))")
    try:
        v = json.loads(sh(plasma_cmd(js)) or "null")
    except json.JSONDecodeError:
        v = None
    _panel_cache.update(t=_time.time(), v=v)
    return v


def pget(key, conv=lambda x: x):
    def g():
        st = panel_state()
        return conv(st[key]) if st and st.get(key) is not None else None
    return g


def pset(prop, as_number=False):
    def s(v):
        _panel_cache["t"] = 0
        val = str(int(v)) if as_number else ("true" if v is True else "false" if v is False else json.dumps(str(v)))
        return plasma_cmd(f"panels()[0].{prop} = {val}")
    return s


def widget_set(pattern, group, key, conv):
    def s(v):
        _panel_cache["t"] = 0
        return plasma_cmd(WIDGET_JS + f"var w=widget(/{pattern}/);w.currentConfigGroup=[{json.dumps(group)}];"
                          f"w.writeConfig({json.dumps(key)}, {json.dumps(conv(v))});w.reloadConfig()")
    return s


# ---------- this app on the desktop / taskbar / login ----------
APP_ID = "io.github.jarvis.LinuxDashboard"
APP_DESKTOP = HOME / ".local/share/applications" / f"{APP_ID}.desktop"
if not APP_DESKTOP.exists() and Path(f"/usr/share/applications/{APP_ID}.desktop").exists():
    APP_DESKTOP = Path(f"/usr/share/applications/{APP_ID}.desktop")  # installed as a system package
DESKTOP_DIR = Path(sh("xdg-user-dir DESKTOP") or HOME / "Desktop")
LAUNCHER = f"applications:{APP_ID}.desktop"


def taskbar_pinned():
    st = panel_state()
    return bool(st) and LAUNCHER in (st.get("launchers") or [])


def taskbar_set(v):
    _panel_cache["t"] = 0
    js = WIDGET_JS + (f"var w=widget(/tasks/);w.currentConfigGroup=['General'];var l=w.readConfig('launchers',[]);"
                      f"l=l.filter(function(x){{return x!=={json.dumps(LAUNCHER)}&&x!=='applications:linux-dashboard.desktop'}});"
                      + (f"l.push({json.dumps(LAUNCHER)});" if v else "") + "w.writeConfig('launchers',l);w.reloadConfig()")
    return plasma_cmd(js)


def desktop_icon_set(v):
    dst = DESKTOP_DIR / f"{APP_ID}.desktop"
    if v:
        return f"cp {q(str(APP_DESKTOP))} {q(str(dst))} && chmod +x {q(str(dst))} && echo 'Shortcut added to your desktop'"
    return f"rm -f {q(str(dst))}"


def login_set(v):
    dst = HOME / ".config/autostart" / f"{APP_ID}.desktop"
    if v:
        return f"mkdir -p ~/.config/autostart && cp {q(str(APP_DESKTOP))} {q(str(dst))}"
    return f"rm -f {q(str(dst))}"


# ---------- mouse & touchpad (KWin, live) + saved so it survives a restart ----------
INPUT = "busctl --user {verb}-property org.kde.KWin /org/kde/KWin/InputDevice/{dev} org.kde.KWin.InputDevice"


def pointers():
    """Real mice and touchpads (not keyboards/headsets that also report pointer events)."""
    out = []
    for dev in sh(f"{QDBUS} org.kde.KWin /org/kde/KWin/InputDevice org.kde.KWin.InputDeviceManager.devicesSysNames").split():
        g = lambda p: sh(INPUT.format(verb="get", dev=dev) + " " + p).split(" ", 1)[-1].strip().strip('"')
        if g("pointer") != "true":
            continue
        name = g("name")
        if re.search(r"Consumer Control|Keyboard|Headset|System Control|Power Button", name, re.I):
            continue
        out.append({"dev": dev, "name": name, "vendor": g("vendor"), "product": g("product"), "touchpad": g("touchpad") == "true"})
    return out


def input_pointers():
    """Mice and touchpads from the kernel's list (any desktop)."""
    out = []
    for block in read("/proc/bus/input/devices").split("\n\n"):
        name = re.search(r'^N: Name="(.*)"', block, re.M)
        if name and re.search(r"^H: Handlers=.*\bmouse\d", block, re.M) and not re.search(r"Consumer Control|Keyboard|Headset|System Control|Power Button", name.group(1), re.I):
            out.append({"dev": "", "name": name.group(1), "vendor": "", "product": "", "touchpad": bool(re.search(r"touchpad|trackpad", name.group(1), re.I))})
    return out


_ptr_cache = {"t": 0, "v": []}


def ptrs():
    import time as _t
    if _t.time() - _ptr_cache["t"] > 30:
        _ptr_cache.update(t=_t.time(), v=pointers() if plat.KDE else input_pointers())
    return _ptr_cache["v"]


def ptr_get(prop, conv):
    def g():
        p = ptrs()
        if not p:
            return None
        v = sh(INPUT.format(verb="get", dev=p[0]["dev"]) + " " + prop).split(" ", 1)[-1].strip()
        return conv(v)
    return g


def ptr_set(prop, sig, cfgkey, conv):
    """Change it live on every mouse/touchpad and save it the way KDE's own settings do."""
    def s(v):
        val = conv(v)
        cmds = []
        for p in ptrs():
            cmds.append(f"{INPUT.format(verb='set', dev=p['dev'])} {prop} {sig} {str(val).lower() if isinstance(val, bool) else val}")
            saved = {"PointerAccelerationProfile": 1 if val else 2}.get(cfgkey, val) if cfgkey == "PointerAccelerationProfile" else val
            cmds.append(kwrite("kcminputrc", ["Libinput", p["vendor"], p["product"], p["name"]], cfgkey, saved))
        return " && ".join(cmds) or "echo 'No mouse or touchpad found'"
    return s


# ---------- virtual desktops ----------
VDM = f"{QDBUS} org.kde.KWin /VirtualDesktopManager org.kde.KWin.VirtualDesktopManager"


def vdesk_set(n):
    n = max(1, min(12, int(n)))
    raw = sh(f"busctl --user get-property org.kde.KWin /VirtualDesktopManager org.kde.KWin.VirtualDesktopManager desktops")
    ids = re.findall(r'\d+ "([^"]+)" "[^"]*"', raw)
    cur = len(ids)
    if n > cur:
        return " && ".join(f"{VDM}.createDesktop {i} {q(f'Desktop {i + 1}')}" for i in range(cur, n))
    if n < cur:
        return " && ".join(f"{VDM}.removeDesktop {q(i)}" for i in reversed(ids[n:]))
    return "true"


# ---------- compressed memory (zram swap) ----------
ZRAM_CONF = "[zram0]\nzram-size = ram / 2\ncompression-algorithm = zstd\n"


def zram_set(v):
    if v:
        inst = plat.install_cmd(plat.PACKAGES["zram"])
        script = ((f"{inst} && " if inst else "") +
                  f"printf {q(ZRAM_CONF)} > /etc/systemd/zram-generator.conf && systemctl daemon-reload && "
                  "systemctl start systemd-zram-setup@zram0.service && sleep 1 && swapon --show")
    else:
        script = ("swapoff /dev/zram0 2>/dev/null; systemctl stop systemd-zram-setup@zram0.service 2>/dev/null; "
                  "rm -f /etc/systemd/zram-generator.conf && systemctl daemon-reload && echo 'Compressed memory turned off'")
    return f"pkexec bash -c {q(script)}"


# ---------- default apps ----------
DEFAULT_APPS = {  # category: (label, mime types)
    "browser": ("Web browser", ["x-scheme-handler/https", "x-scheme-handler/http", "text/html"]),
    "mail": ("Email", ["x-scheme-handler/mailto"]),
    "files": ("File manager", ["inode/directory"]),
    "pdf": ("PDF documents", ["application/pdf"]),
    "image": ("Pictures", ["image/png", "image/jpeg", "image/webp", "image/gif"]),
    "music": ("Music", ["audio/mpeg", "audio/flac", "audio/ogg", "audio/x-wav"]),
    "video": ("Videos", ["video/mp4", "video/x-matroska", "video/webm"]),
    "text": ("Text files", ["text/plain"]),
}


def default_apps():
    import configparser
    names = {}

    def app_name(desktop):
        if desktop not in names:
            names[desktop] = desktop
            for base in (HOME / ".local/share/applications", Path("/usr/share/applications"), Path("/var/lib/flatpak/exports/share/applications"),
                         HOME / ".local/share/flatpak/exports/share/applications"):
                f = base / desktop
                if f.exists():
                    names[desktop] = parse_desktop(f).get("Name", desktop)
                    break
        return names[desktop]
    out = []
    for key, (label, mimes) in DEFAULT_APPS.items():
        txt = sh(f"gio mime {q(mimes[0])}")
        cur = (re.search(r"“[^”]*”: (\S+\.desktop)", txt) or re.search(r": (\S+\.desktop)", txt))
        cur = cur.group(1) if cur else ""
        opts = sorted(set(re.findall(r"^\t(\S+\.desktop)$", txt, re.M)) | ({cur} if cur else set()))
        out.append({"key": key, "label": label, "current": cur, "options": [{"id": o, "name": app_name(o)} for o in opts]})
    return out


def airplane_get():
    out = sh("rfkill -J -o TYPE,SOFT")
    try:
        devs = json.loads(out)["rfkilldevices"]
    except Exception:
        devs = []
    return bool(devs) and all(d["soft"] == "blocked" for d in devs) and sh("nmcli radio wifi") != "enabled"


def airplane_set(v):
    return "nmcli radio all off; rfkill block all" if v else "rfkill unblock all; nmcli radio all on"


def anim_get():
    try:
        return float(kread("kdeglobals", ["KDE"], "AnimationDurationFactor", 1))
    except ValueError:
        return 1.0


def secs(file, groups, key, default):
    try:
        return int(kread(file, groups, key, default))
    except ValueError:
        return default


POWERDEVIL_RELOAD = f"{QDBUS} org.kde.Solid.PowerManagement /org/kde/Solid/PowerManagement org.kde.Solid.PowerManagement.refreshStatus"


def screen_off_set(v):
    v = int(v)
    if v == 0:
        return f"{kwrite('powerdevilrc', ['AC', 'Display'], 'TurnOffDisplayWhenIdle', False)} && {POWERDEVIL_RELOAD}"
    return (f"{kwrite('powerdevilrc', ['AC', 'Display'], 'TurnOffDisplayWhenIdle', True)} && "
            f"{kwrite('powerdevilrc', ['AC', 'Display'], 'TurnOffDisplayIdleTimeoutSec', v)} && {POWERDEVIL_RELOAD}")


def screen_off_get():
    if not truthy(kread("powerdevilrc", ["AC", "Display"], "TurnOffDisplayWhenIdle", "true")):
        return 0
    return secs("powerdevilrc", ["AC", "Display"], "TurnOffDisplayIdleTimeoutSec", 600)


def sleep_get():
    if kread("powerdevilrc", ["AC", "SuspendAndShutdown"], "AutoSuspendAction", "1") == "0":
        return 0
    return secs("powerdevilrc", ["AC", "SuspendAndShutdown"], "AutoSuspendIdleTimeoutSec", 900)


def sleep_set(v):
    v = int(v)
    g = ["AC", "SuspendAndShutdown"]
    if v == 0:
        return f"{kwrite('powerdevilrc', g, 'AutoSuspendAction', 0)} && {POWERDEVIL_RELOAD}"
    return f"{kwrite('powerdevilrc', g, 'AutoSuspendAction', 1)} && {kwrite('powerdevilrc', g, 'AutoSuspendIdleTimeoutSec', v)} && {POWERDEVIL_RELOAD}"


def lock_get():
    if not truthy(kread("kscreenlockerrc", ["Daemon"], "Autolock", "true")):
        return 0
    try:
        return int(kread("kscreenlockerrc", ["Daemon"], "Timeout", 5))
    except ValueError:
        return 5


def lock_set(v):
    v = int(v)
    if v == 0:
        return kwrite("kscreenlockerrc", ["Daemon"], "Autolock", False)
    return f"{kwrite('kscreenlockerrc', ['Daemon'], 'Autolock', True)} && {kwrite('kscreenlockerrc', ['Daemon'], 'Timeout', v)}"


def default_dev(kind):
    return sh(f"pactl get-default-{kind}")


CONTROLS = {
    # quick settings
    "wifi": (lambda: sh("nmcli radio wifi") == "enabled", lambda v: f"nmcli radio wifi {'on' if v else 'off'}", False),
    "bluetooth": (bt_get, bt_set, False),
    "airplane": (airplane_get, airplane_set, False),
    "dark": (dark_get, dark_set, False),
    "nightlight": (lambda: truthy(kread("kwinrc", ["NightColor"], "Active", "false")), nightlight_set, False),
    "nighttemp": (lambda: int(kread("kwinrc", ["NightColor"], "NightTemperature", 4500) or 4500), nighttemp_set, False),
    "nightpreview": (lambda: None, lambda v: f"{NIGHTLIGHT}.preview {int(v)}", False),
    "dnd": (lambda: held(DND_MARK), dnd_set, False),
    "awake": (lambda: held(AWAKE_MARK), awake_set, False),
    "performance": (governor_get, governor_set, True),
    # sound
    "volume": (lambda: pct(sh("wpctl get-volume @DEFAULT_AUDIO_SINK@")), lambda v: f"wpctl set-volume @DEFAULT_AUDIO_SINK@ {int(v)}%", False),
    "mute": (lambda: "MUTED" in sh("wpctl get-volume @DEFAULT_AUDIO_SINK@"), lambda v: f"wpctl set-mute @DEFAULT_AUDIO_SINK@ {int(bool(v))}", False),
    "mic": (lambda: pct(sh("wpctl get-volume @DEFAULT_AUDIO_SOURCE@")), lambda v: f"wpctl set-volume @DEFAULT_AUDIO_SOURCE@ {int(v)}%", False),
    "micmute": (lambda: "MUTED" in sh("wpctl get-volume @DEFAULT_AUDIO_SOURCE@"), lambda v: f"wpctl set-mute @DEFAULT_AUDIO_SOURCE@ {int(bool(v))}", False),
    "sink": (lambda: default_dev("sink"), lambda v: f"pactl set-default-sink {q(v)}", False),
    "source": (lambda: default_dev("source"), lambda v: f"pactl set-default-source {q(v)}", False),
    # display
    "brightness": (bright_get, bright_set, False),
    # fans
    "fan": (fan_get, fan_set, True),
    # appearance
    "colorscheme": (lambda: kread("kdeglobals", ["General"], "ColorScheme", "BreezeLight"), lambda v: f"plasma-apply-colorscheme {q(v)}", False),
    "accent": (lambda: kread("kdeglobals", ["General"], "AccentColor", ""), lambda v: f"plasma-apply-colorscheme --accent-color {q(v)}", False),
    "lookandfeel": (lambda: kread("kdeglobals", ["KDE"], "LookAndFeelPackage", ""), lambda v: f"lookandfeeltool -a {q(v)}", False),
    "animspeed": (anim_get, lambda v: f"{kwrite('kdeglobals', ['KDE'], 'AnimationDurationFactor', float(v))} && {KWIN_RECONFIGURE}", False),
    "singleclick": (lambda: truthy(kread("kdeglobals", ["KDE"], "SingleClick", "false")), lambda v: kwrite("kdeglobals", ["KDE"], "SingleClick", bool(v)), False),
    "fx_wobblywindows": effect("wobblywindows", "false"),
    "fx_blur": effect("blur", "true"),
    "fx_diminactive": effect("diminactive", "false"),
    "fx_shakecursor": effect("shakecursor", "true"),
    "fx_magiclamp": effect("magiclamp", "false"),
    "fx_translucency": effect("translucency", "false"),
    "wallpaper": (lambda: "", lambda v: f"plasma-apply-wallpaperimage {q(v)}", False),
    # power & lock
    "screenoff": (screen_off_get, screen_off_set, False),
    "autosleep": (sleep_get, sleep_set, False),
    "autolock": (lock_get, lock_set, False),
    "lockresume": (lambda: truthy(kread("kscreenlockerrc", ["Daemon"], "LockOnResume", "true")), lambda v: kwrite("kscreenlockerrc", ["Daemon"], "LockOnResume", bool(v)), False),
    # time & system
    "ntp": (ntp_get, lambda v: f"pkexec timedatectl set-ntp {str(bool(v)).lower()}", True),
    "timezone": (lambda: sh("timedatectl show -p Timezone --value"), lambda v: f"pkexec timedatectl set-timezone {q(v)}", True),
    "hostname": (lambda: sh("hostnamectl hostname"), lambda v: f"pkexec hostnamectl hostname {q(v)}", True),
    # mouse
    "mouse_speed": (ptr_get("pointerAcceleration", lambda v: round(float(v), 2)), ptr_set("pointerAcceleration", "d", "PointerAcceleration", lambda v: round(max(-1.0, min(1.0, float(v))), 2)), False),
    "mouse_natural": (ptr_get("naturalScroll", lambda v: v == "true"), ptr_set("naturalScroll", "b", "NaturalScroll", bool), False),
    "mouse_lefthanded": (ptr_get("leftHanded", lambda v: v == "true"), ptr_set("leftHanded", "b", "LeftHanded", bool), False),
    "mouse_flat": (ptr_get("pointerAccelerationProfileFlat", lambda v: v == "true"), ptr_set("pointerAccelerationProfileFlat", "b", "PointerAccelerationProfile", bool), False),
    "mouse_scroll": (ptr_get("scrollFactor", lambda v: round(float(v), 2)), ptr_set("scrollFactor", "d", "ScrollFactor", lambda v: round(max(0.1, min(5.0, float(v))), 2)), False),
    # desktops & memory
    "vdesks": (lambda: int(sh(f"{VDM}.count") or 1), vdesk_set, False),
    "zram": (lambda: "zram" in sh("swapon --show=NAME --noheadings"), zram_set, True),
    # KDE panel
    "panel_location": (pget("location"), pset("location"), False),
    "panel_height": (pget("height"), pset("height", True), False),
    "panel_floating": (pget("floating", bool), pset("floating"), False),
    "panel_hiding": (pget("hiding"), pset("hiding"), False),
    "panel_length": (pget("lengthMode"), pset("lengthMode"), False),
    "panel_alignment": (pget("alignment"), pset("alignment"), False),
    "panel_opacity": (pget("opacity"), pset("opacity"), False),
    "clock_seconds": (pget("seconds", lambda x: int(x) == 2), widget_set("digitalclock", "Appearance", "showSeconds", lambda v: 2 if v else 0), False),
    "clock_date": (pget("date", truthy), widget_set("digitalclock", "Appearance", "showDate", bool), False),
    "clock_24h": (pget("h24", lambda x: int(x) == 2), widget_set("digitalclock", "Appearance", "use24hFormat", lambda v: 2 if v else 1), False),
    "tasks_group": (pget("group", lambda x: int(x) != 0), widget_set("tasks", "General", "groupingStrategy", lambda v: 1 if v else 0), False),
    "tasks_thisdesk": (pget("thisdesk", truthy), widget_set("tasks", "General", "showOnlyCurrentDesktop", bool), False),
    "tasks_audio": (pget("audio", truthy), widget_set("tasks", "General", "indicateAudioStreams", bool), False),
    # this app
    "app_taskbar": (taskbar_pinned, taskbar_set, False),
    "app_desktop": (lambda: (DESKTOP_DIR / f"{APP_ID}.desktop").exists(), desktop_icon_set, False),
    "app_login": (lambda: (HOME / ".config/autostart" / f"{APP_ID}.desktop").exists(), login_set, False),
    # services that start at boot
    "svc_sshd": (lambda: svc_get("sshd"), svc_set("sshd"), True),
    "svc_bluetooth": (lambda: svc_get("bluetooth"), svc_set("bluetooth"), True),
    "svc_avahi-daemon": (lambda: svc_get("avahi-daemon"), svc_set("avahi-daemon"), True),
    "svc_libvirtd": (lambda: svc_get("libvirtd"), svc_set("libvirtd"), True),
    "svc_fstrim.timer": (lambda: svc_get("fstrim.timer"), svc_set("fstrim.timer"), True),
    "svc_paccache.timer": (lambda: svc_get("paccache.timer"), svc_set("paccache.timer"), True),
    "battery_care": (lambda: battery_care_get(), lambda v: battery_care_cmd(v), True),
}



# ---------- other desktops ----------
# The controls above talk to KDE Plasma. On GNOME the same switches go through gsettings
# (what GNOME Settings itself changes); on any desktop, the generic ones still work.

def gget(schema, key, default=""):
    v = sh(f"gsettings get {schema} {key} 2>/dev/null")
    if not v:
        return default
    v = re.sub(r"^(uint32|int32|uint64|int64|double)\s+", "", v)
    return v.strip("'")


def gset(schema, key, value):
    if isinstance(value, bool):
        value = str(value).lower()
    return f"gsettings set {schema} {key} {q(str(value))}"


def ghas(schema, key):
    return bool(sh(f"gsettings range {schema} {key} 2>/dev/null"))


IFACE = "org.gnome.desktop.interface"
NIGHT = "org.gnome.settings-daemon.plugins.color"
GPOWER = "org.gnome.settings-daemon.plugins.power"
SAVER = "org.gnome.desktop.screensaver"
GNOME_ACCENTS = {"blue": "#3584e4", "teal": "#2190a4", "green": "#3a944a", "yellow": "#c88800", "orange": "#ed5b00",
                 "red": "#e62d42", "pink": "#d56199", "purple": "#9141ac", "slate": "#6f8396"}


def g_accent_set(v):
    v = str(v).lower()
    if v not in GNOME_ACCENTS:  # a colour code: use GNOME's nearest named colour
        rgb = lambda h: tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))
        try:
            want = rgb(v)
            v = min(GNOME_ACCENTS, key=lambda n: sum((a - b) ** 2 for a, b in zip(rgb(GNOME_ACCENTS[n]), want)))
        except ValueError:
            raise ValueError("unknown colour")
    return gset(IFACE, "accent-color", v)


def g_night_set(v):
    if v:  # on all day, like KDE's "always on"
        return " && ".join([gset(NIGHT, "night-light-schedule-automatic", False), gset(NIGHT, "night-light-schedule-from", 0.0),
                            gset(NIGHT, "night-light-schedule-to", 23.99), gset(NIGHT, "night-light-enabled", True)])
    return gset(NIGHT, "night-light-enabled", False)


def g_temp_set(v):
    return f"{g_night_set(True)} && {gset(NIGHT, 'night-light-temperature', f'uint32 {max(1000, min(10000, int(v)))}')}"


def g_int(schema, key, default=0):
    try:
        return int(float(gget(schema, key, default)))
    except ValueError:
        return default


def g_sleep_get():
    if gget(GPOWER, "sleep-inactive-ac-type", "suspend") == "nothing":
        return 0
    return g_int(GPOWER, "sleep-inactive-ac-timeout", 900)


def g_sleep_set(v):
    v = int(v)
    if v == 0:
        return gset(GPOWER, "sleep-inactive-ac-type", "nothing")
    return f"{gset(GPOWER, 'sleep-inactive-ac-type', 'suspend')} && {gset(GPOWER, 'sleep-inactive-ac-timeout', v)}"


def g_lock_get():
    # GNOME locks a set time after the screen goes blank; shown here as minutes of no use in total
    if gget(SAVER, "lock-enabled", "true") != "true":
        return 0
    return max(1, round((g_int("org.gnome.desktop.session", "idle-delay", 300) + g_int(SAVER, "lock-delay", 0)) / 60))


def g_lock_set(v):
    v = int(v)
    if v == 0:
        return gset(SAVER, "lock-enabled", False)
    delay = max(0, v * 60 - g_int("org.gnome.desktop.session", "idle-delay", 300))
    return f"{gset(SAVER, 'lock-enabled', True)} && {gset(SAVER, 'lock-delay', f'uint32 {delay}')}"


def g_wallpaper_set(v):
    uri = "file://" + str(v)
    return f"{gset('org.gnome.desktop.background', 'picture-uri', uri)} && {gset('org.gnome.desktop.background', 'picture-uri-dark', uri)}"


def g_mouse(key, conv=lambda x: x, touchpad=True):
    def g():
        v = gget("org.gnome.desktop.peripherals.mouse", key, "")
        return conv(v) if v != "" else None

    def s(v):
        cmds = [gset("org.gnome.desktop.peripherals.mouse", key, v)]
        if touchpad:
            cmds.append(gset("org.gnome.desktop.peripherals.touchpad", key, v))
        return " && ".join(cmds)
    return g, s


def g_flat_set(v):
    p = "flat" if v else "default"
    return f"{gset('org.gnome.desktop.peripherals.mouse', 'accel-profile', p)} && {gset('org.gnome.desktop.peripherals.touchpad', 'accel-profile', p)}"


def g_workspaces_set(n):
    n = max(1, min(12, int(n)))
    return f"{gset('org.gnome.mutter', 'dynamic-workspaces', False)} && {gset('org.gnome.desktop.wm.preferences', 'num-workspaces', n)}"


def g_favorites():
    raw = sh("gsettings get org.gnome.shell favorite-apps 2>/dev/null")
    return re.findall(r"'([^']+)'", raw)


def g_taskbar_set(v):
    favs = [f for f in g_favorites() if f != f"{APP_ID}.desktop"] + ([f"{APP_ID}.desktop"] if v else [])
    return f"gsettings set org.gnome.shell favorite-apps {q(str(favs))}"


# brightness on any desktop: the screen's backlight, changed through logind (no password needed)
def backlight():
    devs = sorted(Path("/sys/class/backlight").glob("*"), key=lambda d: {"firmware": 0, "platform": 1, "raw": 2}.get(read(d / "type"), 3))
    return devs[0] if devs else None


def gen_bright_get():
    d = backlight()
    try:
        return round(int(read(d / "brightness")) * 100 / int(read(d / "max_brightness"))) if d else None
    except (ValueError, ZeroDivisionError):
        return None


def gen_bright_set(v):
    d = backlight()
    if not d:
        return "echo 'This screen has no adjustable backlight (use the buttons on the monitor)'; false"
    val = max(1, int(int(read(d / "max_brightness", "100")) * int(v) / 100))
    return (f"busctl call org.freedesktop.login1 /org/freedesktop/login1/session/auto org.freedesktop.login1.Session "
            f"SetBrightness ssu backlight {q(d.name)} {val}")


# sound without PipeWire's wpctl (older PulseAudio systems)
def pa_vol(kind):
    m = re.search(r"(\d+)%", sh(f"pactl get-{kind}-volume @DEFAULT_{kind.upper()}@"))
    return int(m.group(1)) if m else None


def pa_mute(kind):
    return "yes" in sh(f"pactl get-{kind}-mute @DEFAULT_{kind.upper()}@")


# Which of the controls above need KDE Plasma
KDE_IMPL = {"dark", "nightlight", "nighttemp", "nightpreview", "dnd", "brightness", "colorscheme", "accent", "lookandfeel",
            "animspeed", "singleclick", "wallpaper", "screenoff", "autosleep", "autolock", "lockresume", "vdesks", "app_taskbar"}
KDE_PREFIXES = ("fx_", "mouse_", "panel_", "clock_", "tasks_")
FEATURES = set()

if plat.KDE:
    FEATURES |= {"kde", "themes", "effects", "panel", "clock", "tasks", "mouse", "mouseScroll", "displaysEdit", "nightpreview",
                 "singleclick", "animspeed", "vdesks", "lockresume", "taskbarPin"}
else:
    for k in [k for k in CONTROLS if k in KDE_IMPL or k.startswith(KDE_PREFIXES)]:
        del CONTROLS[k]
    CONTROLS["brightness"] = (gen_bright_get, gen_bright_set, False)
    if plat.GNOME and plat.GSETTINGS:
        FEATURES |= {"gnome", "clock", "mouse", "animtoggle", "vdesks", "taskbarPin"}
        CONTROLS.update({
            "dark": (lambda: gget(IFACE, "color-scheme") == "prefer-dark", lambda v: gset(IFACE, "color-scheme", "prefer-dark" if v else "default"), False),
            "nightlight": (lambda: gget(NIGHT, "night-light-enabled") == "true", g_night_set, False),
            "nighttemp": (lambda: g_int(NIGHT, "night-light-temperature", 4000), g_temp_set, False),
            "dnd": (lambda: gget("org.gnome.desktop.notifications", "show-banners", "true") == "false",
                    lambda v: gset("org.gnome.desktop.notifications", "show-banners", not v), False),
            "animations": (lambda: gget(IFACE, "enable-animations", "true") == "true", lambda v: gset(IFACE, "enable-animations", bool(v)), False),
            "wallpaper": (lambda: "", g_wallpaper_set, False),
            "screenoff": (lambda: g_int("org.gnome.desktop.session", "idle-delay", 300),
                          lambda v: gset("org.gnome.desktop.session", "idle-delay", f"uint32 {int(v)}"), False),
            "autosleep": (g_sleep_get, g_sleep_set, False),
            "autolock": (g_lock_get, g_lock_set, False),
            "mouse_speed": (lambda: round(float(gget("org.gnome.desktop.peripherals.mouse", "speed", "0")), 2),
                            lambda v: f"{gset('org.gnome.desktop.peripherals.mouse', 'speed', round(max(-1.0, min(1.0, float(v))), 2))} && "
                                      f"{gset('org.gnome.desktop.peripherals.touchpad', 'speed', round(max(-1.0, min(1.0, float(v))), 2))}", False),
            "mouse_natural": (*g_mouse("natural-scroll", lambda x: x == "true"), False),
            "mouse_lefthanded": (g_mouse("left-handed", lambda x: x == "true", False)[0],
                                 lambda v: gset("org.gnome.desktop.peripherals.mouse", "left-handed", bool(v)), False),
            "mouse_flat": (lambda: gget("org.gnome.desktop.peripherals.mouse", "accel-profile") == "flat", g_flat_set, False),
            "vdesks": (lambda: g_int("org.gnome.desktop.wm.preferences", "num-workspaces", 4), g_workspaces_set, False),
            "clock_seconds": (lambda: gget(IFACE, "clock-show-seconds") == "true", lambda v: gset(IFACE, "clock-show-seconds", bool(v)), False),
            "clock_date": (lambda: gget(IFACE, "clock-show-date") == "true", lambda v: gset(IFACE, "clock-show-date", bool(v)), False),
            "clock_24h": (lambda: gget(IFACE, "clock-format") == "24h", lambda v: gset(IFACE, "clock-format", "24h" if v else "12h"), False),
            "clock_weekday": (lambda: gget(IFACE, "clock-show-weekday") == "true", lambda v: gset(IFACE, "clock-show-weekday", bool(v)), False),
            "battery_pct": (lambda: gget(IFACE, "show-battery-percentage") == "true", lambda v: gset(IFACE, "show-battery-percentage", bool(v)), False),
            "app_taskbar": (lambda: f"{APP_ID}.desktop" in g_favorites(), g_taskbar_set, False),
        })
        if ghas(IFACE, "accent-color"):  # GNOME 47 and newer
            FEATURES.add("accentNamed")
            CONTROLS["accent"] = (lambda: GNOME_ACCENTS.get(gget(IFACE, "accent-color", "blue"), ""), g_accent_set, False)
        if ghas(SAVER, "ubuntu-lock-on-suspend"):
            FEATURES.add("lockresume")
            CONTROLS["lockresume"] = (lambda: gget(SAVER, "ubuntu-lock-on-suspend") == "true", lambda v: gset(SAVER, "ubuntu-lock-on-suspend", bool(v)), False)

if plat.AUDIO != "wpctl":
    CONTROLS.update({
        "volume": (lambda: pa_vol("sink"), lambda v: f"pactl set-sink-volume @DEFAULT_SINK@ {int(v)}%", False),
        "mute": (lambda: pa_mute("sink"), lambda v: f"pactl set-sink-mute @DEFAULT_SINK@ {int(bool(v))}", False),
        "mic": (lambda: pa_vol("source"), lambda v: f"pactl set-source-volume @DEFAULT_SOURCE@ {int(v)}%", False),
        "micmute": (lambda: pa_mute("source"), lambda v: f"pactl set-source-mute @DEFAULT_SOURCE@ {int(bool(v))}", False),
    })

# services: the SSH server is called "ssh" on Debian/Ubuntu; the package-cache timer is Arch's
CONTROLS["svc_sshd"] = (lambda: svc_get(plat.SSH_UNIT), svc_set(plat.SSH_UNIT), True)
if not Path("/usr/lib/systemd/system/paccache.timer").exists() and plat.FAMILY != "arch":
    CONTROLS.pop("svc_paccache.timer", None)
if not (shutil_which("virsh") or Path("/usr/lib/systemd/system/libvirtd.service").exists()):
    CONTROLS.pop("svc_libvirtd", None)
if not plat.which("avahi-daemon"):
    CONTROLS.pop("svc_avahi-daemon", None)
if not plat.which("nmcli"):
    for k in ("wifi", "airplane"):
        CONTROLS.pop(k, None)


def get_all():
    with ThreadPoolExecutor(12) as ex:
        futs = {k: ex.submit(g) for k, (g, _, _) in CONTROLS.items()}
    out = {}
    for k, f in futs.items():
        try:
            out[k] = f.result()
        except Exception:
            out[k] = None
    p = ptrs()
    out["_pointers"] = [x["name"] for x in p]
    st = panel_state() if plat.KDE else None
    out["_panel_widgets"] = st.get("widgets", []) if st else []
    return out


def command_for(cid, value):
    """Return (command, admin) for setting control `cid`, including dynamic ones."""
    if cid in CONTROLS:
        _, setter, admin = CONTROLS[cid]
        return setter(value), admin
    m = re.fullmatch(r"stream:(\d+)", cid)
    if m:
        return f"pactl set-sink-input-volume {m.group(1)} {int(value)}%", False
    m = re.fullmatch(r"streammute:(\d+)", cid)
    if m:
        return f"pactl set-sink-input-mute {m.group(1)} {int(bool(value))}", False
    m = re.fullmatch(r"display:([\w.-]+):(scale|mode|rotation)", cid)
    if m and plat.KDE:
        out, what = m.group(1), m.group(2)
        return f"kscreen-doctor output.{out}.{what}.{q(str(value))}", False
    m = re.fullmatch(r"defapp:(\w+)", cid)
    if m and m.group(1) in DEFAULT_APPS and re.fullmatch(r"[\w.-]+\.desktop", str(value)):
        mimes = DEFAULT_APPS[m.group(1)][1]
        cmd = " && ".join(f"gio mime {q(mt)} {q(value)} >/dev/null" for mt in mimes)
        if m.group(1) == "browser":
            cmd += f" && xdg-settings set default-web-browser {q(value)}"
        return cmd + f" && echo 'Default {DEFAULT_APPS[m.group(1)][0].lower()}: {value}'", False
    m = re.fullmatch(r"fanmode:(auto|quiet|balanced|cool|max|stop)", cid)
    if m:
        return fan_mode_cmd(m.group(1)), True
    if cid == "fanoverdrive":
        return fan_overdrive_cmd(value), True
    if cid == "fancustom":
        return fan_mode_cmd("custom", value), True
    m = re.fullmatch(r"autostart:(.+\.desktop)", cid)
    if m:
        return autostart_cmd(m.group(1), bool(value)), False
    m = re.fullmatch(r"autostart_remove:(.+\.desktop)", cid)
    if m:
        return autostart_remove_cmd(m.group(1)), False
    if cid == "autostart_add":
        return autostart_add_cmd(value.get("name", ""), value.get("exec", ""), value.get("comment", "")), False
    if cid == "battery_care":
        return battery_care_cmd(value), True
    m = re.fullmatch(r"btdev:(/org/bluez/[\w/]+)", cid)
    if m:
        return f"busctl call org.bluez {m.group(1)} org.bluez.Device1 {'Connect' if value else 'Disconnect'}", False
    raise KeyError(cid)


# ---------- lists for the richer panels ----------

def audio():
    def j(cmd):
        try:
            return json.loads(sh(f"pactl -f json {cmd} 2>/dev/null"))
        except Exception:
            return []
    vol = lambda v: round(sum(int(c["value_percent"].rstrip("%")) for c in v.values()) / max(1, len(v)))
    sinks = sorted(({"name": s["name"], "desc": s["description"]} for s in j("list sinks")), key=lambda d: d["desc"].lower())
    sources = sorted(({"name": s["name"], "desc": s["description"]} for s in j("list sources") if ".monitor" not in s["name"]), key=lambda d: d["desc"].lower())
    streams = [{"id": s["index"], "app": s["properties"].get("application.name", "Unknown"),
                "media": s["properties"].get("media.name", ""), "icon": s["properties"].get("application.icon_name", ""),
                "volume": vol(s["volume"]), "mute": s["mute"]} for s in j("list sink-inputs")]
    return {"sinks": sinks, "sources": sources, "streams": streams}


def displays():
    if not plat.KDE:
        return drm_displays()
    try:
        d = json.loads(sh("kscreen-doctor -j 2>/dev/null"))
    except Exception:
        return drm_displays()
    out = []
    for o in d.get("outputs", []):
        if not o.get("connected"):
            continue
        modes = sorted(o.get("modes", []), key=lambda m: (-m["size"]["width"], -m["refreshRate"]))
        out.append({"name": o["name"], "enabled": o["enabled"], "scale": o["scale"], "mode": o.get("currentModeId"),
                    "rotation": o.get("rotation"), "size": o.get("sizeMM"),
                    "modes": [{"id": m["id"], "label": f'{m["size"]["width"]}×{m["size"]["height"]} @ {round(m["refreshRate"])} Hz'} for m in modes]})
    return out


def drm_displays():
    """Connected screens as the kernel sees them (read-only: changing them is up to the desktop's settings)."""
    out = []
    for c in sorted(Path("/sys/class/drm").glob("card*-*")):
        if read(c / "status") != "connected":
            continue
        modes = list(dict.fromkeys(read(c / "modes").split()))
        out.append({"name": re.sub(r"^card\d+-", "", c.name), "enabled": read(c / "enabled") == "enabled", "scale": None,
                    "mode": modes[0] if modes else None, "rotation": None, "size": None, "readonly": True,
                    "modes": [{"id": m, "label": m.replace("x", "×")} for m in modes[:1]]})
    return out


def appearance_options():
    schemes = [l.split("*", 1)[1].split("(")[0].strip() for l in sh("plasma-apply-colorscheme --list-schemes").splitlines() if l.strip().startswith("*")] if plat.KDE else []
    lnf = sh("lookandfeeltool -l").split() if plat.KDE else []
    walls = []
    for d in sorted(glob.glob("/usr/share/wallpapers/*/")):
        imgs = glob.glob(d + "contents/images/*")
        if imgs:
            def dims(p):  # file names are WIDTHxHEIGHT
                m = re.match(r"(\d+)x(\d+)", Path(p).name)
                return (int(m[1]), int(m[2])) if m else (1, 1)
            ratio_off = lambda p: round(abs(dims(p)[0] / dims(p)[1] - 16 / 9), 2)  # closest to a 16:9 screen
            walls.append({"name": Path(d).name, "path": min(imgs, key=lambda p: (ratio_off(p), -dims(p)[0])),
                          "thumb": min(imgs, key=lambda p: (ratio_off(p), dims(p)[0]))})
        else:
            files = [f for f in glob.glob(d + "*") if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))]
            if files:
                walls.append({"name": Path(d).name, "path": files[0], "thumb": files[0]})
    for f in sorted(glob.glob("/usr/share/backgrounds/**/*", recursive=True))[:300]:  # GNOME, Ubuntu, Fedora, Mint…
        if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp")) and os.path.getsize(f) > 100_000:
            walls.append({"name": Path(f).stem.replace("_", " ").replace("-", " "), "path": f, "thumb": f})
    for f in sorted(glob.glob(str(HOME / "Pictures" / "**" / "*"), recursive=True))[:200]:
        if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp")) and os.path.getsize(f) > 150_000:
            walls.append({"name": Path(f).stem, "path": f, "thumb": f, "mine": True})
    walls.sort(key=lambda w: (bool(w.get("mine")), w["name"].lower()))  # built-in ones A-Z, then yours A-Z
    return {"schemes": sorted(schemes, key=str.lower), "lookandfeel": lnf, "wallpapers": walls}


def timezones():
    return sh("timedatectl list-timezones").splitlines()


FRIENDLY = {"Package id 0": "Whole CPU", "edge": "GPU core", "junction": "GPU hotspot", "mem": "Video memory",
            "PPT": "Power draw", "fan1": "Fan", "Composite": "Drive", "PHY Temperature": "Port chip", "MAC Temperature": "Controller"}


def sensors():
    try:
        d = json.loads(sh("sensors -j 2>/dev/null"))
    except Exception:
        return []
    nice = {"coretemp": "CPU", "amdgpu": "Graphics card", "nvme": "SSD", "applesmc": "Mac sensors", "enp4s0": "Ethernet"}
    groups = []
    for chip, vals in d.items():
        base = chip.split("-")[0]
        if base == "applesmc":  # 100+ cryptic SMC keys: keep only the fans
            items = [{"label": f"Fan {k[3:]}", "kind": "fan", "value": v.get(f"{k}_input"), "max": v.get(f"{k}_max")}
                     for k, v in vals.items() if k.startswith("fan") and isinstance(v, dict)]
        else:
            items = []
            for label, v in vals.items():
                if not isinstance(v, dict):
                    continue
                for k, x in v.items():
                    if k.endswith("_input"):
                        kind = "temp" if k.startswith("temp") else "fan" if k.startswith("fan") else "power" if k.startswith("power") else None
                        if kind:
                            mx = v.get(k.replace("_input", "_crit")) or v.get(k.replace("_input", "_max"))
                            items.append({"label": FRIENDLY.get(label, label), "kind": kind, "value": x, "max": mx})
        if items:
            groups.append({"chip": chip, "name": nice.get(base, base), "items": items})
    order = ["CPU", "Graphics card", "SSD", "Mac sensors", "Ethernet"]
    return sorted(groups, key=lambda g: order.index(g["name"]) if g["name"] in order else 99)


def vms():
    out = sh("virsh -c qemu:///system list --all --name 2>/dev/null")
    rows = []
    for name in filter(None, out.splitlines()):
        info = sh(f"virsh -c qemu:///system dominfo {q(name)} 2>/dev/null")
        f = dict(re.findall(r"^([^:]+):\s+(.*)$", info, re.M))
        osid = re.search(r'libosinfo:os id="([^"]+)"', sh(f"virsh -c qemu:///system dumpxml {q(name)} 2>/dev/null"))
        m = vms_meta().get(name, {})
        rows.append({"name": name, "state": f.get("State", "?"), "cpus": f.get("CPU(s)", ""),
                     "memory": f.get("Max memory", ""), "autostart": f.get("Autostart", "") == "enable",
                     "osid": osid.group(1) if osid else "", "os": m.get("os", ""),
                     "hint": " ".join(filter(None, [osid.group(1) if osid else "", m.get("template", ""), m.get("os", ""), m.get("iso", ""), name]))})
    return sorted(rows, key=lambda v: (v["state"] != "running", v["name"].lower()))  # running first


# ---------- creating virtual machines ----------
VIRSH = "virsh -c qemu:///system"
ISO_DIRS = [HOME / "Downloads", HOME / "ISOs", HOME / "isos", HOME, Path("/var/lib/libvirt/images")]
ISO_CACHE = HOME / ".cache" / "linux-dashboard" / "isos.json"


def _detect_iso(path):
    out = sh(f"timeout 25 osinfo-detect {q(str(path))}", 30)
    m = re.search(r"installer for OS '([^']+)'", out)
    return m.group(1) if m else ""


def isos():
    """Installer images on this computer, with the system they contain (detection is cached)."""
    from concurrent.futures import ThreadPoolExecutor
    try:
        cache = json.loads(ISO_CACHE.read_text())
    except Exception:
        cache = {}
    found = {}
    for d in ISO_DIRS:
        for f in d.glob("*.iso") if d.is_dir() else []:
            try:
                real = str(f.resolve()); st = f.stat()
            except OSError:
                continue
            found.setdefault(real, (f, st))
    todo = [p for p, (f, st) in found.items() if cache.get(p, {}).get("mtime") != st.st_mtime]
    with ThreadPoolExecutor(4) as ex:
        for p, osname in zip(todo, ex.map(_detect_iso, todo)):
            cache[p] = {"mtime": found[p][1].st_mtime, "os": osname}
    ISO_CACHE.parent.mkdir(parents=True, exist_ok=True)
    ISO_CACHE.write_text(json.dumps(cache))
    out = []
    for p, (f, st) in found.items():
        osname, low = cache[p]["os"], f.name.lower()
        if not osname:  # guess from the file name
            for key, nice in (("linuxmint", "Linux Mint"), ("ubuntu", "Ubuntu"), ("fedora", "Fedora"), ("debian", "Debian"), ("archlinux", "Arch Linux"),
                              ("manjaro", "Manjaro"), ("endeavouros", "EndeavourOS"), ("pop-os", "Pop!_OS"), ("opensuse", "openSUSE"), ("kali", "Kali Linux"),
                              ("win11", "Windows 11"), ("win10", "Windows 10"), ("windows", "Windows")):
                if key in low:
                    ver = re.search(r"(\d+(?:\.\d+)*)", f.name.split(key)[-1] if key in low else "")
                    osname = nice + (" " + ver.group(1) if ver and not nice.startswith("Windows") else "")
                    break
        arm = bool(re.search(r"aarch64|arm64|armhf", osname.lower() + low))
        family = "windows" if re.search(r"windows|win1[01]", osname.lower() + low) else "linux"
        if family == "windows":  # Microsoft's ISOs report "Windows 11" even for Windows 10; trust the file name
            osname = "Windows 11" if "win11" in low else "Windows 10" if "win10" in low else osname or "Windows"
        out.append({"path": p, "file": f.name, "size": st.st_size, "os": re.sub(r"\s*\((x86_64|aarch64|i686)\)", "", osname) or f.name,
                    "arch": "arm" if arm else "x86", "family": family})
    return sorted(out, key=lambda x: (x["arch"] != "x86", x["os"].lower()))


def vm_limits():
    import shutil as _sh
    mem = int(re.search(r"MemTotal:\s+(\d+)", read("/proc/meminfo")).group(1)) // 1024
    free = _sh.disk_usage("/var/lib/libvirt/images").free // 1024 ** 3
    names = sh(f"{VIRSH} list --all --name").split()
    return {"ram_mb": mem, "threads": os.cpu_count(), "free_gb": free, "names": names}


def vm_create_cmd(o):
    name, iso = str(o.get("name", "")), str(o.get("iso", ""))
    lim = vm_limits()
    mem, cpus, disk = int(o.get("memory", 4096)), int(o.get("cpus", 2)), int(o.get("disk", 32))
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,39}", name) or name in lim["names"]:
        raise ValueError("pick a different name (letters, numbers, dashes; not already used)")
    if not (iso.endswith(".iso") and Path(iso).is_file()):
        raise ValueError("installer file not found")
    if not (512 <= mem <= lim["ram_mb"] - 2048 and 1 <= cpus <= lim["threads"] and 8 <= disk <= max(8, lim["free_gb"] - 20)):
        raise ValueError("size out of range")
    win = bool(o.get("windows"))
    # if the installer can't be identified, use the template's profile, else a modern-Linux one (Mint 22 is based on Ubuntu 24.04)
    known = set(sh("osinfo-query os --fields=short-id 2>/dev/null").split())
    fallback = o.get("osinfo") if o.get("osinfo") in known else "ubuntu24.04" if re.search(r"mint|ubuntu|pop-os|zorin|elementary", iso.lower()) else "linux2024"
    osinfo = ("win11" if "win11" in iso.lower() else "win10") if win else f"detect=on,name={fallback}"
    bus = "sata" if win else "virtio"  # Windows' installer has no virtio disk drivers built in
    return (f"virt-install --connect qemu:///system --name {q(name)} --memory {mem} --vcpus {cpus} "
            f"--disk size={disk},format=qcow2,bus={bus} --cdrom {q(iso)} --osinfo {osinfo} "
            f"--network network=default --graphics spice --video {'qxl' if win else 'virtio'} --sound default --noautoconsole "
            f"&& echo && echo 'Virtual machine {name} created. Its window is opening, so you can install {o.get('label') or 'the system'}.'")


# ---------- what we know about each VM (system, live-session login, your notes) ----------
VMS_FILE = HOME / ".config" / "linux-dashboard" / "vms.json"
LIVE_LOGINS = [  # (match in system name or file, username, password, what to expect)
    (r"mint", "mint", "", "Linux Mint starts a live desktop. If the screen locks, the password is empty: just press Enter."),
    (r"kubuntu", "kubuntu", "", "Kubuntu starts a live desktop. If the screen locks, the password is empty: just press Enter."),
    (r"ubuntu", "ubuntu", "", "Ubuntu starts a live desktop. If the screen locks, the password is empty: just press Enter."),
    (r"fedora", "liveuser", "", "Fedora starts a live desktop as “liveuser”. If the screen locks, the password is empty: just press Enter."),
    (r"debian-live|debian.*\(.*live", "user", "live", "Debian's live desktop logs in as “user”. If the screen locks, the password is “live”."),
    (r"debian", "", "", "This is Debian's installer: no login yet. You'll create your own account during setup."),
    (r"opensuse", "", "", "This is openSUSE's installer: no login yet. You'll create your own account during setup."),
    (r"arch", "root", "", "Arch logs you in as “root” automatically, at a text prompt. Installing is done by typing commands (try “archinstall”)."),
    (r"alpine", "root", "", "Type “root” at the login prompt; there's no password. Then run “setup-alpine” to install."),
    (r"freebsd", "root", "", "FreeBSD starts its installer. If you choose its live shell instead, log in as “root” with no password."),
    (r"windows|win1[01]", "", "", "Windows starts its installer: no login yet. You'll create your own account during setup."),
]


def live_login(text):
    t = str(text).lower()
    for rx, user, pw, note in LIVE_LOGINS:
        if re.search(rx, t):
            return {"user": user, "password": pw, "note": note}
    return {"user": "", "password": "", "note": "Most installers start without a login. If a live desktop asks for a password, try leaving it empty, or check the system's website."}


def vms_meta():
    try:
        return json.loads(VMS_FILE.read_text())
    except Exception:
        return {}


def vm_meta_save(name, data):
    meta = vms_meta()
    cur = meta.get(name, {})
    cur.update({k: v for k, v in data.items() if k in ("os", "iso", "template", "notes", "created")})
    cur["login"] = live_login(f"{cur.get('template', '')} {cur.get('os', '')} {cur.get('iso', '')}")
    meta[name] = cur
    VMS_FILE.parent.mkdir(parents=True, exist_ok=True)
    VMS_FILE.write_text(json.dumps(meta, indent=1))
    return cur


def vm_meta_get(name):
    m = vms_meta().get(name)
    if not m:  # a VM made elsewhere: guess from its installer disc, if one is attached
        disc = sh(f"{VIRSH} domblklist {q(name)} --details 2>/dev/null | awk '$2==\"cdrom\"{{print $4}}'")
        m = {"os": "", "iso": disc if disc != "-" else "", "login": live_login(name + " " + disc)}
    return m


def vm_delete_cmd(name):
    if name not in vm_limits()["names"]:
        raise ValueError("no such virtual machine")
    return (f"{VIRSH} destroy {q(name)} >/dev/null 2>&1; {VIRSH} undefine {q(name)} --remove-all-storage --nvram 2>/dev/null "
            f"|| {VIRSH} undefine {q(name)} --remove-all-storage")


def autostart_dirs():
    return [Path("/etc/xdg/autostart"), HOME / ".config" / "autostart"]


def parse_desktop(path):
    d = {}
    for line in read(path).splitlines():
        if line.startswith("[") and d:
            break
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            d.setdefault(k.strip(), v.strip())
    return d


def autostart():
    entries = {}
    for base in autostart_dirs():
        for f in sorted(base.glob("*.desktop")):
            d = parse_desktop(f)
            entries[f.name] = {"file": f.name, "name": d.get("Name", f.stem), "comment": d.get("Comment", ""),
                               "icon": d.get("Icon", ""), "user": base != autostart_dirs()[0],
                               "enabled": not truthy(d.get("Hidden", "false")) and d.get("X-GNOME-Autostart-enabled", "true") != "false",
                               "system": "OnlyShowIn" in d or "X-KDE-autostart-phase" in d}
    return sorted(entries.values(), key=lambda e: e["name"].lower())


def autostart_cmd(fname, enabled):
    user = HOME / ".config" / "autostart" / fname
    system = Path("/etc/xdg/autostart") / fname
    src = user if user.exists() else system
    # A user copy with Hidden=true switches a system entry off without touching /etc
    steps = ["mkdir -p ~/.config/autostart"]
    if src != user:
        steps.append(f"cp {q(str(src))} {q(str(user))}")
    steps.append(f"sed -i '/^Hidden=/d' {q(str(user))}")
    if not enabled:
        add_hidden = r"0,/^\[Desktop Entry\]/s//[Desktop Entry]\nHidden=true/"
        steps.append(f"sed -i {q(add_hidden)} {q(str(user))}")
    return " && ".join(steps)


def autostart_remove_cmd(fname):
    user = HOME / ".config" / "autostart" / fname
    system = Path("/etc/xdg/autostart") / fname
    if system.exists():
        return autostart_cmd(fname, False)
    return f"rm -f {q(str(user))} && echo 'Removed {fname}'"


def autostart_add_cmd(name, exec_cmd, comment=""):
    safe_id = re.sub(r"[^\w.-]", "-", name.lower()).strip("-") or "custom-app"
    fname = f"{safe_id}.desktop"
    dst = HOME / ".config" / "autostart" / fname
    content = f"[Desktop Entry]\nType=Application\nName={name}\nExec={exec_cmd}\nComment={comment}\nX-GNOME-Autostart-enabled=true\n"
    return f"mkdir -p ~/.config/autostart && printf %s {q(content)} > {q(str(dst))} && echo 'Added {name} to startup'"



def bluetooth_devices():
    if sh("systemctl is-active bluetooth") != "active":
        return {"available": False, "devices": []}
    try:
        data = json.loads(sh("busctl call org.bluez / org.freedesktop.DBus.ObjectManager GetManagedObjects --json=short"))["data"][0]
    except Exception:
        return {"available": True, "devices": []}
    devs = []
    for path, ifaces in data.items():
        dev = ifaces.get("org.bluez.Device1")
        if dev and dev.get("Paired", {}).get("data"):
            devs.append({"path": path, "name": dev.get("Alias", {}).get("data") or dev.get("Address", {}).get("data"),
                         "connected": dev.get("Connected", {}).get("data", False), "icon": dev.get("Icon", {}).get("data", "")})
    return {"available": True, "devices": sorted(devs, key=lambda d: (not d["connected"], str(d["name"]).lower()))}


def drives():
    try:
        d = json.loads(sh("lsblk -J -b -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT,LABEL,MODEL,RM,HOTPLUG,FSUSED,FSSIZE,PATH"))
    except Exception:
        return []
    out = []

    def walk(n, model=""):
        model = n.get("model") or model
        if n.get("mountpoint") and n.get("fssize") and n["mountpoint"] not in ("[SWAP]",) and not n["mountpoint"].startswith("/boot") and not n["mountpoint"].startswith("/efi"):
            out.append({"name": (n["label"] or model or n["name"]).strip(), "path": n["path"], "mount": n["mountpoint"], "fs": n["fstype"],
                        "size": int(n["fssize"]), "used": int(n["fsused"] or 0), "removable": bool(n["rm"] or n["hotplug"])})
        elif n.get("type") == "part" and not n.get("mountpoint") and n.get("fstype") not in (None, "swap", "vfat", "crypto_LUKS") and (n.get("hotplug") or n.get("rm")):
            out.append({"name": (n["label"] or model or n["name"]).strip(), "path": n["path"], "mount": None, "fs": n["fstype"],
                        "size": int(n["size"]), "used": 0, "removable": True})
        for c in n.get("children", []) or []:
            walk(c, model)
    for dev in d.get("blockdevices", []):
        if dev["type"] not in ("loop", "rom"):
            walk(dev)
    seen, uniq = set(), []
    for x in out:  # btrfs subvolumes repeat the same device
        if x["path"] not in seen:
            seen.add(x["path"])
            uniq.append(x)
    return sorted(uniq, key=lambda d: (d["mount"] != "/", d["removable"], d["name"].lower()))  # system drive first


def kdeconnect():
    out = sh("kdeconnect-cli -a --id-name-only 2>/dev/null")
    return [{"id": l.split(" ", 1)[0], "name": l.split(" ", 1)[1] if " " in l else l} for l in out.splitlines() if l.strip()]


# ---------- battery information & health ----------
def battery_info():
    bats = []
    for b in sorted(Path("/sys/class/power_supply").glob("BAT*")):
        full_design = to_int(read(b / "charge_full_design" if (b / "charge_full_design").exists() else b / "energy_full_design", "0"))
        full = to_int(read(b / "charge_full" if (b / "charge_full").exists() else b / "energy_full", "0"))
        now = to_int(read(b / "charge_now" if (b / "charge_now").exists() else b / "energy_now", "0"))
        cycles = to_int(read(b / "cycle_count", "0"))
        status = read(b / "status", "Unknown")
        capacity = to_int(read(b / "capacity", "0"))
        voltage = to_int(read(b / "voltage_now", "0")) / 1000000
        current = to_int(read(b / "current_now", "0")) / 1000000
        power = to_int(read(b / "power_now", "0")) / 1000000
        watts = round(power if power > 0 else (voltage * current if voltage > 0 and current > 0 else 0), 2)
        exact_pct = round((now / full) * 100, 4) if full > 0 and now > 0 else float(capacity)
        if exact_pct > 100.0:
            exact_pct = 100.0
        health = round((full / full_design) * 100, 2) if full_design > 0 and full > 0 else None
        bats.append({
            "name": b.name,
            "status": status,
            "capacity": capacity,
            "exact_pct": exact_pct,
            "voltage": round(voltage, 2) if voltage > 0 else None,
            "watts": watts if watts > 0 else None,
            "health": health,
            "cycles": cycles,
            "manufacturer": read(b / "manufacturer", ""),
            "model": read(b / "model_name", ""),
            "technology": read(b / "technology", "Li-ion"),
        })
    threshold_nodes = battery_nodes()
    return {
        "present": bool(bats),
        "batteries": bats,
        "supported": bool(threshold_nodes),
        "limit": battery_care_get() if threshold_nodes else None,
    }


def battery_nodes():
    nodes = []
    for b in sorted(Path("/sys/class/power_supply").glob("BAT*")):
        end_lim = b / "charge_control_end_threshold"
        max_lim = b / "charge_control_limit_max"
        thresh = b / "charge_stop_threshold"
        node = end_lim if end_lim.exists() else max_lim if max_lim.exists() else thresh if thresh.exists() else None
        if node:
            nodes.append(node)
    return nodes


def battery_care_supported():
    return bool(battery_nodes())


def battery_care_get():
    for n in battery_nodes():
        val = to_int(read(n, "100"))
        if val > 0:
            return val
    return 100


# ---------- crash reporter (coredumpctl & systemd logs) ----------
def list_crashes():
    raw = sh("coredumpctl --json=short list --no-pager 2>/dev/null", 8)
    try:
        entries = json.loads(raw)
        results = []
        for e in reversed(entries[-20:]):
            import datetime
            ts = e.get("time", 0) // 1000000
            time_str = datetime.datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S") if ts else "Unknown"
            results.append({
                "pid": e.get("pid"),
                "sig": e.get("sig"),
                "exe": e.get("exe"),
                "name": Path(e.get("exe", "")).name if e.get("exe") else f"PID {e.get('pid')}",
                "size_mb": round(e.get("size", 0) / (1024 * 1024), 2),
                "time": time_str,
            })
        return results
    except Exception:
        # Fallback to failed systemd units
        failed = sh("systemctl --failed --no-legend --plain; systemctl --user --failed --no-legend --plain", 5)
        res = []
        for line in failed.splitlines():
            p = line.split()
            if p:
                res.append({"pid": 0, "sig": 0, "exe": p[0], "name": p[0], "size_mb": 0, "time": "recently"})
        return res


def crash_info(pid):
    pid = int(pid)
    return sh(f"coredumpctl info {pid} 2>&1 | head -50", 10)


def battery_care_cmd(limit):
    limit = max(50, min(100, int(limit)))
    nodes = battery_nodes()
    if not nodes:
        raise ValueError("No battery charge threshold control found on this hardware")
    writes = " && ".join(f"echo {limit} > {q(str(n))}" for n in nodes)
    return f"pkexec bash -c {q(writes)} && echo 'Battery charge limit set to {limit}%'"


# ---------- in-app self update checker ----------
REPO_SLUG = "mumbo235/Linux-Dashboard"


def check_app_update():
    import urllib.request
    current_ver = read(APP_DIR / "VERSION", "1.0").strip() if "APP_DIR" in globals() else "1.0"
    url = f"https://api.github.com/repos/{REPO_SLUG}/releases/latest"
    req = urllib.request.Request(url, headers={"User-Agent": "Linux-Dashboard", "Accept": "application/vnd.github+json"})
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            tag = data.get("tag_name", "").lstrip("v")
            installer_url = None
            for asset in data.get("assets", []):
                if asset.get("name") == "linux-dashboard-install.sh":
                    installer_url = asset.get("browser_download_url")
                    break
            has_update = False
            if tag:
                c_parts = [int(p) for p in re.findall(r"\d+", current_ver)]
                t_parts = [int(p) for p in re.findall(r"\d+", tag)]
                has_update = t_parts > c_parts
            return {
                "current": current_ver,
                "latest": tag,
                "has_update": has_update,
                "installer_url": installer_url,
                "release_url": data.get("html_url"),
                "notes": data.get("body", ""),
            }
    except Exception as e:
        return {"current": current_ver, "latest": None, "has_update": False, "error": str(e)}

