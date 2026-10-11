#!/usr/bin/env python3
"""Publish a new GitHub Release with dist/ assets for mumbo235/Linux-Dashboard.

Usage:
  python3 publish_release.py <GITHUB_TOKEN>
  or
  GITHUB_TOKEN=... python3 publish_release.py
"""
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO = "mumbo235/Linux-Dashboard"
TAG = "v1.0"
NAME = "1.0"
BODY = """### Linux Dashboard 1.0

Official 1.0 release of **Linux Dashboard** — do terminal things with buttons.

#### Key Highlights & Fixes
- **Mac Fan Control**: Full support for both non-T2 Intel Macs and T2 Macs (automatic firmware control, temperature curves, force stop mode, and overdrive).
- **Force Stop Mode**: Instantly spin fans down to 0 RPM and stop fan services.
- **Bug Fixes**:
  - Fixed welcome tour step navigation and array index bounds.
  - Added missing `fan` setting hook to settings control registry.
  - Broadened hardware temperature and sensor detection across CPU and GPU hardware.
  - Reduced overdrive latency and smoothed background fan daemon transitions.
- **Packages & One-File Installer**: Native packages for Debian/Ubuntu, Arch, Fedora, and openSUSE, plus a self-contained `.sh` installer.

---

### Installation Instructions

#### 1. Standalone Installer (`linux-dashboard-install.sh`)
Works on any supported Linux distribution.

> **Important**: When downloaded from a web browser, `.sh` files lose their executable permission by default. **You must make the script executable before running it.**

- **Using the file manager (GUI)**:
  1. Right-click `linux-dashboard-install.sh` → **Properties** → **Permissions**.
  2. Tick **Allow executing file as program** (or **Is executable**).
  3. Double-click the file and click **Run** or **Execute**.

- **Using the terminal**:
  ```bash
  chmod +x linux-dashboard-install.sh
  ./linux-dashboard-install.sh
  ```
  *(Or run `bash linux-dashboard-install.sh` directly)*

---

#### 2. Native System Packages (System-wide install)

- **Ubuntu / Debian / Linux Mint / Pop!_OS (`.deb`)**:
  - Double-click `linux-dashboard_1.0.0-1_all.deb` to install via Software Center, or in terminal:
    ```bash
    sudo apt install ./linux-dashboard_1.0.0-1_all.deb
    ```

- **Arch Linux / Manjaro / EndeavourOS (`.pkg.tar.zst`)**:
  - Open with Pamac (Add/Remove Software), or in terminal:
    ```bash
    sudo pacman -U linux-dashboard-1.0.0-1-any.pkg.tar.zst
    ```

- **Fedora (`.fedora.noarch.rpm`)**:
  - Double-click to open in GNOME Software, or in terminal:
    ```bash
    sudo dnf install ./linux-dashboard-1.0.0-1.fedora.noarch.rpm
    ```

- **openSUSE (`.opensuse.noarch.rpm`)**:
  - Open in YaST / Discover, or in terminal:
    ```bash
    sudo zypper install ./linux-dashboard-1.0.0-1.opensuse.noarch.rpm
    ```
"""

def main():
    token = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("GITHUB_TOKEN", "").strip()

    if not token:
        print("Error: No GitHub token provided.")
        print("Usage: python3 publish_release.py <GITHUB_TOKEN>")
        print("Generate a token with 'repo' scope at: https://github.com/settings/tokens")
        sys.exit(1)

    dist_dir = Path(__file__).resolve().parent.parent / "dist"
    if not dist_dir.is_dir():
        dist_dir = Path(__file__).resolve().parent / "dist"
    assets = [
        dist_dir / "linux-dashboard-install.sh",
        dist_dir / "linux-dashboard_1.0.0-1_all.deb",
        dist_dir / "linux-dashboard-1.0.0-1-any.pkg.tar.zst",
        dist_dir / "linux-dashboard-1.0.0-1.fedora.noarch.rpm",
        dist_dir / "linux-dashboard-1.0.0-1.opensuse.noarch.rpm",
    ]

    missing = [p.name for p in assets if not p.exists()]
    if missing:
        print(f"Error: Missing build assets in dist/: {missing}")
        print("Run 'bash build.sh' first.")
        sys.exit(1)

    # 1. Create GitHub Release
    print(f"Creating release {NAME} (tag: {TAG}) on {REPO}...")
    url = f"https://api.github.com/repos/{REPO}/releases"
    data = json.dumps({
        "tag_name": TAG,
        "name": NAME,
        "body": BODY,
        "draft": False,
        "prerelease": False,
        "make_latest": "true",
    }).encode("utf-8")

    req = urllib.request.Request(url, data=data, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "Linux-Dashboard-Release-Tool",
    })

    try:
        with urllib.request.urlopen(req) as resp:
            release = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        print(f"Failed to create release: HTTP {e.code}: {err_body}")
        sys.exit(1)

    release_id = release.get("id")
    upload_url = release.get("upload_url", "").split("{")[0]
    html_url = release.get("html_url", "")
    print(f"Release created successfully: {html_url} (ID: {release_id})")

    # 2. Upload Assets
    for asset in assets:
        filename = asset.name
        print(f"Uploading {filename} ({asset.stat().st_size // 1024} KB)...")
        upload_target = f"{upload_url}?name={filename}"
        file_bytes = asset.read_bytes()

        upload_req = urllib.request.Request(upload_target, data=file_bytes, headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/octet-stream",
            "User-Agent": "Linux-Dashboard-Release-Tool",
        })

        try:
            with urllib.request.urlopen(upload_req) as resp:
                upload_resp = json.loads(resp.read().decode("utf-8"))
                print(f"  ✓ Uploaded {filename} -> {upload_resp.get('browser_download_url')}")
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")
            print(f"  ✗ Failed to upload {filename}: HTTP {e.code}: {err_body}")

    print("\nAll assets uploaded!")
    print(f"View release: {html_url}")


if __name__ == "__main__":
    main()
