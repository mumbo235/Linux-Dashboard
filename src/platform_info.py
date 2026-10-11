"""Which Linux this is: the package manager, the desktop and the everyday apps.

The dashboard asks this module instead of assuming Arch + KDE, so the same buttons
work on Ubuntu, Debian, Mint, Fedora, openSUSE, Arch and their relatives, with KDE
Plasma, GNOME or another desktop. Anything a system can't do is simply left out.
"""
import os
import re
import shlex
import shutil
import subprocess
from pathlib import Path

q = shlex.quote
ENV = dict(os.environ, LANG="C.UTF-8", NO_COLOR="1")


def sh(cmd, timeout=30):
    try:
        return subprocess.run(cmd, shell=isinstance(cmd, str), capture_output=True, text=True, timeout=timeout, env=ENV).stdout
    except Exception:
        return ""


def which(*names):
    return next((n for n in names if shutil.which(n)), None)


# ---------- the distribution ----------

def os_release():
    d = {}
    for f in ("/etc/os-release", "/usr/lib/os-release"):
        try:
            for line in Path(f).read_text().splitlines():
                if "=" in line:
                    k, v = line.split("=", 1)
                    d[k] = v.strip().strip('"')
            break
        except OSError:
            pass
    return d


OSR = os_release()
DISTRO_ID = OSR.get("ID", "linux")
LIKE = f"{DISTRO_ID} {OSR.get('ID_LIKE', '')}".lower()
PRETTY = OSR.get("PRETTY_NAME", "Linux")

if which("pacman") and re.search(r"\b(arch|manjaro|endeavouros|cachyos|garuda)\b", LIKE + " arch"):
    FAMILY = "arch"
elif which("apt-get") and which("dpkg"):
    FAMILY = "debian"
elif which("dnf", "dnf5"):
    FAMILY = "fedora"
elif which("zypper"):
    FAMILY = "suse"
elif which("pacman"):
    FAMILY = "arch"
else:
    FAMILY = "other"

AUR = which("yay", "paru") if FAMILY == "arch" else None
DNF = which("dnf5", "dnf") if FAMILY == "fedora" else None
FLATPAK = bool(which("flatpak"))
SNAP = bool(which("snap"))
ROLLING = FAMILY == "arch" or "tumbleweed" in DISTRO_ID or DISTRO_ID in ("opensuse-slowroll",)

FAMILY_NAME = {"arch": "Arch", "debian": "Debian/Ubuntu", "fedora": "Fedora", "suse": "openSUSE", "other": "Linux"}[FAMILY]
REPO_NAME = OSR.get("NAME", FAMILY_NAME).replace(" GNU/Linux", "").replace(" Linux", "") or FAMILY_NAME

# ---------- the desktop ----------
_desk = (os.environ.get("XDG_CURRENT_DESKTOP") or os.environ.get("DESKTOP_SESSION") or "").lower()
if "kde" in _desk or "plasma" in _desk:
    DESKTOP = "kde"
elif re.search(r"gnome|ubuntu|unity|pop", _desk) and "budgie" not in _desk:
    DESKTOP = "gnome"
elif "cinnamon" in _desk:
    DESKTOP = "cinnamon"
elif "xfce" in _desk:
    DESKTOP = "xfce"
else:
    DESKTOP = "other"
DESKTOP_NAME = {"kde": "KDE Plasma", "gnome": "GNOME", "cinnamon": "Cinnamon", "xfce": "Xfce"}.get(
    DESKTOP, os.environ.get("XDG_CURRENT_DESKTOP", "your desktop").split(":")[0] or "your desktop")
KDE, GNOME = DESKTOP == "kde", DESKTOP == "gnome"
QDBUS = which("qdbus6", "qdbus-qt6", "qdbus") or "qdbus6"
GSETTINGS = bool(which("gsettings"))

