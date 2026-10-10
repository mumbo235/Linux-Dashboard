#!/usr/bin/env bash
# Remove Linux Dashboard from the app menu. Your settings and chats stay unless you add --purge.
set -euo pipefail
APP_ID="io.github.jarvis.LinuxDashboard"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"

rm -f "$HOME/.local/bin/linux-dashboard" "$DATA/applications/$APP_ID.desktop" \
      "$HOME/.config/autostart/$APP_ID.desktop" "$DESKTOP_DIR/$APP_ID.desktop" \
      "$HOME/.config/fish/conf.d/linux-dashboard.fish"
find "$DATA/icons/hicolor" -name "$APP_ID.*" -delete 2>/dev/null || true
rm -rf "$DATA/linux-dashboard" "$HOME/.cache/linux-dashboard"
update-desktop-database "$DATA/applications" >/dev/null 2>&1 || true
echo "Linux Dashboard was removed from the app menu."
[ -e /etc/systemd/system/linux-dashboard-fans.service ] && echo "Note: the fan overdrive service is still installed. Remove it with: sudo systemctl disable --now linux-dashboard-fans; sudo rm /etc/systemd/system/linux-dashboard-fans.service /usr/local/lib/linux-dashboard/fan-overdrive"

if [ "${1:-}" = "--purge" ]; then
  rm -rf "$HOME/.config/linux-dashboard"
  echo "Your dashboard settings, chats and notes were deleted too."
else
  echo "Your settings and chats are still in ~/.config/linux-dashboard (run with --purge to delete them)."
fi
