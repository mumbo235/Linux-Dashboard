"""Ready-made virtual machine templates: popular systems, always the current release.

Each template looks up the latest version on the project's official site (no hard-coded
version numbers to go stale), plus the published SHA-256 checksum so the download can be
verified before it's used.
"""
import json
import re
import time
import urllib.request
from pathlib import Path

UA = {"User-Agent": "LinuxDashboard/0.1 (+local)"}
_cache = {}


def fetch(url, timeout=15):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def vkey(s):
    return tuple(int(x) for x in re.findall(r"\d+", s))


def subdirs(url, rx):
    return sorted(set(re.findall(rf'href="({rx})/"', fetch(url))), key=vkey)


def sha_from_list(text, name):
    for line in text.splitlines():
        if name in line:
            m = re.search(r"\b([0-9a-f]{64})\b", line)
            if m:
                return m.group(1)
    return None


# ---------- resolvers: return {url, file, sha256, version} ----------

def ubuntu(base, prefix):
    lts = [d for d in subdirs(base, r"\d\d\.04(?:\.\d+)?") if int(d[:2]) % 2 == 0]
    d = lts[-1]
    page = base + d + ("/release/" if "cdimage" in base else "/")
    names = sorted(set(re.findall(rf"{prefix}-[\d.]+-desktop-amd64\.iso", fetch(page))),
                   key=lambda n: vkey(re.search(r"-([\d.]+)-desktop", n).group(1)))  # compare only the version, not "amd64"
    f = names[-1]
    return {"url": page + f, "file": f, "sha256": sha_from_list(fetch(page + "SHA256SUMS"), f), "version": d + " LTS"}


def fedora(variant):
    rel = json.loads(fetch("https://fedoraproject.org/releases.json"))
    ok = [x for x in rel if x["arch"] == "x86_64" and x["link"].endswith(".iso") and "Beta" not in x["version"]
          and x["variant"] == variant and "Live" in x["link"]]
    x = max(ok, key=lambda x: int(x["version"]))
    return {"url": x["link"], "file": x["link"].rsplit("/", 1)[1], "sha256": x.get("sha256"), "version": x["version"], "size": int(x.get("size") or 0)}


def debian(kind):
    page = ("https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/" if kind == "netinst"
            else "https://cdimage.debian.org/debian-cd/current-live/amd64/iso-hybrid/")
    rx = r"debian-[\d.]+-amd64-netinst\.iso" if kind == "netinst" else rf"debian-live-[\d.]+-amd64-{kind}\.iso"
    f = sorted(set(re.findall(rx, fetch(page))), key=vkey)[-1]
    return {"url": page + f, "file": f, "sha256": sha_from_list(fetch(page + "SHA256SUMS"), f), "version": re.search(r"\d+\.\d+(\.\d+)?", f).group(0)}


def arch():
    base = "https://geo.mirror.pkgbuild.com/iso/latest/"
    f = "archlinux-x86_64.iso"
    ver = re.search(r"archlinux-(\d{4}\.\d\d\.\d\d)-x86_64\.iso", fetch(base))
    return {"url": base + f, "file": f"archlinux-{ver.group(1) if ver else 'latest'}-x86_64.iso",
            "sha256": sha_from_list(fetch(base + "sha256sums.txt"), "  " + f), "version": ver.group(1) if ver else "latest"}


def mint(edition):
    base = "https://mirrors.edge.kernel.org/linuxmint/stable/"
    d = subdirs(base, r"\d+(?:\.\d+)?")[-1]
    f = f"linuxmint-{d}-{edition}-64bit.iso"
    return {"url": f"{base}{d}/{f}", "file": f, "sha256": sha_from_list(fetch(f"{base}{d}/sha256sum.txt"), f), "version": d}


def opensuse():
    url = "https://download.opensuse.org/tumbleweed/iso/openSUSE-Tumbleweed-DVD-x86_64-Current.iso"
    s = fetch(url + ".sha256")
    m = re.search(r"\b([0-9a-f]{64})\b", s)
    snap = re.search(r"Snapshot(\d+)", s)
    return {"url": url, "file": f"openSUSE-Tumbleweed-{snap.group(1) if snap else 'Current'}-x86_64.iso",
            "sha256": m.group(1) if m else None, "version": "Snapshot " + snap.group(1) if snap else "rolling"}


def alpine():
    base = "https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/x86_64/"
    f = re.search(r"iso: (alpine-standard-[\d.]+-x86_64\.iso)", fetch(base + "latest-releases.yaml")).group(1)
    return {"url": base + f, "file": f, "sha256": sha_from_list(fetch(base + f + ".sha256"), f), "version": re.search(r"\d+\.\d+\.\d+", f).group(0)}


def freebsd():
    base = "https://download.freebsd.org/releases/amd64/amd64/ISO-IMAGES/"
    d = subdirs(base, r"\d+\.\d+")[-1]
    f = f"FreeBSD-{d}-RELEASE-amd64-disc1.iso"
    sums = fetch(f"{base}{d}/CHECKSUM.SHA256-FreeBSD-{d}-RELEASE-amd64")
    return {"url": f"{base}{d}/{f}", "file": f, "sha256": sha_from_list(sums, f"({f})"), "version": d}