# ---------- everyday apps ----------
# terminal: (program, open in a folder, run a command in a folder). {dir} and {cmd} arrive already shell-quoted.
TERMINALS = {
    "konsole": ("Konsole", "konsole --workdir {dir}", "konsole --workdir {dir} -e bash -c {cmd}"),
    "ptyxis": ("Terminal", "ptyxis --new-window --working-directory={dir}", "ptyxis --new-window --working-directory={dir} -- bash -c {cmd}"),
    "kgx": ("Console", "kgx --working-directory={dir}", "kgx --working-directory={dir} -- bash -c {cmd}"),
    "gnome-terminal": ("Terminal", "gnome-terminal --working-directory={dir}", "gnome-terminal --working-directory={dir} -- bash -c {cmd}"),
    "xfce4-terminal": ("Terminal", "xfce4-terminal --working-directory={dir}", "xfce4-terminal --working-directory={dir} -x bash -c {cmd}"),
    "mate-terminal": ("Terminal", "mate-terminal --working-directory={dir}", "mate-terminal --working-directory={dir} -x bash -c {cmd}"),
    "tilix": ("Tilix", "tilix -w {dir}", "tilix -w {dir} -e bash -c {cmd}"),
    "lxqt-terminal": ("Terminal", "lxqt-terminal --workdir {dir}", "lxqt-terminal --workdir {dir} -e bash -c {cmd}"),
    "kitty": ("kitty", "kitty -d {dir}", "kitty -d {dir} bash -c {cmd}"),
    "alacritty": ("Alacritty", "alacritty --working-directory {dir}", "alacritty --working-directory {dir} -e bash -c {cmd}"),
    "wezterm": ("WezTerm", "wezterm start --cwd {dir}", "wezterm start --cwd {dir} -- bash -c {cmd}"),
    "foot": ("foot", "foot -D {dir}", "foot -D {dir} bash -c {cmd}"),
    "xterm": ("XTerm", "cd {dir} && xterm", "cd {dir} && xterm -e bash -c {cmd}"),
}
_term_order = {"kde": ["konsole"], "gnome": ["ptyxis", "kgx", "gnome-terminal"], "xfce": ["xfce4-terminal"],
               "cinnamon": ["gnome-terminal"]}.get(DESKTOP, []) + list(TERMINALS)
TERMINAL = which(*_term_order) or "xterm"

SETTINGS_APPS = {"kde": "systemsettings", "gnome": "gnome-control-center", "cinnamon": "cinnamon-settings",
                 "xfce": "xfce4-settings-manager"}
SETTINGS_APP = which(SETTINGS_APPS.get(DESKTOP, ""), "systemsettings", "gnome-control-center", "cinnamon-settings",
                     "xfce4-settings-manager", "mate-control-center", "lxqt-config")
# settings pages: open the right panel when the desktop's settings app supports it
SETTINGS_PAGES = {
    "systemsettings": {"bluetooth": "systemsettings kcm_bluetooth", "kdeconnect": "systemsettings kcm_kdeconnect", "display": "systemsettings kcm_kscreen"},
    "gnome-control-center": {"bluetooth": "gnome-control-center bluetooth", "display": "gnome-control-center display"},
    "cinnamon-settings": {"bluetooth": "blueman-manager", "display": "cinnamon-settings display"},
}.get(SETTINGS_APP or "", {})

SCREENSHOT = None
if which("spectacle"):
    SCREENSHOT = {"region": "spectacle -r", "full": "spectacle -f", "window": "spectacle -a"}
elif which("gnome-screenshot"):
    SCREENSHOT = {"region": "gnome-screenshot -a -i", "full": "gnome-screenshot -i", "window": "gnome-screenshot -w -i"}
elif which("xfce4-screenshooter"):
    SCREENSHOT = {"region": "xfce4-screenshooter -r", "full": "xfce4-screenshooter -f", "window": "xfce4-screenshooter -w"}
elif GNOME:  # GNOME 42+: the screenshot tool is built into the shell (Print Screen key)
    SCREENSHOT = {"region": f"gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval 'Main.screenshotUI.open()' >/dev/null 2>&1 || xdg-open screenshot: 2>/dev/null"}

