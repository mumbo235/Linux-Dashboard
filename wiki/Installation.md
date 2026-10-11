# Installation Guide

Linux Dashboard is available both as a zero-dependency standalone installer script and as native distribution packages.

---

## 1. Standalone Installer (`linux-dashboard-install.sh`)

Works across any modern Linux distribution (Ubuntu, Debian, Fedora, Arch, openSUSE, Linux Mint, Pop!_OS, etc.). It installs directly into your user space (`~/.local/share/linux-dashboard`) without requiring root access.

### Graphical Install (GUI)
1. Download `linux-dashboard-install.sh` from [Releases](https://github.com/mumbo235/Linux-Dashboard/releases).
2. Right-click `linux-dashboard-install.sh` → **Properties** → **Permissions**.
3. Check **Allow executing file as program** (or **Is executable**).
4. Double-click the file and choose **Run** or **Execute**.

### Terminal Install
```bash
chmod +x linux-dashboard-install.sh
./linux-dashboard-install.sh
```

Flags:
```bash
bash linux-dashboard-install.sh --yes        # Auto-install any missing dependencies
bash linux-dashboard-install.sh --uninstall  # Uninstall app
bash linux-dashboard-install.sh --purge      # Uninstall and delete user settings/chats
```

---

## 2. Native System Packages

If you want a system-wide install accessible to all user accounts:

### Ubuntu / Debian / Linux Mint / Pop!_OS (`.deb`)
```bash
sudo apt install ./linux-dashboard_*.deb
```

### Arch Linux / Manjaro / EndeavourOS (`.pkg.tar.zst`)
```bash
sudo pacman -U linux-dashboard-*.pkg.tar.zst
```

### Fedora (`.rpm`)
```bash
sudo dnf install ./linux-dashboard-*.fedora.noarch.rpm
```

### openSUSE (`.rpm`)
```bash
sudo zypper install ./linux-dashboard-*.opensuse.noarch.rpm
```

---

## 3. Requirements

- **Linux Distribution**: Released in 2023 or newer (GTK 4, WebKitGTK 6.0).
- **Audio / Network**: PipeWire / PulseAudio, NetworkManager.
- **Display**: Wayland or X11 (both supported out-of-the-box).
