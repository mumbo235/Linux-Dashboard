"""Problem reports (tickets) about the dashboard itself.

Tickets go to a shared inbox folder, /var/lib/linux-dashboard/tickets, set up once by the owner:
owned by the owner, mode 1733. Everyone can drop files in it but nobody else can list it, and
the sticky bit stops people deleting each other's files. Who wrote a file is read from the
file's owner on disk, never from what's inside it, so replies can't be faked:
  T-<id>.json        the report and the reporter's messages (written by the reporter)
  T-<id>.reply.json  the owner's messages and the ticket status (written by the owner)
Until the inbox exists, reports wait in ~/.config/linux-dashboard/tickets/ and are moved over later.
"""
import json
import os
import pwd
import re
import secrets
import stat
import tempfile
import time
from pathlib import Path

OWNER_USER = "jarvis"
INBOX = Path("/var/lib/linux-dashboard/tickets")
CONFIG_DIR = Path.home() / ".config" / "linux-dashboard"
MINE_FILE = CONFIG_DIR / "tickets.json"      # this user's ticket ids and what they've read
OUTBOX = CONFIG_DIR / "tickets"              # reports waiting for the inbox to exist

ME = pwd.getpwuid(os.getuid()).pw_name
KINDS = {"bug", "idea", "question"}
SEVERITIES = {"low", "normal", "high"}
STATUSES = {"open", "answered", "waiting", "closed"}
ID_RE = re.compile(r"^T-[0-9a-f]{12}$")


def owner_uid():
    try:
        return pwd.getpwnam(OWNER_USER).pw_uid
    except KeyError:
        return None


# ---------- small file helpers ----------

def _load(path, default):
    try:
        return json.loads(Path(path).read_text())
    except Exception:
        return default


def _save_private(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-")
    with os.fdopen(fd, "w") as f:
        json.dump(data, f, indent=1)
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def _write_shared(path, data):
    """Write a file in the inbox: a new file renamed into place, so a planted symlink is replaced, never followed."""
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f)
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _read_shared(path, max_bytes=400_000):
    """Read an inbox file without following symlinks. Returns (data, author uid) or (None, None)."""
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError:
        return None, None
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_size > max_bytes:
            return None, None
        with os.fdopen(fd, "r") as f:
            fd = None
            return json.loads(f.read()), st.st_uid
    except Exception:
        return None, None
    finally:
        if fd is not None:
            os.close(fd)


def _user(uid):
    try:
        return pwd.getpwuid(uid).pw_name
    except KeyError:
        return str(uid)


def inbox_ok():
    """The inbox exists and is set up the way it should be (owned by the owner, sticky)."""
    try:
        st = os.stat(INBOX)
    except OSError:
        return False
    return stat.S_ISDIR(st.st_mode) and st.st_uid == owner_uid() and bool(st.st_mode & stat.S_ISVTX)


# ---------- tickets: shared parts ----------

def _now():
    return time.strftime("%Y-%m-%d %H:%M:%S")


def _clean(text, n):
    return str(text or "").replace("\r", "").strip()[:n]


def _thread(t, reply):
    """All messages of a ticket in time order: the reporter's and the owner's."""
    msgs = [dict(m, by="user") for m in t.get("messages", [])] + [dict(m, by="owner") for m in (reply or {}).get("messages", [])]
    return sorted(msgs, key=lambda m: m.get("at", ""))


def _status(t, reply):
    if t.get("closed") and t.get("closedAt", "") >= (reply or {}).get("updated", ""):
        return "closed"
    if not reply:
        return "open"
    st = reply.get("status", "answered")
    # the reporter wrote again after the owner: it needs the owner again
    last_user = max([m.get("at", "") for m in t.get("messages", [])] or [""])
    if st in ("answered", "waiting", "closed") and last_user > reply.get("updated", ""):
        return "open"
    return st if st in STATUSES else "answered"