if KDE:
    LOGOUT = f"{QDBUS} org.kde.Shutdown /Shutdown org.kde.Shutdown.logout"
elif GNOME and which("gnome-session-quit"):
    LOGOUT = "gnome-session-quit --logout --no-prompt"
elif DESKTOP == "cinnamon" and which("cinnamon-session-quit"):
    LOGOUT = "cinnamon-session-quit --logout --no-prompt"
elif DESKTOP == "xfce" and which("xfce4-session-logout"):
    LOGOUT = "xfce4-session-logout --logout"
else:
    LOGOUT = 'loginctl terminate-session "$XDG_SESSION_ID"'

EDITOR = which("code", "zed", "kate", "gnome-text-editor", "gedit", "xed", "mousepad", "kwrite")
SSH_UNIT = "ssh" if FAMILY == "debian" else "sshd"
AUDIO = "wpctl" if which("wpctl") else "pactl"


# ---------- packages ----------
def pk(script):
    """Run a little script as administrator (one password box)."""
    return f"pkexec bash -c {q(script)}"


APT = "DEBIAN_FRONTEND=noninteractive apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold"
FLATPAK_UPDATE = "flatpak update -y --noninteractive" if FLATPAK else ""
FLATPAK_CLEAN = "flatpak uninstall --unused -y --noninteractive" if FLATPAK else ""
SNAP_UPDATE = "snap refresh" if SNAP else ""


def _join(*parts, sep="; "):
    return sep.join(p for p in parts if p)


def _arch():
    aur_flags = "--noconfirm --color never --sudo pkexec --answerdiff None --answerclean None"
    check_repo = ('T=$(mktemp -d); ln -s /var/lib/pacman/local "$T/local"; '
                  'if fakeroot -- pacman -Sy --dbpath "$T" --logfile /dev/null --disable-sandbox >/dev/null 2>&1; '
                  'then pacman -Qu --dbpath "$T" --color never || echo "Up to date"; else echo "Couldn\'t reach the package servers. Are you online?"; fi; rm -rf "$T"')
    count_repo = ('T=$(mktemp -d); ln -s /var/lib/pacman/local "$T/local"; '
                  'if fakeroot -- pacman -Sy --dbpath "$T" --logfile /dev/null --disable-sandbox >/dev/null 2>&1; '
                  'then R=$(pacman -Qu --dbpath "$T" 2>/dev/null | wc -l); else R=-1; fi; rm -rf "$T"; echo $R')
    return {
        "manager": "pacman", "install": "pkexec pacman -S --needed --noconfirm --color never {pkg}",
        "remove": "pkexec pacman -Rns --noconfirm --color never {pkg}",
        "install_aur": f"{AUR} -S --needed {aur_flags} {{pkg}}" if AUR else "",
        "update": _join(f"{AUR} -Syu {aur_flags} --removemake" if AUR else "pkexec pacman -Syu --noconfirm --color never", FLATPAK_UPDATE, sep=" && "),
        "cleanup": _join(pk('O=$(pacman -Qdtq); if [ -n "$O" ]; then echo "Removing unused packages:" $O; pacman -Rns --noconfirm --color never $O; '
                            'else echo "No unused packages."; fi; pacman -Sc --noconfirm --color never'),
                         f"{AUR} -Sc --aur --noconfirm 2>/dev/null" if AUR else "", FLATPAK_CLEAN),
        "cache_dir": "/var/cache/pacman/pkg", "cache_clean": "pkexec pacman -Sc --noconfirm --color never",
        "check": _join('echo "== Official repos =="', check_repo,
                       f'echo; echo "== AUR =="; {AUR} -Qua --color never 2>/dev/null || echo "Up to date"' if AUR else ""),
        "count_repo": count_repo, "count_aur": f"{AUR} -Qua 2>/dev/null | wc -l" if AUR else "",
        "info": "pacman -Qi {pkg}", "owner": "pacman -Qo {file}", "files": "pacman -Ql {pkg} | head -30",
    }


