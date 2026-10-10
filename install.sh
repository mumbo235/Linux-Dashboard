#!/usr/bin/env bash
# Linux Dashboard installer: works for any user on Arch, Debian/Ubuntu/Mint, Fedora and openSUSE.
#
#   bash install.sh          copy the app to ~/.local/share/linux-dashboard and add it to the app menu
#   bash install.sh --here   use the app from this folder instead of copying it
#   bash install.sh --yes    install missing system packages (and open the app) without asking
#   bash install.sh --uninstall   remove it again (add --purge to delete settings and chats too)
#
# Nothing is installed system-wide except the packages the app needs (and only after you agree).
# Double-clicking this file installs it with pop-up windows (or, failing that, in a terminal window).

# Started with "sh install.sh"? Switch to bash, which the rest of this needs.
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
set -euo pipefail

# ---------- double-clicked from the file manager: pop-up windows, or reopen in a terminal ----------
# (no terminal on input *and* output; just piping into it, e.g. "curl … | bash", isn't a double-click)
DBL=0
if [ ! -t 0 ] && [ ! -t 1 ] && [ -z "${LD_IN_TERMINAL:-}" ]; then DBL=1; export LD_IN_TERMINAL=1; fi
if [ "$DBL" = 1 ] && [ -n "${WAYLAND_DISPLAY:-}${DISPLAY:-}" ] && {
     /usr/bin/python3 -c 'import gi; gi.require_version("Gtk", "4.0"); from gi.repository import Gtk' 2>/dev/null ||
     command -v kdialog >/dev/null || command -v zenity >/dev/null; }; then
  export LD_GUI=1  # GTK, kdialog or zenity can show the windows: no terminal needed
elif [ "$DBL" = 1 ]; then
  self="$(readlink -f "${BASH_SOURCE[0]}")"
  args=""; [ $# -gt 0 ] && args="$(printf '%q ' "$@")"
  run="bash $(printf %q "$self") $args; echo; read -rp 'Press Enter to close this window… ' _"
  for t in konsole gnome-terminal kgx ptyxis xfce4-terminal mate-terminal lxterminal tilix alacritty kitty foot wezterm xterm x-terminal-emulator; do
    command -v "$t" >/dev/null || continue
    case "$t" in
      gnome-terminal|ptyxis|kgx|tilix) exec "$t" -- bash -c "$run" ;;
      wezterm) exec wezterm start -- bash -c "$run" ;;
      kitty|foot) exec "$t" bash -c "$run" ;;
      *) exec "$t" -e bash -c "$run" ;;
    esac
  done
  notify-send -i dialog-error "Linux Dashboard" "Couldn't find a terminal. Open one and run: bash $self" 2>/dev/null || true
  exit 1
fi
# ---------- end of terminal relaunch (build.sh copies this block into the one-file installer) ----------

HERE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ID="io.github.jarvis.LinuxDashboard"
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/linux-dashboard"
BIN="$HOME/.local/bin"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ICONS="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor"
HERE=0; YES=0
for a in "$@"; do
  case "$a" in
    --here) HERE=1 ;;
    --yes|-y) YES=1 ;;
    --uninstall) u="$(dirname "${BASH_SOURCE[0]}")/uninstall.sh"
                 for b in "$@"; do [ "$b" = --purge ] && exec bash "$u" --purge; done
                 exec bash "$u" ;;
    -h|--help) sed -n '2,10p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Unknown option: $a"; exit 1 ;;
  esac
done