def _summary(t, reply, author, seen_at):
    msgs = _thread(t, reply)
    last = msgs[-1] if msgs else {}
    return {"id": t["id"], "title": t.get("title", ""), "kind": t.get("kind", "bug"), "severity": t.get("severity", "normal"),
            "created": t.get("created", ""), "from": author, "status": _status(t, reply), "priority": (reply or {}).get("priority", ""),
            "page": t.get("page", ""), "diag": t.get("diag"), "messages": msgs, "updated": last.get("at", t.get("created", "")),
            "lastBy": last.get("by", "user"), "unread": (last.get("at", "") > seen_at)}


# ---------- tickets: the reporter's side ----------

def _mine():
    return _load(MINE_FILE, {"ids": [], "seen": {}})


def sync_outbox():
    """Move reports written before the inbox existed into it."""
    if not inbox_ok() or not OUTBOX.is_dir():
        return
    for f in OUTBOX.glob("T-*.json"):
        try:
            _write_shared(INBOX / f.name, json.loads(f.read_text()))
            f.unlink()
        except Exception:
            pass


def _my_ticket(tid):
    if not ID_RE.match(tid):
        return None, None
    if inbox_ok():
        data, uid = _read_shared(INBOX / f"{tid}.json")
        if data is not None and uid == os.getuid():
            return data, INBOX / f"{tid}.json"
    p = OUTBOX / f"{tid}.json"
    data = _load(p, None)
    return (data, p) if data else (None, None)


def _reply_for(tid):
    if not inbox_ok():
        return None
    data, uid = _read_shared(INBOX / f"{tid}.reply.json")
    return data if data is not None and uid == owner_uid() else None


def _save_my_ticket(path, data):
    if path.parent == INBOX:
        _write_shared(path, data)
    else:
        _save_private(path, data)


def my_tickets():
    sync_outbox()
    m = _mine()
    out = []
    for tid in m["ids"]:
        t, _ = _my_ticket(tid)
        if t:
            reply = _reply_for(tid)
            s = _summary(t, reply, ME, m["seen"].get(tid, ""))
            s["unread"] = s["unread"] and s["lastBy"] == "owner"
            out.append(s)
    out.sort(key=lambda s: s["updated"], reverse=True)
    return {"tickets": out, "inbox": inbox_ok(), "unread": sum(s["unread"] for s in out)}


def new_ticket(body):
    title, text = _clean(body.get("title"), 120), _clean(body.get("text"), 5000)
    if not title or not text:
        return {"error": "Give it a title and say what happened."}
    tid = "T-" + secrets.token_hex(6)
    diag = body.get("diag") if isinstance(body.get("diag"), dict) else None
    if diag is not None:
        raw = json.dumps(diag, default=str)
        diag = json.loads(raw) if len(raw) <= 20000 else {"note": "too large to attach"}
    t = {"id": tid, "title": title, "kind": body.get("kind") if body.get("kind") in KINDS else "bug",
         "severity": body.get("severity") if body.get("severity") in SEVERITIES else "normal",
         "created": _now(), "page": _clean(body.get("page"), 40), "diag": diag,
         "messages": [{"at": _now(), "text": text}], "closed": False}
    if inbox_ok():
        _write_shared(INBOX / f"{tid}.json", t)
    else:
        OUTBOX.mkdir(parents=True, exist_ok=True)
        _save_private(OUTBOX / f"{tid}.json", t)
    m = _mine()
    m["ids"].append(tid)
    m["seen"][tid] = _now()
    _save_private(MINE_FILE, m)
    return {"ok": True, "id": tid, "queued": not inbox_ok()}


def my_reply(tid, text, close=None):
    t, path = _my_ticket(str(tid))
    if not t:
        return {"error": "That report wasn't found."}
    text = _clean(text, 5000)
    if text:
        t["messages"] = (t.get("messages", []) + [{"at": _now(), "text": text}])[-100:]
        t["closed"] = False
    if close is not None:
        t["closed"], t["closedAt"] = bool(close), _now()
    _save_my_ticket(path, t)
    return {"ok": True}


def mark_mine_read(tid):
    m = _mine()
    if tid in m["ids"]:
        m["seen"][tid] = _now()
        _save_private(MINE_FILE, m)
    return {"ok": True}