def _debian():
    return {
        "manager": "apt", "install": f"pkexec env {APT} install {{pkg}}", "remove": f"pkexec env {APT} remove {{pkg}}",
        "update": _join(pk(f"{APT} update && {APT} full-upgrade" + (" && snap refresh" if SNAP else "")), FLATPAK_UPDATE, sep=" && "),
        "cleanup": _join(pk(f"{APT} autoremove && apt-get clean && echo 'Removed unused packages and old downloads.'"), FLATPAK_CLEAN),
        "cache_dir": "/var/cache/apt/archives", "cache_clean": "pkexec apt-get clean",
        "check": 'echo "== System packages (as of the last package-list refresh) =="; apt list --upgradable 2>/dev/null | tail -n +2 | grep . || echo "Up to date"',
        "count_repo": "apt-get -s -o Debug::NoLocking=1 dist-upgrade 2>/dev/null | grep -c '^Inst '",
        "info": "apt-cache show --no-all-versions {pkg}", "owner": "dpkg -S {file}", "files": "dpkg -L {pkg} | head -30",
    }


def _fedora():
    d = DNF or "dnf"
    return {
        "manager": "dnf", "install": f"pkexec {d} install -y {{pkg}}", "remove": f"pkexec {d} remove -y {{pkg}}",
        "update": _join(f"pkexec {d} upgrade -y --refresh", FLATPAK_UPDATE, sep=" && "),
        "cleanup": _join(pk(f"{d} autoremove -y && {d} clean packages"), FLATPAK_CLEAN),
        "cache_dir": "/var/cache/libdnf5" if Path("/var/cache/libdnf5").is_dir() else "/var/cache/dnf",
        "cache_clean": f"pkexec {d} clean packages",
        "check": f'echo "== System packages =="; {d} -q check-update 2>/dev/null | grep . || echo "Up to date"',
        "count_repo": f"{d} -q check-update 2>/dev/null | grep -cE '^[A-Za-z0-9_.+-]+\\.(x86_64|noarch|i686|aarch64)\\s'",
        "info": f"{d} info {{pkg}}", "owner": "rpm -qf {file}", "files": "rpm -ql {pkg} | head -30",
    }


def _suse():
    up = "dup" if ROLLING else "update"
    return {
        "manager": "zypper", "install": "pkexec zypper --non-interactive install {pkg}",
        "remove": "pkexec zypper --non-interactive remove --clean-deps {pkg}",
        "update": _join(f"pkexec zypper --non-interactive {up}", FLATPAK_UPDATE, sep=" && "),
        "cleanup": _join("pkexec zypper clean --all", FLATPAK_CLEAN),
        "cache_dir": "/var/cache/zypp/packages", "cache_clean": "pkexec zypper clean --all",
        "check": 'echo "== System packages =="; zypper --no-refresh -q list-updates 2>/dev/null | grep . || echo "Up to date"',
        "count_repo": "zypper --no-refresh -q list-updates 2>/dev/null | grep -c '^v '",
        "info": "zypper --no-refresh info {pkg}", "owner": "rpm -qf {file}", "files": "rpm -ql {pkg} | head -30",
    }


def _other():
    return {"manager": "", "install": "", "remove": "", "update": FLATPAK_UPDATE or "echo 'No package manager the dashboard knows.'",
            "cleanup": FLATPAK_CLEAN or "true", "cache_dir": "", "cache_clean": "", "check": "true", "count_repo": "echo -1",
            "info": "", "owner": "", "files": ""}


PKG = {"arch": _arch, "debian": _debian, "fedora": _fedora, "suse": _suse}.get(FAMILY, _other)()
if FLATPAK:
    PKG["check"] = _join(PKG["check"], 'echo; echo "== Flatpak apps =="; flatpak remote-ls --updates --columns=application,version 2>/dev/null | sort -u | grep . || echo "Up to date"')
PKG["install_flatpak"] = "flatpak install -y --noninteractive flathub {pkg}"
PKG["remove_flatpak"] = "flatpak uninstall -y --noninteractive {pkg}"
PKG["install_snap"] = "pkexec snap install {pkg}"
PKG["remove_snap"] = "pkexec snap remove {pkg}"