# ---------- double-clicked: everything below talks through pop-up windows, and writes a log ----------
GUI=0; [ "${LD_GUI:-}" = 1 ] && GUI=1
WARNINGS=()
if [ "$GUI" = 1 ]; then
  LOGF="${XDG_CACHE_HOME:-$HOME/.cache}/linux-dashboard/install.log"
  mkdir -p "$(dirname "$LOGF")"; exec >"$LOGF" 2>&1
  trap '' PIPE  # if the progress window goes away, keep going
  DLG=""
  if /usr/bin/python3 -c 'import gi; gi.require_version("Gtk", "4.0"); from gi.repository import Gtk' 2>/dev/null; then
    # the windows are drawn by this small GTK program, kept inside this file so there's nothing else to click on
    GUITMP="$(mktemp -d)"; trap 'rm -rf "$GUITMP"' EXIT; GUIPY="$GUITMP/gui.py"; DLG=gtk
    export LD_ICON="$HERE_DIR/icons/$APP_ID.svg"
    cat > "$GUIPY" <<'PYEOF'
"""Pop-up windows for install.sh when it's double-clicked (no terminal). GTK 4 only, nothing else.

  gui.py ask TITLE TEXT [YES] [NO]   a question: exits 0 for yes, 10 for no or closed
  gui.py info TITLE TEXT             a message with an OK button
  gui.py error TITLE TEXT            the same, with a warning icon
  gui.py progress TITLE              a progress bar fed from stdin: lines like "40 Copying the app…",
                                               closes when stdin ends
"""
import os
import sys

import gi

gi.require_version("Gtk", "4.0")
from gi.repository import Gio, GLib, Gtk  # noqa: E402

ICON = os.environ.get("LD_ICON", "")


def is_dark():
    """The desktop's light/dark choice (KDE and GNOME both answer this), else GTK's own setting."""
    try:
        bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        v = bus.call_sync("org.freedesktop.portal.Desktop", "/org/freedesktop/portal/desktop", "org.freedesktop.portal.Settings",
                          "ReadOne", GLib.Variant("(ss)", ("org.freedesktop.appearance", "color-scheme")),
                          GLib.VariantType("(v)"), Gio.DBusCallFlags.NONE, 800, None).unpack()[0]
        if v in (1, 2):
            return v == 1
    except Exception:
        pass
    s = Gtk.Settings.get_default()
    return bool(s and (s.props.gtk_application_prefer_dark_theme or "dark" in (s.props.gtk_theme_name or "").lower()))


def css(dark):
    # the window's own colors, so it reads well whatever GTK theme is (or isn't) set up
    c = dict(bg="#1d2026", fg="#eceef2", muted="#a9b0bd", btn="#2b2f37", line="#3a3f49", trough="#2b2f37") if dark else \
        dict(bg="#ffffff", fg="#171a21", muted="#4b5263", btn="#eef0f5", line="#d9dde5", trough="#e3e6ec")
    return ("""
window.ldi, window.ldi > * { background: %(bg)s; color: %(fg)s; }
.ldi label { color: %(fg)s; }
.ldi .title { font-size: 17px; font-weight: 700; }
.ldi .body, .ldi .step { color: %(muted)s; }
.ldi .step { font-size: 13px; }
.ldi button { background: %(btn)s; color: %(fg)s; border: 1px solid %(line)s; border-radius: 9px; padding: 6px 18px; box-shadow: none; }
.ldi button label { color: inherit; }
.ldi button:hover { border-color: #3f6ff5; }
.ldi button.suggested-action { background: #3f6ff5; color: #ffffff; border-color: #3f6ff5; }
.ldi progressbar trough { background: %(trough)s; min-height: 8px; border-radius: 8px; border: 0; }
.ldi progressbar progress { background: #3f6ff5; min-height: 8px; border-radius: 8px; border: 0; margin: 0; }
""" % c).encode()