# id, name, description, icon, color, family, (memory GB, cores, disk GB), osinfo profile, resolver, tags
TEMPLATES = [
    ("mint", "Linux Mint", "Feels like Windows. The friendliest first Linux", "terminal", "green", "linux", (4, 4, 32), "ubuntu24.04", lambda: mint("cinnamon"), ["Beginner"]),
    ("ubuntu", "Ubuntu", "The most popular Linux, with long-term support", "terminal", "orange", "linux", (4, 4, 32), "ubuntu26.04", lambda: ubuntu("https://releases.ubuntu.com/", "ubuntu"), ["Beginner"]),
    ("kubuntu", "Kubuntu", "Ubuntu with the KDE desktop you already use", "terminal", "blue", "linux", (4, 4, 32), "ubuntu26.04", lambda: ubuntu("https://cdimage.ubuntu.com/kubuntu/releases/", "kubuntu"), ["KDE"]),
    ("fedora", "Fedora Workstation", "Modern and polished GNOME desktop", "terminal", "indigo", "linux", (4, 4, 32), "fedora44", lambda: fedora("Workstation"), []),
    ("fedora-kde", "Fedora KDE", "Fedora with the KDE Plasma desktop", "terminal", "blue", "linux", (4, 4, 32), "fedora44", lambda: fedora("KDE"), ["KDE"]),
    ("debian-kde", "Debian (KDE live)", "Rock-solid and stable, try it before installing", "terminal", "red", "linux", (4, 4, 32), "debian13", lambda: debian("kde"), ["KDE"]),
    ("debian-gnome", "Debian (GNOME live)", "Rock-solid Debian with the GNOME desktop", "terminal", "red", "linux", (4, 4, 32), "debian13", lambda: debian("gnome"), []),
    ("debian", "Debian (small installer)", "Small download, fetches the rest while installing", "terminal", "red", "linux", (2, 2, 20), "debian13", lambda: debian("netinst"), ["Small"]),
    ("opensuse", "openSUSE Tumbleweed", "Always up to date, with great admin tools", "terminal", "green", "linux", (4, 4, 32), "opensusetumbleweed", opensuse, []),
    ("arch", "Arch Linux", "The same system you run, from scratch (text install)", "terminal", "cyan", "linux", (2, 2, 20), "archlinux", arch, ["Advanced"]),
    ("alpine", "Alpine Linux", "Tiny and fast, for servers and tinkering", "terminal", "slate", "linux", (1, 1, 8), "alpinelinux3.24", alpine, ["Small", "Advanced"]),
    ("freebsd", "FreeBSD", "Not Linux! A different Unix to explore", "terminal", "red", "linux", (2, 2, 20), "freebsd15.1", freebsd, ["Advanced"]),
    ("win11", "Windows 11", "Download from Microsoft, then pick it under “On this computer”", "window", "blue", "windows", (8, 4, 64), "win11", None, []),
    ("win10", "Windows 10", "Download from Microsoft, then pick it under “On this computer”", "window", "blue", "windows", (8, 4, 64), "win10", None, []),
]
LINKS = {"win11": "https://www.microsoft.com/software-download/windows11", "win10": "https://www.microsoft.com/software-download/windows10"}


def listing(download_dir):
    out = []
    for tid, name, desc, icon, color, family, (mem, cpus, disk), osinfo, res, tags in TEMPLATES:
        out.append({"id": tid, "name": name, "desc": desc, "icon": icon, "color": color, "family": family,
                    "mem": mem, "cpus": cpus, "disk": disk, "osinfo": osinfo, "tags": tags,
                    "link": LINKS.get(tid), "direct": res is not None})
    return out


def resolve(tid, download_dir):
    """Current version, download URL, checksum, and whether it's already downloaded."""
    t = next((t for t in TEMPLATES if t[0] == tid), None)
    if not t or not t[8]:
        return {"error": "This one has to be downloaded from its website"}
    hit = _cache.get(tid)
    if not hit or time.time() - hit[0] > 6 * 3600:
        try:
            info = t[8]()
        except Exception as e:
            return {"error": f"Couldn't reach the download site ({type(e).__name__}). Are you online?"}
        _cache[tid] = hit = (time.time(), info)
    info = dict(hit[1])
    if not info.get("size"):
        try:
            req = urllib.request.Request(info["url"], method="HEAD", headers=UA)
            with urllib.request.urlopen(req, timeout=10) as r:
                info["size"] = int(r.headers.get("Content-Length") or 0)
        except Exception:
            info["size"] = 0
    dest = Path(download_dir) / info["file"]
    info["path"] = str(dest)
    info["downloaded"] = dest.is_file() and (not info["size"] or dest.stat().st_size == info["size"])
    return info


def download_cmd(info):
    """Shell to download (resumable) and verify the checksum before keeping the file."""
    from shlex import quote as q
    path = Path(info["path"])
    part = q(str(path) + ".part")
    verify = (f'echo "Checking the download is genuine (SHA-256)…" && echo "{info["sha256"]}  {path}.part" | sha256sum -c - '
              if info.get("sha256") else 'echo "No checksum published for this one, skipping the check." ')
    return (f"mkdir -p {q(str(path.parent))} && cd {q(str(path.parent))} && "
            f"echo 'Downloading {path.name} from {info['url'].split('/')[2]}…' && "
            f"curl -L --fail --progress-bar -C - -o {part} {q(info['url'])} && {verify}&& mv {part} {q(str(path))} && "
            f"echo && echo 'Done: {path.name} is ready in {path.parent.name}.'")