def install_cmd(names):
    """Install system packages: names is {family: "pkg names"} or one string used everywhere."""
    pkgs = names.get(FAMILY) if isinstance(names, dict) else names
    if not pkgs or not PKG["install"]:
        return ""
    return PKG["install"].replace("pkexec ", "", 1).format(pkg=pkgs)  # callers wrap it in their own pkexec bash -c


def installed_names():
    if FAMILY == "arch":
        return set(sh(["pacman", "-Qq"]).split())
    if FAMILY == "debian":
        return {l.split("\t")[0].split(":")[0] for l in sh(["dpkg-query", "-W", "-f", "${Package}\\t${Status}\\n"]).splitlines() if "install ok installed" in l}
    if FAMILY in ("fedora", "suse"):
        return set(sh(["rpm", "-qa", "--qf", "%{NAME}\\n"]).split())
    return set()


def package_count():
    return len(installed_names())


def orphan_count():
    if FAMILY == "arch":
        return len(sh(["pacman", "-Qdtq"]).split())
    if FAMILY == "debian":
        return sum(1 for l in sh("apt-get -s -o Debug::NoLocking=1 autoremove 2>/dev/null").splitlines() if l.startswith("Remv "))
    if FAMILY == "fedora":
        return len(sh(f"{DNF} -q repoquery --unneeded 2>/dev/null", 60).split())
    if FAMILY == "suse":
        return sum(1 for l in sh("zypper --no-refresh -q packages --unneeded 2>/dev/null", 60).splitlines() if l.startswith("i"))
    return 0


def _parse_pacman(out, source):
    rows, cur = [], None
    for line in out.splitlines():
        if not line.startswith(" "):
            head = line.split()
            if not head:
                continue
            repo, _, name = head[0].partition("/")
            cur = {"repo": repo, "name": name, "version": head[1] if len(head) > 1 else "",
                   "installed": "[installed" in line or "(Installed" in line, "desc": "", "source": source}
            rows.append(cur)
        elif cur:
            cur["desc"] += line.strip() + " "
    return rows


def search(term):
    """Search the system's own repositories (and the AUR on Arch)."""
    rows = []
    if FAMILY == "arch":
        rows = _parse_pacman(sh(["pacman", "-Ss", "--color", "never", term]), "repo")
        if AUR:
            rows += _parse_pacman(sh([AUR, "-Ssa", "--color", "never", "--topdown", term], 30), "aur")
    elif FAMILY == "debian":
        have = installed_names()
        for line in sh(["apt-cache", "search", "--", term], 30).splitlines()[:400]:
            name, _, desc = line.partition(" - ")
            if name:
                rows.append({"repo": REPO_NAME, "name": name.strip(), "version": "", "desc": desc, "installed": name.strip() in have, "source": "repo"})
    elif FAMILY == "fedora":
        have, seen = installed_names(), set()
        for line in sh([DNF, "-q", "search", term], 60).splitlines():
            m = re.match(r"^\s*([\w.+-]+?)\.(x86_64|noarch|i686|aarch64)\s*[:\t]?\s*(.*)$", line)
            if m and m.group(1) not in seen:
                seen.add(m.group(1))
                rows.append({"repo": REPO_NAME, "name": m.group(1), "version": "", "desc": m.group(3).lstrip(": "), "installed": m.group(1) in have, "source": "repo"})
    elif FAMILY == "suse":
        for line in sh(["zypper", "--no-refresh", "-q", "search", "-t", "package", term], 60).splitlines():
            f = [x.strip() for x in line.split("|")]
            if len(f) >= 3 and f[1] and f[1] != "Name" and not set(f[1]) <= set("-+"):
                rows.append({"repo": REPO_NAME, "name": f[1], "version": "", "desc": f[2], "installed": f[0].startswith("i"), "source": "repo"})
    if SNAP:
        for line in sh(["snap", "find", term], 30).splitlines()[1:40]:
            f = line.split(None, 4)
            if len(f) >= 5:
                rows.append({"repo": "snap", "name": f[0], "version": f[1], "desc": f[4], "installed": False, "source": "snap"})
    return rows