def main():
    kind, title = sys.argv[1], sys.argv[2]
    text = sys.argv[3] if len(sys.argv) > 3 else ""
    yes = sys.argv[4] if len(sys.argv) > 4 else ("OK" if kind in ("info", "error") else "Yes")
    no = sys.argv[5] if len(sys.argv) > 5 else "Cancel"
    result = {"code": 1}
    app = Gtk.Application(application_id=None, flags=Gio.ApplicationFlags.NON_UNIQUE)

    def activate(app):
        style = Gtk.CssProvider()
        data = css(is_dark())
        style.load_from_data(data, len(data))
        Gtk.StyleContext.add_provider_for_display(Gtk.Widget.get_display(Gtk.Label()), style, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION + 1)
        win = Gtk.ApplicationWindow(application=app, title="Linux Dashboard", resizable=False)
        win.add_css_class("ldi")
        win.set_default_size(440, -1)
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12, margin_top=24, margin_bottom=20, margin_start=24, margin_end=24)
        top = Gtk.Box(spacing=16)
        img = Gtk.Image.new_from_icon_name("dialog-warning") if kind == "error" or not os.path.isfile(ICON) else Gtk.Image.new_from_file(ICON)
        img.set_pixel_size(56)
        img.set_valign(Gtk.Align.START)
        top.append(img)
        words = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6, hexpand=True)
        head = Gtk.Label(label=title, xalign=0, wrap=True)
        head.add_css_class("title")
        words.append(head)
        body = Gtk.Label(label=text, xalign=0, wrap=True, max_width_chars=48, selectable=kind == "error")
        body.add_css_class("body")
        if text:
            words.append(body)
        top.append(words)
        box.append(top)

        if kind == "progress":
            bar = Gtk.ProgressBar(margin_top=6)
            step = Gtk.Label(label="Starting…", xalign=0)
            step.add_css_class("step")
            box.append(bar)
            box.append(step)
            win.connect("close-request", lambda *_: True)  # it closes itself when the work is done

            def pulse():
                if bar.get_fraction() == 0:
                    bar.pulse()
                return True
            GLib.timeout_add(120, pulse)

            def on_line(src, cond):
                line = src.readline() if cond & GLib.IOCondition.IN else ""
                if not line:
                    app.quit()
                    return False
                pct, _, msg = line.strip().partition(" ")
                if pct.isdigit():
                    bar.set_fraction(min(int(pct), 100) / 100)
                if msg:
                    step.set_label(msg)
                return True
            GLib.io_add_watch(GLib.IOChannel.unix_new(sys.stdin.fileno()), GLib.PRIORITY_DEFAULT,
                              GLib.IOCondition.IN | GLib.IOCondition.HUP, on_line)
        else:
            row = Gtk.Box(spacing=8, halign=Gtk.Align.END, margin_top=8)
            if kind == "ask":
                b_no = Gtk.Button(label=no)
                b_no.connect("clicked", lambda *_: app.quit())
                row.append(b_no)
            b_yes = Gtk.Button(label=yes)
            b_yes.add_css_class("suggested-action")

            def ok(*_):
                result["code"] = 0
                app.quit()
            b_yes.connect("clicked", ok)
            row.append(b_yes)
            box.append(row)
            win.set_default_widget(b_yes)
            GLib.idle_add(b_yes.grab_focus)
        win.set_child(box)
        win.present()

    app.connect("activate", activate)
    app.run([])
    return 0 if kind in ("info", "error", "progress") else (0 if result["code"] == 0 else 10)


if __name__ == "__main__":
    sys.exit(main())
PYEOF
  fi
  [ -n "$DLG" ] || { command -v kdialog >/dev/null && DLG=kdialog; } || { command -v zenity >/dev/null && DLG=zenity; } || true
