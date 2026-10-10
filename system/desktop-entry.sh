#!/usr/bin/env bash
# Prints Linux Dashboard's app-menu entry. Used by install.sh (per user) and build.sh (system packages).
#   bash desktop-entry.sh /path/to/linux-dashboard-command
set -euo pipefail
LAUNCHER="$1"
APP_ID="io.github.jarvis.LinuxDashboard"

# Right-click the app (menu, taskbar or desktop icon) to jump straight to a page
ACTIONS=(
  "assistant|Ask the assistant|sparkles"
  "apps|Apps & updates|system-software-update"
  "sound|Sound|audio-volume-high"
  "network|Network & Bluetooth|network-wireless"
  "display|Display|video-display"
  "appearance|Appearance|preferences-desktop-theme"
  "power|Power & lock|system-shutdown"
  "storage|Storage|drive-harddisk"
  "procs|Running programs|utilities-system-monitor"
  "services|Services & startup apps|system-run"
  "sensors|Sensors & fans|temperature-normal"
  "logs|Logs & problems|dialog-warning"
  "tools|Toolbox|applications-utilities"
  "terminal|Terminal|utilities-terminal"
  "settings|Dashboard settings|preferences-system"
)
ids=""; for a in "${ACTIONS[@]}"; do ids+="${a%%|*};"; done
{
  cat <<EOF
[Desktop Entry]
Type=Application
Name=Linux Dashboard
GenericName=System Control Panel
Comment=Do terminal things with buttons: settings, updates, apps, services, network, logs
Exec=$LAUNCHER
TryExec=$LAUNCHER
Icon=$APP_ID
Terminal=false
Categories=System;Settings;Utility;
Keywords=terminal;update;system;packages;settings;dashboard;
StartupWMClass=$APP_ID
StartupNotify=true
Actions=$ids
EOF
  for a in "${ACTIONS[@]}"; do
    IFS='|' read -r id name icon <<<"$a"
    [ "$icon" = sparkles ] && icon="$APP_ID"
    printf '\n[Desktop Action %s]\nName=%s\nExec=%s --page %s\nIcon=%s\n' "$id" "$name" "$LAUNCHER" "$id" "$icon"
  done
}