def installed():
    """Apps and packages the person installed (not everything the system pulled in)."""
    rows = []
    if FAMILY == "arch":
        explicit, foreign = set(sh(["pacman", "-Qeq"]).split()), set(sh(["pacman", "-Qmq"]).split())
        for line in sh(["pacman", "-Q"]).splitlines():
            name, _, ver = line.partition(" ")
            if name in explicit:
                rows.append({"name": name, "version": ver, "source": "aur" if name in foreign else "repo"})
    elif FAMILY == "debian":
        manual = set(sh(["apt-mark", "showmanual"]).split())
        for line in sh(["dpkg-query", "-W", "-f", "${Package} ${Version} ${Status}\\n"]).splitlines():
            f = line.split(" ", 2)
            if len(f) == 3 and f[0] in manual and "installed" in f[2]:
                rows.append({"name": f[0], "version": f[1], "source": "repo"})
    elif FAMILY in ("fedora", "suse"):
        if FAMILY == "fedora":
            user = set(sh(f"{DNF} -q repoquery --userinstalled --qf '%{{name}}\\n' 2>/dev/null", 60).split())
        else:
            user = {f[1].strip() for f in (l.split("|") for l in sh("zypper --no-refresh -q search -i -t package 2>/dev/null", 60).splitlines())
                    if len(f) > 2 and f[0].strip() == "i+"}
        for line in sh(["rpm", "-qa", "--qf", "%{NAME} %{VERSION}-%{RELEASE}\\n"]).splitlines():
            name, _, ver = line.partition(" ")
            if not user or name in user:
                rows.append({"name": name, "version": ver, "source": "repo"})
    if SNAP:
        for line in sh(["snap", "list"]).splitlines()[1:]:
            f = line.split()
            if len(f) >= 2 and f[0] not in ("core", "core18", "core20", "core22", "core24", "snapd", "bare") and not f[0].startswith(("gnome-", "gtk-", "kf5-", "mesa-")):
                rows.append({"name": f[0], "version": f[1], "source": "snap"})
    return rows


# font / extra package names that differ between systems
PACKAGES = {
    "t2fanrd": {"arch": "t2fanrd", "debian": "t2fanrd", "fedora": "t2fanrd", "suse": "t2fanrd"},
    "zram": {"arch": "zram-generator", "debian": "systemd-zram-generator", "fedora": "zram-generator", "suse": "zram-generator"},
}


def summary():
    """What the web page needs to know (sent once, at startup)."""
    has_kdc = bool(which("kdeconnect-cli"))
    return {
        "distro": PRETTY, "distroId": DISTRO_ID, "family": FAMILY, "familyName": FAMILY_NAME, "repoName": REPO_NAME,
        "desktop": DESKTOP, "desktopName": DESKTOP_NAME, "session": os.environ.get("XDG_SESSION_TYPE", ""),
        "aur": AUR or "", "flatpak": FLATPAK, "snap": SNAP, "manager": PKG["manager"], "rolling": ROLLING,
        "pkg": {k: v for k, v in PKG.items()},
        "terminal": {"name": TERMINALS.get(TERMINAL, ("Terminal",))[0], "open": TERMINALS.get(TERMINAL, TERMINALS["xterm"])[1],
                     "run": TERMINALS.get(TERMINAL, TERMINALS["xterm"])[2], "bin": TERMINAL},
        "settingsApp": SETTINGS_APP or "", "settingsPages": SETTINGS_PAGES,
        "screenshot": SCREENSHOT or {}, "logout": LOGOUT, "editor": EDITOR or "",
        "kdeconnect": has_kdc, "battery": any((p / "type").read_text().strip() == "Battery" for p in Path("/sys/class/power_supply").glob("*") if (p / "type").exists()), "pipewire": AUDIO == "wpctl",
        "colorPick": KDE, "restartShell": "systemctl --user restart plasma-plasmashell" if KDE else "",
    }