fi
win() {  # win ask|info|error "Title" "Text" [yes label] [no label] → 0 for yes/OK
  local rc
  case "$DLG" in
    gtk) rc=0; /usr/bin/python3 "$GUIPY" "$@" || rc=$?
         [ "$rc" = 0 ] && return 0; [ "$rc" = 10 ] && return 1
         # the window itself broke: try the desktop's own dialogs, or else carry on (they did double-click to install)
         echo "  (window failed with code $rc)"
         DLG=""; { command -v kdialog >/dev/null && DLG=kdialog; } || { command -v zenity >/dev/null && DLG=zenity; } || true
         [ -n "$DLG" ] && { win "$@"; return; }
         notify-send -i system-software-install "$2" "$3" 2>/dev/null || true; return 0 ;;
    kdialog) case "$1" in ask) kdialog --title "Linux Dashboard" --yesno "$2"$'\n\n'"$3" --yes-label "${4:-Yes}" --no-label "${5:-Cancel}" ;;
                          error) kdialog --title "Linux Dashboard" --error "$2"$'\n\n'"$3" ;; *) kdialog --title "Linux Dashboard" --msgbox "$2"$'\n\n'"$3" ;; esac ;;
    zenity) case "$1" in ask) zenity --question --title="Linux Dashboard" --text="<b>$2</b>\n\n$3" --ok-label="${4:-Yes}" --cancel-label="${5:-Cancel}" --width=440 ;;
                         error) zenity --error --title="Linux Dashboard" --text="<b>$2</b>\n\n$3" --width=440 ;; *) zenity --info --title="Linux Dashboard" --text="<b>$2</b>\n\n$3" --width=440 ;; esac ;;
  esac
}
PROG=0
progress_start() {
  [ "$GUI" = 1 ] || return 0
  case "$DLG" in
    gtk) exec 3> >(/usr/bin/python3 "$GUIPY" progress "$1"); PROG=1 ;;
    zenity) exec 3> >(zenity --progress --title="Linux Dashboard" --text="$1" --auto-close --no-cancel --width=440); PROG=1 ;;
    *) notify-send -i system-software-install "Linux Dashboard" "$1" 2>/dev/null || true ;;
  esac
}
step() {  # step PERCENT "What's happening"
  echo "  … $2"
  [ "$PROG" = 1 ] || return 0
  if [ "$DLG" = zenity ]; then { echo "$1"; echo "# $2"; } >&3 2>/dev/null || true; else echo "$1 $2" >&3 2>/dev/null || true; fi
}
progress_end() { [ "$PROG" = 1 ] && { exec 3>&- 2>/dev/null; PROG=0; sleep 0.3; } || true; }

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; WARNINGS+=("$*"); }
fail() {
  printf '  \033[31m✗\033[0m %s\n' "$*"
  if [ "$GUI" = 1 ]; then progress_end; win error "Linux Dashboard couldn't be installed" "$*"$'\n\n'"The details are in $LOGF"; fi
  exit 1
}
ask() {  # ask "Question" → true for yes (Enter = yes); --yes answers yes
  [ "$YES" = 1 ] && return 0
  if [ "$GUI" = 1 ]; then win ask "$1" "${2:-}" "${3:-Yes}" "${4:-Cancel}"; return; fi
  local ans; read -rp "  $1 [Y/n] " ans || return 1
  [[ "${ans:-y}" =~ ^[Yy] ]]
}
# admin commands: a password window when double-clicked, sudo in a terminal
asroot() { if [ "$GUI" = 1 ]; then pkexec "$@"; else sudo "$@"; fi; }

