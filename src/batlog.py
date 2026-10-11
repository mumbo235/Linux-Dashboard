"""Battery history logger, low-battery alerts and clipboard history.

A small background thread samples the battery once a minute while the dashboard is
running, keeps about two weeks of samples, and sends desktop notifications when the
charge crosses the levels chosen on the Power page.
"""
import json
import shutil
import subprocess
import threading
import time
from pathlib import Path

import controls

LOG = Path.home() / ".config" / "linux-dashboard" / "battery_history.jsonl"
INTERVAL = 60          # seconds between samples
KEEP_SECONDS = 14 * 86400
DEFAULT_ALERTS = {"on": True, "levels": [20, 10], "full": 0}  # full: notify when charging reaches this %, 0 = off
_lock = threading.Lock()
_started = False


def _sample():
    info = controls.battery_info()
    if not info.get("present"):
        return None
    b = info["batteries"][0]
    return {"t": int(time.time()), "p": round(b["exact_pct"], 1), "w": b.get("watts") or 0,
            "s": (b.get("status") or "Unknown")[:1]}  # C(harging) D(ischarging) F(ull) N(ot charging) U(nknown)


def _append(s):
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with _lock:
        with LOG.open("a") as f:
            f.write(json.dumps(s) + "\n")


def _trim():
    cutoff = time.time() - KEEP_SECONDS
    with _lock:
        try:
            lines = LOG.read_text().splitlines()
        except OSError:
            return
        keep = []
        for ln in lines:
            try:
                if json.loads(ln)["t"] >= cutoff:
                    keep.append(ln)
            except Exception:
                pass
        if len(keep) != len(lines):
            LOG.write_text("\n".join(keep) + ("\n" if keep else ""))


def history(hours=24):
    """Samples from the last `hours` hours as [[time, percent, watts, status], ...]."""
    try:
        hours = max(1, min(24 * 14, int(hours)))
    except (TypeError, ValueError):
        hours = 24
    cutoff = time.time() - hours * 3600
    out = []
    with _lock:
        try:
            lines = LOG.read_text().splitlines()
        except OSError:
            return {"samples": []}
    for ln in lines:
        try:
            d = json.loads(ln)
        except Exception:
            continue
        if d["t"] >= cutoff:
            out.append([d["t"], d["p"], d["w"], d["s"]])
    # keep the payload small: at most ~400 points
    if len(out) > 400:
        step = len(out) / 400
        out = [out[int(i * step)] for i in range(400)] + [out[-1]]
    return {"samples": out}


def _check_alerts(s, state, settings, notify):
    cfg = dict(DEFAULT_ALERTS, **(settings.get("batAlerts") or {}))
    if not cfg.get("on"):
        return
    pct, status = s["p"], s["s"]
    if status == "D":
        for lvl in sorted(cfg.get("levels") or [], reverse=True):
            if pct <= lvl and lvl not in state["fired"]:
                state["fired"].add(lvl)
                notify("Battery low" if lvl > 10 else "Battery very low", f"{pct:.0f}% left. Plug in soon.")
                break
    else:
        state["fired"].clear()
    full = int(cfg.get("full") or 0)
    if full and status == "C" and pct >= full and not state["full_fired"]:
        state["full_fired"] = True
        notify("Battery charged", f"Reached {pct:.0f}%. You can unplug now.")
    if status != "C":
        state["full_fired"] = False


def _loop(notify, load_settings):
    state = {"fired": set(), "full_fired": False}
    last_trim = 0
    while True:
        try:
            s = _sample()
            if s:
                _append(s)
                _check_alerts(s, state, load_settings() or {}, notify)
            if time.time() - last_trim > 3600:
                _trim()
                last_trim = time.time()
        except Exception:
            pass
        time.sleep(INTERVAL)


def start(notify, load_settings):
    global _started
    if _started:
        return
    _started = True
    threading.Thread(target=_loop, args=(notify, load_settings), daemon=True).start()


# ---------- clipboard history (KDE's Klipper) ----------

def _qdbus():
    return shutil.which("qdbus6") or shutil.which("qdbus") or shutil.which("qdbus-qt5")


def clipboard_history():
    q = _qdbus()
    if not q:
        return {"supported": False, "items": []}
    try:
        r = subprocess.run([q, "org.kde.klipper", "/klipper", "getClipboardHistoryMenu"],
                           capture_output=True, text=True, timeout=5)
    except Exception:
        return {"supported": False, "items": []}
    if r.returncode != 0:
        return {"supported": False, "items": []}
    items = [ln for ln in r.stdout.split("\n") if ln.strip()]
    return {"supported": True, "items": [i[:2000] for i in items[:40]]}


def clipboard_set(text):
    q = _qdbus()
    if not q:
        return {"ok": False}
    r = subprocess.run([q, "org.kde.klipper", "/klipper", "setClipboardContents", str(text)[:20000]],
                       capture_output=True, text=True, timeout=5)
    return {"ok": r.returncode == 0}


def clipboard_clear():
    q = _qdbus()
    if not q:
        return {"ok": False}
    r = subprocess.run([q, "org.kde.klipper", "/klipper", "clearClipboardHistory"], capture_output=True, timeout=5)
    return {"ok": r.returncode == 0}