# ---------- find the app's files ----------
# This script may have been copied out of the app folder (e.g. to the top of a USB stick):
# then look for the folder next to it.
SRC=""
for d in "$HERE_DIR" "$HERE_DIR/linux-dashboard" "$HERE_DIR"/*/; do
  d="${d%/}"
  if [ -f "$d/app.py" ] && [ -f "$d/server.py" ] && [ -d "$d/web" ]; then SRC="$d"; break; fi
done
[ -n "$SRC" ] || fail "Can't find the app's files (app.py, server.py, web/). Keep install.sh inside the linux-dashboard folder and run it from there."

# The system's own Python (Homebrew/pyenv Pythons don't have the GTK bindings)
PY=/usr/bin/python3
[ -x "$PY" ] || PY="$(command -v python3 || true)"
[ -n "$PY" ] || fail "Python 3 is needed. Install it with your package manager first."

# ---------- which system is this? ----------
. /etc/os-release 2>/dev/null || true
if command -v pacman >/dev/null; then FAMILY=arch
elif command -v apt-get >/dev/null; then FAMILY=debian
elif command -v dnf >/dev/null || command -v dnf5 >/dev/null; then FAMILY=fedora
elif command -v zypper >/dev/null; then FAMILY=suse
else FAMILY=other; fi
bold "Linux Dashboard installer"
echo "  System: ${PRETTY_NAME:-Linux} ($FAMILY) · desktop: ${XDG_CURRENT_DESKTOP:-unknown} · user: $(id -un)"
[ -n "${LD_FROM_BUNDLE:-}" ] && echo "  App files: packed inside $LD_FROM_BUNDLE" || echo "  App files: $SRC"
if [ "$GUI" = 1 ] && [ "$YES" != 1 ]; then
  if [ -f "$DEST/app.py" ]; then
    win ask "Update Linux Dashboard?" "You already have it. This puts this version in place. Your settings and chats are kept." "Update" "Cancel" || exit 0
  else
    win ask "Install Linux Dashboard?" "Adds it to your app menu, just for you ($(id -un)). It takes about a minute." "Install" "Cancel" || exit 0
  fi
fi
progress_start "Installing Linux Dashboard…"
step 5 "Checking what's needed"

# ---------- what it needs ----------
case "$FAMILY" in
  arch)   NEED="python-gobject gtk4 webkitgtk-6.0 libsecret libnotify polkit"; EXTRA="lm_sensors pciutils usbutils"
          INSTALL="pacman -S --needed --noconfirm" ;;
  debian) NEED="python3-gi gir1.2-gtk-4.0 gir1.2-webkit-6.0 gir1.2-secret-1 libnotify-bin pkexec python3-venv"; EXTRA="lm-sensors pciutils usbutils"
          INSTALL="env DEBIAN_FRONTEND=noninteractive apt-get install -y" ;;
  fedora) NEED="python3-gobject gtk4 webkitgtk6.0 libsecret libnotify polkit"; EXTRA="lm_sensors pciutils usbutils"
          INSTALL="dnf install -y" ;;
  suse)   NEED="python3-gobject python3-gobject-Gdk typelib-1_0-Gtk-4_0 typelib-1_0-WebKit-6_0 typelib-1_0-Secret-1 libnotify-tools polkit"; EXTRA="sensors pciutils usbutils"
          INSTALL="zypper --non-interactive install" ;;
  *)      NEED=""; EXTRA=""; INSTALL="" ;;
esac

check_gui() {
  "$PY" - <<'EOF' 2>/dev/null
import gi
gi.require_version("Gtk", "4.0")
gi.require_version("WebKit", "6.0")
from gi.repository import Gtk, WebKit
EOF
}

if check_gui; then
  ok "GTK 4 and WebKitGTK 6 are installed"
else
  warn "The app needs GTK 4, WebKitGTK 6 and their Python bindings."
  [ -n "$INSTALL" ] || fail "Install PyGObject, GTK 4 and WebKitGTK 6.0 with your package manager, then run this again."
  echo "  Packages: $NEED $EXTRA"
  ask "Install the parts it needs?" "Linux Dashboard needs a few system packages first: $NEED $EXTRA"$'\n\n'"This asks for your password." "Install them" "Cancel" || fail "OK, not installing. Run this again when they're installed."
  step 15 "Installing the parts it needs (this can take a few minutes)"
  # shellcheck disable=SC2086
  if ! { if [ "$FAMILY" = debian ]; then asroot apt-get update; fi; asroot $INSTALL $NEED $EXTRA; }; then
    echo
    fail "Couldn't install them. If your account isn't an administrator, ask one to run: sudo $INSTALL $NEED"
  fi
  check_gui || fail "Still can't load WebKitGTK 6. Your system may be too old (it needs a 2023 or newer release)."
  ok "Installed the app's requirements"
fi

for t in nmcli systemctl pkexec; do
  command -v "$t" >/dev/null || warn "$t isn't installed: some pages won't work fully"
done
command -v wpctl >/dev/null || command -v pactl >/dev/null || warn "Neither wpctl (PipeWire) nor pactl found: sound controls won't work"

step 40 "Copying the app"
# ---------- copy the app ----------
# Only the app's own files: anything else next to it (e.g. on a USB stick) stays behind, and the
# folder's other contents (window data, the Claude library) are kept on reinstall.
if [ "$HERE" = 1 ] || [ "$SRC" = "$DEST" ]; then
  APP="$SRC"
  ok "Using the app from $APP"
else
  mkdir -p "$DEST"
  rm -rf "$DEST/web" "$DEST/icons" "$DEST/system" "$DEST/__pycache__" "$DEST"/*.py  # old versions' files go too
  cp -r "$SRC"/*.py "$SRC/VERSION" "$SRC/web" "$SRC/icons" "$DEST"/
  [ -d "$SRC/system" ] && cp -r "$SRC/system" "$DEST"/
  for f in install.sh uninstall.sh README.md LICENSE; do [ -f "$SRC/$f" ] && cp "$SRC/$f" "$DEST"/; done
  chmod +x "$DEST"/*.sh "$DEST/app.py" 2>/dev/null || true
  APP="$DEST"
  ok "Copied the app to $APP"
fi

step 55 "Checking the app works"
# Make sure it actually loads before adding it anywhere
if ! err="$(cd "$APP" && timeout 60 "$PY" -c 'import sys; sys.path.insert(0, "."); import server' 2>&1)"; then
  echo "$err" | tail -5 | sed 's/^/    /'
  fail "The app's files didn't load (the reason is in the log). Try copying the installer again."
fi
ok "The app's files load correctly"

step 65 "Setting up Claude support for the assistant"
# Anthropic's Python library, for using Claude in the assistant (in the app's own folder, nothing system-wide)
PYENV="${XDG_DATA_HOME:-$HOME/.local/share}/linux-dashboard/pyenv"
if "$PY" -m venv --system-site-packages "$PYENV" >/dev/null 2>&1 && "$PYENV/bin/pip" install --quiet --upgrade --disable-pip-version-check anthropic >/dev/null 2>&1; then
  ok "Claude support for the assistant"
else
  warn "Couldn't set up Claude support now. You can install it later from Dashboard settings → Assistant."
fi

step 90 "Adding it to the app menu"
# ---------- the linux-dashboard command ----------
# Errors go to a log file, and a notification pops up if it can't start, so it never "just doesn't open".
LOG="${XDG_CACHE_HOME:-$HOME/.cache}/linux-dashboard/app.log"
mkdir -p "$BIN" "$APPS" "$ICONS/scalable/apps" "$(dirname "$LOG")"
cat > "$BIN/linux-dashboard" <<EOF
#!/bin/sh
# Linux Dashboard. Options: --page NAME opens a page (home, assistant, apps, sound, network, …)
APP="$APP"
LOG="$LOG"
if [ ! -f "\$APP/app.py" ]; then
  msg="Linux Dashboard's files are missing from \$APP. Run install.sh again."
  echo "\$msg" >&2; notify-send -i dialog-error "Linux Dashboard" "\$msg" 2>/dev/null; exit 1
fi
if [ -t 2 ]; then exec $PY "\$APP/app.py" "\$@"; fi
$PY "\$APP/app.py" "\$@" 2>>"\$LOG"
code=\$?
if [ \$code -ne 0 ] && [ \$code -lt 128 ]; then
  notify-send -i dialog-error "Linux Dashboard didn't start" "\$(tail -n 3 "\$LOG")" 2>/dev/null
fi
exit \$code
EOF
chmod +x "$BIN/linux-dashboard"
ok "Command: linux-dashboard"

# ~/.local/bin isn't on the PATH by default everywhere (e.g. Arch): add it so the command works in a terminal
NEWPATH=0
case ":$PATH:" in
  *":$BIN:"*) ;;
  *)
    LINE='export PATH="$HOME/.local/bin:$PATH"  # added by Linux Dashboard'
    for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
      { [ -f "$rc" ] || [ "$rc" = "$HOME/.bashrc" ]; } || continue
      grep -qs '\.local/bin' "$rc" || { printf '\n%s\n' "$LINE" >> "$rc"; NEWPATH=1; }
    done
    if command -v fish >/dev/null; then
      mkdir -p "$HOME/.config/fish/conf.d"
      echo 'fish_add_path -g ~/.local/bin  # added by Linux Dashboard' > "$HOME/.config/fish/conf.d/linux-dashboard.fish"
    fi
    NEWPATH=1 ;;
esac

# ---------- menu entry, desktop icon menu and icon ----------
cp "$APP/icons/$APP_ID.svg" "$ICONS/scalable/apps/$APP_ID.svg"
if command -v rsvg-convert >/dev/null; then
  for s in 16 22 24 32 48 64 128 256; do
    mkdir -p "$ICONS/${s}x${s}/apps"
    rsvg-convert -w "$s" -h "$s" "$APP/icons/$APP_ID.svg" -o "$ICONS/${s}x${s}/apps/$APP_ID.png"
  done
fi
cp "$APP/icons/$APP_ID.svg" "$APP/web/app-icon.svg" 2>/dev/null || true

# the menu entry (right-click it to jump straight to a page); the system packages use the same one
bash "$APP/system/desktop-entry.sh" "$BIN/linux-dashboard" > "$APPS/$APP_ID.desktop"
chmod +x "$APPS/$APP_ID.desktop"

# Refresh copies made earlier from Dashboard settings (desktop shortcut, open at login)
DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"
for copy in "$DESKTOP_DIR/$APP_ID.desktop" "$HOME/.config/autostart/$APP_ID.desktop"; do
  [ -f "$copy" ] && cp "$APPS/$APP_ID.desktop" "$copy" && chmod +x "$copy"
done
update-desktop-database "$APPS" >/dev/null 2>&1 || true
gtk-update-icon-cache -q -t "$ICONS" >/dev/null 2>&1 || true
command -v kbuildsycoca6 >/dev/null && kbuildsycoca6 >/dev/null 2>&1 || true
ok "Added to the app menu (right-click it for shortcuts to each page)"

step 100 "Done"
progress_end
echo
bold "Done! Open “Linux Dashboard” from your app menu, or run: linux-dashboard"
if [ "$GUI" = 1 ]; then
  notes=""; for w in "${WARNINGS[@]}"; do notes+=$'\n• '"$w"; done
  [ -n "$notes" ] && notes=$'\n\nWorth knowing:'"$notes"
  if [ "$YES" = 1 ] || win ask "Linux Dashboard is installed" "It's in your app menu.$notes" "Open it now" "Close"; then
    pgrep -u "$(id -u)" -f "$APP/app.py" >/dev/null && { pkill -u "$(id -u)" -f "$APP/app.py"; sleep 1; }  # an old copy was open: restart it
    setsid -f "$BIN/linux-dashboard" </dev/null >/dev/null 2>&1
  fi
  exit 0
fi
[ "$NEWPATH" = 1 ] && warn "To use the linux-dashboard command, open a new terminal first (or run: export PATH=\"\$HOME/.local/bin:\$PATH\")."

if [ -n "${WAYLAND_DISPLAY:-}${DISPLAY:-}" ] && ask "Open it now?"; then
  setsid -f "$BIN/linux-dashboard" </dev/null >/dev/null 2>&1
  ok "Opening Linux Dashboard…"
fi
