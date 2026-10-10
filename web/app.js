/* Linux Dashboard UI */
const TOKEN = window.TOKEN;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const shq = s => "'" + String(s).replace(/'/g, `'\\''`) + "'";
const bytes = n => n >= 1e12 ? (n / 1e12).toFixed(1) + " TB" : n >= 1e9 ? (n / 1e9).toFixed(1) + " GB" : n >= 1e6 ? (n / 1e6).toFixed(0) + " MB" : n >= 1e3 ? (n / 1e3).toFixed(0) + " KB" : Math.round(n) + " B";
const rate = n => n >= 1e6 ? (n * 8 / 1e6).toFixed(1) + " Mb/s" : (n * 8 / 1e3).toFixed(0) + " kb/s";
const dur = s => { const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
let HOME = "~", ME = "";
// extra tools some builds can unlock (with headers to send on every call), and unread replies to tickets
let TOOLS = { unlocked: false, headers: {} }, TK_UNREAD = 0;
// what this computer is (distro, desktop, package manager), sent by the app at startup
const PLAT = (typeof window.PLATFORM === "object" && window.PLATFORM) || {};
PLAT.pkg = PLAT.pkg || {}; PLAT.terminal = PLAT.terminal || { name: "Terminal", open: "xterm", run: "xterm -e bash -c {cmd}" };
const hasCtl = id => !PLAT.controls || PLAT.controls.includes(id);  // can this desktop change it?
const feat = f => !PLAT.features || PLAT.features.includes(f);
const fillTpl = (tpl, map) => Object.entries(map).reduce((t, [k, v]) => t.replaceAll("{" + k + "}", () => v), tpl || "");
const pkgCmd = (tpl, name, raw) => fillTpl(tpl, { pkg: raw ? name : shq(name), file: raw ? name : shq(name) });
const qdir = d => d && d !== "~" ? shq(d) : '"$HOME"';
const termOpen = dir => fillTpl(PLAT.terminal.open, { dir: qdir(dir) });
const termRunCmd = (cmd, dir) => fillTpl(PLAT.terminal.run, { dir: qdir(dir), cmd: shq(cmd + '; echo; read -rp "Done. Press Enter to close…"') });
const listText = a => a.length > 1 ? a.slice(0, -1).join(", ") + " and " + a.at(-1) : a[0] || "";
const SOURCES = [PLAT.manager ? (PLAT.repoName || "your system") + "'s own software" : "", PLAT.aur ? "the AUR" : "", PLAT.flatpak ? "Flathub" : "", PLAT.snap ? "the Snap Store" : ""].filter(Boolean);
const SOURCES_TEXT = listText(SOURCES) || "Flathub";
const fmtTemp = c => c == null ? "–" : SETTINGS.tempUnit === "F" ? Math.round(c * 9 / 5 + 32) + "°F" : Math.round(c) + "°C";
const DEFAULTS = { startPage: "home", lastPage: "home", tiles: ["wifi", "bluetooth", "airplane", "dark", "nightlight", "dnd", "awake", "performance"],
  showSliders: true, showSuggest: true, showLive: true, showActions: true, showPower: true, refresh: 2, toasts: true, autoOpen: true, maximized: false, autoRunSafe: true, autoExplain: true, showTip: true, rememberChats: true, aiComplete: true, font: "", fontScale: 1, navLayout: null, sideWidth: 0, fanLimit: 0, adminRemember: 300, warnHarm: true,
  appAccent: "", bgTint: "subtle", bgStyle: "plain", cardStyle: "outlined", iconStyle: "filled", pageWidth: "normal", trueBlack: false, density: "comfortable", corners: "round", reduceMotion: false, sideCompact: false, drawerHeight: "medium",
  name: "", tempUnit: "C", clock24: false, notifyDone: true, soundDone: false, assistStyle: "short", assistEffort: "medium",
  hiddenPages: [], contrast: false, updateCheck: "daily", autoCloseDrawer: false, showCost: true, graphLen: "120" };
let SETTINGS = { ...DEFAULTS };
const saveSettings = debounce(() => api("/api/settings", { settings: SETTINGS }), 400);

const DEVLOG = [], JSERRORS = [];
window.addEventListener("error", e => { JSERRORS.push({ at: new Date().toLocaleTimeString(), msg: e.message, where: `${(e.filename || "").split("/").pop()}:${e.lineno}` }); if (JSERRORS.length > 50) JSERRORS.shift(); });
window.addEventListener("unhandledrejection", e => { JSERRORS.push({ at: new Date().toLocaleTimeString(), msg: "Unhandled promise: " + (e.reason?.message || e.reason), where: "" }); if (JSERRORS.length > 50) JSERRORS.shift(); });
async function api(path, body) {
  const t0 = performance.now();
  if (typeof SETTINGS !== "undefined" && !path.startsWith("/api/dev")) {
    if (SETTINGS.devMode && +SETTINGS.devSlowNet) await new Promise(r => setTimeout(r, +SETTINGS.devSlowNet));
    if (TOOLS.unlocked && +SETTINGS.devFailRate && Math.random() < +SETTINGS.devFailRate) { DEVLOG.push({ at: new Date().toLocaleTimeString(), method: body ? "POST" : "GET", path, ms: 0, status: "fake fail" }); throw new Error("Simulated failure (developer mode)"); }
  }
  const r = await fetch(path, { method: body ? "POST" : "GET", headers: { "X-Token": TOKEN, "Content-Type": "application/json", ...TOOLS.headers }, body: body ? JSON.stringify(body) : undefined });
  if (typeof SETTINGS !== "undefined" && SETTINGS.devApiLog) { DEVLOG.push({ at: new Date().toLocaleTimeString(), method: body ? "POST" : "GET", path, ms: Math.round(performance.now() - t0), status: r.status }); if (DEVLOG.length > 150) DEVLOG.shift(); if (CUR === "dev") renderDevLog(); }
  if (r.status === 401) { toast("fail", "Session expired", "Press Ctrl+R to reload"); throw new Error("401"); }
  return r.json();
}
// open an app; if it crashes straight away, say so (with a way to ask why)
async function launch(cmd) {
  const r = await api("/api/launch", { cmd }).catch(e => ({ ok: false, error: e.message }));
  if (!r.ok) {
    toast("fail", "That didn't open", r.error);
    logActivity("Open (failed)", cmd, false, r.error);
  }
  return r;
}

/* ================= toasts, modal ================= */
function toast(kind, title, cmd = "") {
  if (kind !== "fail" && !SETTINGS.toasts) return;
  const t = document.createElement("div");
  t.className = "toast " + kind;
  // a command is shown as code; a plain sentence as normal text (so it wraps between words)
  const prose = /^[A-Z][a-z']/.test(cmd) && cmd.split(" ").length > 3 && !/[|$&;`=<>]/.test(cmd);
  t.innerHTML = ic(kind === "ok" ? "checkcircle" : kind === "fail" ? "xcircle" : "info") + `<div><b>${esc(title)}</b>${cmd ? (prose ? `<small>${esc(cmd)}</small>` : `<code>${esc(cmd)}</code>`) : ""}</div>`;
  $("#toasts").append(t);
  setTimeout(() => { t.classList.add("leaving"); setTimeout(() => t.remove(), 260); }, kind === "fail" ? 6000 : 3200);
}
/* ---------- easter eggs ---------- */
const Eggs = {
  calm: () => SETTINGS.reduceMotion || matchMedia("(prefers-reduced-motion: reduce)").matches,
  say(title, text = "") { const on = SETTINGS.toasts; SETTINGS.toasts = true; toast("info", title, text); SETTINGS.toasts = on; },  // eggs show even with toasts off
  layer(cls, ms) { const box = document.createElement("div"); box.className = "egg-layer " + cls; document.body.append(box); setTimeout(() => box.remove(), ms); return box; },
  // characters such as ❄ falling from the top
  rain(ch, n = 70, ms = 9000) {
    const box = Eggs.layer("egg-fall", ms);
    for (let i = 0; i < n; i++) {
      const b = document.createElement("i"), dur = 4 + Math.random() * 4;
      b.textContent = ch; b.style.fontSize = 10 + Math.random() * 16 + "px";
      b.style.cssText += `;left:${Math.random() * 100}%;animation-delay:${Math.random() * (ms / 1000 - dur)}s;animation-duration:${dur}s;--drift:${(Math.random() - .5) * 240}px;--spin:${(Math.random() - .5) * 360}deg`;
      box.append(b);
    }
  },
  // swap a class on the page for one animation (barrel roll, table flip)
  spin(cls, ms) { const r = document.documentElement; r.classList.remove(cls); void r.offsetWidth; r.classList.add(cls); setTimeout(() => r.classList.remove(cls), ms); },
  walk(text, cls = "") { if ($(".egg-walk")) return; const t = Eggs.layer("egg-walk " + cls, 8000); t.textContent = text; },
  matrix(ms = 6000) {
    const c = Eggs.layer("egg-matrix", ms).appendChild(document.createElement("canvas")), x = c.getContext("2d");
    const w = c.width = innerWidth, h = c.height = innerHeight, cols = Array(Math.ceil(w / 16)).fill(0).map(() => Math.random() * -40), chars = "アイウエオカキクケコサシスセソ01<>{}$#LINUX";
    const end = Date.now() + ms - 600;
    (function tick() {
      if (Date.now() > end || !c.isConnected) return;
      x.fillStyle = "rgba(0,0,0,.08)"; x.fillRect(0, 0, w, h); x.fillStyle = "#3dff7a"; x.font = "15px monospace";
      cols.forEach((y, i) => { x.fillText(chars[Math.random() * chars.length | 0], i * 16, y * 16); cols[i] = y * 16 > h && Math.random() > .97 ? 0 : y + 1; });
      requestAnimationFrame(tick);
    })();
  },
  fx: {
    snow: () => Eggs.rain("❄"),
    roll: () => Eggs.spin("egg-roll", 1300),
    flip: () => Eggs.spin("egg-flip", 2600),
    train: () => Eggs.walk("🚂🚃🚃🚃", "chug"),
    matrix: () => Eggs.matrix(),
  },
  // play an effect, with a message (motion off: the message says what you missed)
  play(fx, title, text = "") { if (fx && Eggs.calm()) return Eggs.say(title, text || "Motion is turned off, so you'll have to imagine it"); if (fx) Eggs.fx[fx](); Eggs.say(title, text); },
  // phrases typed into search or the assistant: [pattern, effect, title, text]
  phrases: [
    [/^(do an? )?barrel roll$/, "roll", "Wheee!", "Press Z or R twice"],
    [/^(the )?matrix$|^hack the planet$|^follow the white rabbit$/, "matrix", "Wake up, Neo…", "The Matrix has you"],
    [/^(let it )?snow$/, "snow", "Let it snow", "No shoveling required"],
    [/^(flip (the )?table|\(╯°□°\)╯︵ ┻━┻)$/, "flip", "(╯°□°)╯︵ ┻━┻", "┬─┬ノ( º _ ºノ) Please put it back when you're done"],
    [/^choo choo$|^all aboard$/, "train", "Choo choo!", ""],
    [/^(what is )?the answer to (life|everything).*$/, null, "42", "The hard part is knowing the question"],
    [/^(open the pod bay doors?)(,? hal)?$/, null, "I'm sorry, Dave. I'm afraid I can't do that.", ""],
    [/^is it plugged in$/, null, "Have you tried turning it off and on again?", "Settings → Power has a Restart button"],
    [/^who made (this|you)$/, null, "Made with ❤ and a lot of coffee", "Thanks for using Linux Dashboard"],
  ],
  match(s) { s = String(s).trim().toLowerCase().replace(/[.!?]+$/, ""); return Eggs.phrases.find(([re]) => re.test(s)); },
  try(s) { const m = Eggs.match(s); if (!m) return false; Eggs.play(m[1], m[2], m[3]); return true; },
  // terminal lines that get an answer instead of being run: [title, text, effect]
  term: {
    "make me a sandwich": ["What? Make it yourself.", "Try asking nicely, with sudo"],
    "sudo make me a sandwich": ["Okay. 🥪", "xkcd 149"],
    "xyzzy": ["Nothing happens.", ""],
    "plugh": ["A hollow voice says “Fool.”", ""],
    "exit": ["There is no escape.", "Well, there's Ctrl+Q"],
    "hello": ["Hello, world!", ""],
    "please": ["Since you asked so nicely…", "…you still need to type a command"],
    "rtfm": ["The manual is the friends we made along the way.", "Or try: man man"],
    "sl": ["You meant ls. Here's a train anyway.", "", "train"],
    "hack": ["I'm in.", "(Not really.)", "matrix"],
    "make coffee": ["418 I'm a teapot", "This computer can only make tea"],
    "sudo rm -rf /": ["Nice try.", "The dashboard won't run that one for you. Neither should you"],
    "sudo !!": ["Is that how we ask?", "Just retype the command with sudo in front"],
    "emacs": ["A great operating system, lacking only a decent editor.", "Try the Konsole button for real editors"],
    "vim": ["You're in. Now try getting out.", "Hint: Esc, then :q! — or use the Konsole button"],
    "nano": ["The editor for people who want to get things done.", "Use the Konsole button to open it"],
  },
  // things that happen on certain days, once per day
  dates() {
    const d = new Date(), md = `${d.getMonth() + 1}-${d.getDate()}`, key = "egg-day-" + d.toDateString();
    const hit = { "8-25": [null, "Happy birthday, Linux! 🎂", `Linus Torvalds announced it on this day in 1991, ${d.getFullYear() - 1991} years ago`],
      "10-31": [null, "🎃 Boo!", "Your files are fine. Probably."], "12-24": ["snow", "Merry Christmas Eve 🎄", ""], "12-25": ["snow", "Merry Christmas 🎄", ""],
      "1-1": [null, `Happy ${d.getFullYear()}! 🎆`, ""], "3-14": [null, "Happy π day 🥧", "3.14159265358979…"],
      "4-1": [null, "Your computer has been upgraded to Windows.", "April Fools! 🐟"], "5-4": [null, "May the Fourth be with you", ""] }[md];
    try { if (!hit || localStorage.getItem(key)) return; localStorage.setItem(key, 1); } catch { if (!hit) return; }
    setTimeout(() => Eggs.play(...hit), 1500);
  },
};
// ↑ ↑ ↓ ↓ ← → ← → B A, anywhere outside a text box
document.addEventListener("keydown", e => {
  if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;
  const code = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "KeyB", "KeyA"];
  Eggs.k = e.code === code[Eggs.k || 0] ? (Eggs.k || 0) + 1 : e.code === "ArrowUp" ? (Eggs.k === 2 ? 2 : 1) : 0;  // extra ↑ presses still count
  if (Eggs.k === code.length) { Eggs.k = 0; Eggs.play(null, "+30 lives", "Your computer is now invincible. (It isn't.)"); }
});
// 13:37, once a day while the app is open
setInterval(() => { const d = new Date(); if (d.getHours() === 13 && d.getMinutes() === 37 && Eggs.leet !== d.toDateString()) { Eggs.leet = d.toDateString(); Eggs.say("It's 13:37", "Very l33t of you to be here"); } }, 30000);
function modal({ title, text = "", html = "", cmd = "", input = null, okText = "OK", danger = false, icon = "info", color = "blue", list = null, cancel = "Cancel" }) {
  return new Promise(res => {
    $("#mIcon").innerHTML = tile(icon, danger ? "red" : color, danger ? "danger" : "");
    $("#mTitle").textContent = title; if (html) $("#mText").innerHTML = html; else $("#mText").textContent = text; $("#mText").style.display = text || html ? "" : "none";
    $("#mCmd").style.display = cmd ? "" : "none"; $("#mCmd").textContent = cmd ? "$ " + cmd : "";
    const inp = $("#mInput");
    inp.style.display = input ? "" : "none";
    $("#mList").innerHTML = (list || []).map(o => `<option value="${esc(o)}">`).join("");
    if (input) { inp.type = input.type || "text"; inp.placeholder = input.placeholder || ""; inp.value = input.value || ""; }
    $("#mOk").textContent = okText; $("#mOk").className = "btn " + (danger ? "danger" : "primary");
    $("#mCancel").textContent = cancel; $("#mCancel").style.display = cancel ? "" : "none";
    clearTimeout($("#modal")._ct); $("#modal").classList.remove("closing"); $("#modal").classList.add("open");
    setTimeout(() => (input ? inp : $("#mOk")).focus(), 30);
    const done = v => { closeOverlay($("#modal")); $("#mOk").onclick = $("#mCancel").onclick = inp.onkeydown = null; modal.cancel = null; res(v); };
    modal.cancel = () => done(null);
    $("#mOk").onclick = () => done(input ? inp.value : true);
    $("#mCancel").onclick = () => done(null);
    inp.onkeydown = e => { if (e.key === "Enter") done(inp.value); };
  });
}

function notifyIfAway(title, body, t0) {
  if (!SETTINGS.notifyDone || Date.now() - t0 < 8000 || (!document.hidden && document.hasFocus())) return;
  api("/api/notify", { title, body: String(body).slice(0, 160), sound: !!SETTINGS.soundDone }).catch(() => {});
}

/* ================= remembered admin password: sidebar indicator ================= */
function renderAdminChip() {
  const el = $("#adminChip"); if (!el) return;
  const s = ADMIN_STATE;
  el.classList.toggle("hidden", !s.active);
  if (!s.active) return;
  const left = s.busy ? "working…" : s.left == null ? "until you close the app" : `${Math.floor(s.left / 60)}:${String(s.left % 60).padStart(2, "0")} left`;
  el.innerHTML = `${ic("unlock")}<div><b>Admin unlocked</b><small>${left}</small></div><button class="btn sm" id="adminLock" title="Forget the password now">${ic("lock")}Lock</button>`;
}
setInterval(async () => { if (document.hidden) return; try { ADMIN_STATE = await api("/api/admin/status"); renderAdminChip(); } catch {} }, 2000);

/* ================= background update check ================= */
let UPDATES = null;
async function checkUpdatesQuietly() {
  if (SETTINGS.updateCheck === "never") { UPDATES = null; return renderUpdateBadge(); }
  const every = SETTINGS.updateCheck === "6h" ? 6 * 3600e3 : 24 * 3600e3;
  let last = 0; try { last = +localStorage.getItem("updatesChecked") || 0; UPDATES = JSON.parse(localStorage.getItem("updates") || "null"); } catch {}
  renderUpdateBadge();
  if (Date.now() - last < every) return;
  const r = await api("/api/updates/count", {}).catch(() => null);
  if (!r || r.error) return;
  UPDATES = r; try { localStorage.setItem("updates", JSON.stringify(r)); localStorage.setItem("updatesChecked", String(Date.now())); } catch {}
  renderUpdateBadge();
}
function renderUpdateBadge() {  // may run before the alerts code has loaded (first sidebar draw): then it simply waits
  try { ALERTS = computeAlerts(); renderNavBadges(); renderPageAlerts(CUR); } catch {}
}
setTimeout(checkUpdatesQuietly, 20000); setInterval(checkUpdatesQuietly, 30 * 60e3);

/* ================= harm warnings ================= */
const HARM = { data: ["Could lose data", "trash", "red"], system: ["Could break things", "alert", "orange"], security: ["Security", "shield", "violet"],
  privacy: ["Privacy", "eye", "pink"], physical: ["Hardware", "flame", "amber"], interrupt: ["Interrupts you", "power", "slate"] };
let ADMIN_STATE = { active: false };
function harmHtml(r, why) {
  return `<div class="warnlist">${r.warnings.map(w => { const [label, icon, color] = HARM[w.kind] || HARM.system;
    return `<div class="warnitem">${tile(icon, color, "soft")}<div><b>${label}</b><span>${esc(w.text)}</span></div></div>`; }).join("")}</div>` +
    (why ? `<p class="warnwhy">${esc(why)}</p>` : "") +
    (r.admin && ADMIN_STATE.active ? `<p class="warnwhy">${ic("unlock")} This needs administrator rights. Your password is remembered, so it will run straight away.</p>` : "");
}
// Ask before running anything that could do harm. force = ask even if no specific harm was found.
async function warnGate(cmd, title = "", { force = false, why = "", report = null } = {}) {
  if (!SETTINGS.warnHarm && !force) return true;
  const r = report || await api("/api/risk", { cmd }).catch(() => ({ level: "none", warnings: [] }));
  if (!r.warnings?.length && !force) return true;
  if (!r.warnings?.length) r.warnings = [];
  const danger = r.level === "danger" || force;
  return !!(await modal({ title: title ? `Before you run “${title}”` : "Before you run this", html: harmHtml(r, why) || esc(why), cmd,
    okText: danger ? "I understand, run it" : "Run it", danger, icon: danger ? "alert" : "info", color: "orange" }));
}

/* ================= output drawer + activity log ================= */
const jobs = []; let curJob = null; const activity = [];
function drawerOpen(open) { $("#drawer").classList.toggle("open", open); }
function renderTabs() {
  const busy = jobs.filter(j => !j.state).length;
  $("#drawerTitle").innerHTML = ic("terminal") + "Activity & output" + (busy ? ` <span class="runchip"><span class="spin"></span>${busy} running</span>` : "");
  $("#jtabs").innerHTML = `<span class="jtab ${curJob ? "" : "on"}" data-job=""><span class="n">Activity</span></span>` +
    jobs.map(j => `<span class="jtab ${j === curJob ? "on" : ""}" data-job="${j.id}"><span class="dot ${j.state}"></span><span class="n">${esc(j.name)}</span><span class="x" data-x="${j.id}">${ic("x")}</span></span>`).join("");
  const showLog = !curJob;
  $("#actlog").style.display = showLog ? "" : "none";
  $("#out").style.display = $("#cmdline").style.display = showLog ? "none" : "";
  if (showLog) renderLog();
}
function renderLog() {
  $("#actlog").innerHTML = activity.length ? activity.slice().reverse().map(a => `<div><time>${a.time}</time><span class="${a.ok ? "ok" : "fail"}">${a.ok ? "✔" : "✘"}</span><span>${esc(a.title)}<br><code>$ ${esc(a.cmd)}</code>${a.out && !a.ok ? `<br><span class="fail">${esc(a.out.slice(-300))}</span>` : ""}</span></div>`).join("")
    : `<div style="color:#6b7385">Every change you make shows up here with the exact terminal command that did it.</div>`;
}
function logActivity(title, cmd, ok, out = "") {
  activity.push({ title, cmd, ok, out, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) });
  if (activity.length > 200) activity.shift();
  if (!curJob) renderLog();
}
function cleanText(t) {
  t = t.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
  return t.split("\n").map(l => { const i = l.lastIndexOf("\r", l.length - 2); return i >= 0 ? l.slice(i + 1) : l; }).join("\n").replace(/\r/g, "");
}
function renderOut() {
  if (!curJob) return;
  const o = $("#out");
  const atBottom = o.scrollHeight - o.scrollTop - o.clientHeight < 40;
  $("#outCmd").textContent = curJob.cmd;
  let html = esc(cleanText(curJob.text));
  if (curJob.state) html += curJob.code === 0
    ? `\n<span class="exit ok">${ic("checkcircle")} Finished successfully</span>`
    : `\n<span class="exit fail">${ic("xcircle")} Finished with error ${curJob.code}${(curJob.code === 126 || curJob.code === 127) && curJob.cmd.includes("pkexec") ? " (password cancelled?)" : ""}</span>`;
  o.innerHTML = html || `<span class="exit">Running…</span>`;
  if (atBottom) o.scrollTop = o.scrollHeight;
  $("#outStop").style.display = curJob.state ? "none" : "";
  $("#outAsk").style.display = curJob.state === "fail" ? "" : "none";
}
async function run(cmd, name, opts = {}) {
  if (!opts.confirmed && !(await warnGate(cmd, name, { force: !!(SETTINGS.devMode && SETTINGS.devConfirmAll), why: SETTINGS.devConfirmAll ? "Developer mode: confirming every command." : "" }))) return { cmd, text: "", state: "fail", code: -2, cancelled: true };
  passwordHeadsUp(/\bpkexec\b|--sudo pkexec/.test(cmd));
  const job = { id: Math.random().toString(36).slice(2), name: name || cmd.slice(0, 28), cmd, text: "", state: "", code: null, t0: Date.now() };
  jobs.push(job);
  if (jobs.length > 8) { const i = jobs.findIndex(j => j.state); if (i >= 0) jobs.splice(i, 1); }
  curJob = job; renderTabs(); renderOut(); if (SETTINGS.autoOpen) drawerOpen(true);
  try {
    const r = await fetch("/api/run", { method: "POST", headers: { "X-Token": TOKEN, "Content-Type": "application/json" }, body: JSON.stringify({ cmd, id: job.id, cwd: opts.cwd }) });
    const reader = r.body.getReader(), dec = new TextDecoder();
    let raf = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      job.text += dec.decode(value, { stream: true });
      if (job.text.length > 400000) job.text = "…(older output trimmed)…\n" + job.text.slice(-300000);
      if (job === curJob && !raf) raf = requestAnimationFrame(() => { raf = 0; renderOut(); });
    }
  } catch (e) { job.text += "\n[connection lost: " + e.message + "]"; }
  const m = job.text.match(/\n\x00EXIT:(-?\d+)$/);
  job.code = m ? +m[1] : -1; job.text = job.text.replace(/\n\x00EXIT:-?\d+$/, "");
  job.state = job.code === 0 ? "ok" : "fail";
  renderTabs(); if (job === curJob) renderOut();
  notifyIfAway(`${job.code === 0 ? "Finished" : "Didn't finish"}: ${job.name}`, job.cmd, job.t0);
  if (job.code === 0) setTimeout(() => refreshAlerts(true), 800);
  if (SETTINGS.autoCloseDrawer && job.code === 0) setTimeout(() => { if (curJob === job) drawerOpen(false); }, 3500);
  opts.after?.(job);
  return job;
}
$("#drawerTitle").innerHTML = ic("terminal") + "Activity & output";
$("#drawerTog").innerHTML = ic("chevup");
$("#jtabs").onclick = e => {
  const x = e.target.closest("[data-x]")?.dataset.x;
  if (x) {
    const j = jobs.find(j => j.id === x); if (!j.state) api("/api/stop", { id: x });
    jobs.splice(jobs.indexOf(j), 1); if (curJob === j) curJob = jobs.at(-1) || null; renderTabs(); renderOut(); return;
  }
  const t = e.target.closest(".jtab"); if (t) { curJob = jobs.find(j => j.id === t.dataset.job) || null; renderTabs(); renderOut(); drawerOpen(true); }
};
$("#outStop").onclick = () => curJob && api("/api/stop", { id: curJob.id });
$("#outCopy").onclick = () => { if (curJob) { navigator.clipboard.writeText(curJob.cmd); toast("ok", "Command copied"); } };
$("#drawerTog").onclick = $("#drawerTitle").onclick = () => drawerOpen(!$("#drawer").classList.contains("open"));

/* ================= controls (toggles / sliders / pickers) ================= */
let CTL = {};
const ADMIN = new Set(["performance", "ntp", "timezone", "hostname"]);
ADMIN.has = (orig => id => orig.call(ADMIN, id) || String(id).startsWith("svc_"))(ADMIN.has);
const FMT = {
  volume: v => v + "%", mic: v => v + "%", brightness: v => v + "%", nighttemp: v => v + " K", panel_height: v => v + " px",
  mouse_speed: v => +v === 0 ? "Default" : (v > 0 ? "+" : "") + Math.round(v * 100) + "%", mouse_scroll: v => (+v).toFixed(2).replace(/\.?0+$/, "") + "×",
  animspeed: v => (+v === 0 ? "Instant" : +v <= .5 ? "Fast" : +v <= 1 ? "Normal" : +v <= 1.5 ? "Relaxed" : "Slow"),
};
async function loadCtl() { CTL = await api("/api/controls"); syncControls(); }
const refreshCtl = debounce(loadCtl, 700);
function paintRange(el) { const p = (el.value - el.min) / (el.max - el.min) * 100; el.style.setProperty("--p", p + "%"); const v = $(`[data-val="${el.dataset.ctl}"]`, el.closest(".row, .slider, .ctl") || document); if (v && FMT[el.dataset.ctl]) v.textContent = FMT[el.dataset.ctl](el.value); else if (v) v.textContent = el.value + (el.dataset.unit || ""); }
function syncControls() {
  $$("[data-ctl]").forEach(el => {
    const id = el.dataset.ctl, v = CTL[id];
    if (el.classList.contains("qt")) { el.classList.toggle("on", !!v); $("small", el).textContent = v ? (el.dataset.onText || "On") : (el.dataset.offText || "Off"); return; }
    if (v === undefined) return;
    if (el.type === "checkbox") el.checked = !!v;
    else if (el.type === "range") { if (v === null) { el.closest(".row, .slider")?.style.setProperty("opacity", ".45"); return; } if (document.activeElement !== el) { el.value = v; } paintRange(el); }
    else if (el.tagName === "SELECT") { if (v !== null && ![...el.options].some(o => o.value === String(v))) el.insertAdjacentHTML("beforeend", `<option value="${esc(v)}">${esc(v)}</option>`); el.value = String(v); }
    else if (el.tagName === "INPUT" && document.activeElement !== el) el.value = v ?? "";
  });
  $$("[data-on-ctl]").forEach(el => el.classList.toggle("on", String(CTL[el.dataset.onCtl]) === (el.dataset.cv ?? el.dataset.v)));
  if (typeof syncPanelPreview === "function") syncPanelPreview();
  $$("[data-mute-ctl]").forEach(el => { const m = CTL[el.dataset.muteCtl]; el.innerHTML = ic(m ? el.dataset.offIcon : el.dataset.onIcon); el.title = m ? "Unmute" : "Mute"; });
}
function passwordHeadsUp(needs) {
  if (!needs || ADMIN_STATE.active) return;
  toast("info", "A password box is about to appear", "Type your normal login password. The dashboard then remembers it for a few minutes.");
}
async function setCtl(id, value, { quiet = false, label = null, silent = false, confirmed = false } = {}) {
  if (silent) return api("/api/control", { id, value }).catch(() => {});
  if (!quiet && !confirmed && SETTINGS.warnHarm) {  // check what this change would actually run
    const pv = await api("/api/control/preview", { id, value }).catch(() => null);
    if (pv?.warnings?.length && !(await warnGate(pv.cmd, label || SEARCH.find(s => s.ctl === id)?.title || id, { report: pv }))) { syncControls(); return { ok: false, cancelled: true }; }
  }
  passwordHeadsUp(ADMIN.has(id) || /^(svc_|fanmode|fanoverdrive|fancustom|zram|bluetooth$)/.test(id) && id !== "bluetooth");
  const host = $$(`[data-ctl="${CSS.escape(id)}"]`).map(e => e.closest(".row, .qt")).filter(Boolean);
  host.forEach(h => h.classList.add("busy"));
  const prev = CTL[id]; CTL[id] = value; syncControls();
  let r;
  try { r = await api("/api/control", { id, value }); } catch { r = { ok: false, cmd: "", output: "request failed" }; }
  host.forEach(h => h.classList.remove("busy"));
  const title = label || SEARCH.find(s => s.ctl === id)?.title || id;
  logActivity(title + " → " + (typeof value === "boolean" ? (value ? "on" : "off") : FMT[id]?.(value) ?? value), r.cmd, r.ok, r.output);
  if (!r.ok) {
    CTL[id] = prev; syncControls();
    toast("fail", `Couldn't change ${title}` + ((r.code === 126 || r.code === 127) && r.cmd.includes("pkexec") ? " (password cancelled)" : ""), r.output || r.cmd);
  } else if (!quiet) toast("ok", title + (typeof value === "boolean" ? (value ? " turned on" : " turned off") : " updated"), r.cmd);
  if (r.ok) setTimeout(() => { if (typeof refreshAlerts === "function") refreshAlerts(true); }, 900);
  if (r.ok && (ADMIN.has(id) || id.startsWith("svc_") || ["dark", "airplane", "bluetooth", "colorscheme", "lookandfeel", "nighttemp"].includes(id) || id.startsWith("panel_"))) refreshCtl();
  return r;
}

/* ================= row builders (also feed the search index) ================= */
const SEARCH = []; let BUILDING = "";
const lockBadge = `<span class="badge">${ic("lock")}admin</span>`;
let rowSeq = 0;
function reg(entry) { const anchor = "r" + (++rowSeq); SEARCH.push({ page: BUILDING, anchor, ...entry }); return anchor; }
function rowWrap(anchor, icon, color, title, desc, ctl, admin, extra = "") {
  const grow = /class="slider"|type="text"/.test(ctl) ? " grow" : "";
  return `<div class="row ${extra}" id="${anchor}">${tile(icon, color)}<div class="txt"><b>${title}${admin ? lockBadge : ""}</b>${desc ? `<small>${desc}</small>` : ""}</div><div class="ctl${grow}">${ctl}</div></div>`;
}
function tog(id, icon, color, title, desc = "", o = {}) {
  if (!hasCtl(id)) return "";
  const a = reg({ title, desc, icon, color, ctl: id, kw: o.kw });
  return rowWrap(a, icon, color, title, desc, `<label class="sw"><input type="checkbox" data-ctl="${id}"><span></span></label>`, o.admin ?? ADMIN.has(id));
}
function sld(id, icon, color, title, desc, { min = 0, max = 100, step = 1, admin, cls = "", unit = "", kw, commit, preview } = {}) {
  if (!hasCtl(id)) return "";
  if (preview && !hasCtl(preview)) preview = "";
  const a = reg({ title, desc, icon, color, ctl: id, kw });
  const isAdmin = admin ?? ADMIN.has(id);
  return rowWrap(a, icon, color, title, desc, `<div class="slider"><input type="range" class="${cls}" min="${min}" max="${max}" step="${step}" data-ctl="${id}" data-unit="${unit}" ${isAdmin || commit ? 'data-admin="1"' : ""} ${preview ? `data-preview="${preview}"` : ""}><span class="val" data-val="${id}">–</span></div>`, isAdmin);
}
// segmented control bound to a setting: opts = [[value, label, icon]]
function segCtl(id, icon, color, title, desc, opts, o = {}) {
  if (!hasCtl(id)) return "";
  const a = reg({ title, desc, icon, color, ctl: id, kw: o.kw });
  return rowWrap(a, icon, color, title, desc, `<div class="seg">${opts.map(([v, l, i]) => `<button data-set="${id}" data-v='${esc(JSON.stringify(v))}' data-cv="${esc(String(v))}" data-on-ctl="${id}">${i ? ic(i) : ""}${l}</button>`).join("")}</div>`, o.admin);
}
// segmented choice for a dashboard preference
function prefSeg(key, opts) { return `<div class="seg" data-pref-seg="${key}">${opts.map(([v, l]) => `<button data-v="${esc(v)}">${l}</button>`).join("")}</div>`; }
// toggle for a dashboard preference (stored in ~/.config/linux-dashboard/settings.json)
function prefTog(key, icon, color, title, desc = "") {
  const a = reg({ title, desc, icon, color, kw: "dashboard preference" });
  return rowWrap(a, icon, color, title, desc, `<label class="sw"><input type="checkbox" data-pref="${key}"><span></span></label>`, false);
}
function sel(id, icon, color, title, desc, options, o = {}) {
  if (!hasCtl(id)) return "";
  const a = reg({ title, desc, icon, color, ctl: id, kw: o.kw });
  const opts = options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
  return rowWrap(a, icon, color, title, desc, `<select data-ctl="${id}" ${o.attrs || ""}>${opts}</select>`, o.admin ?? ADMIN.has(id));
}
function custom(icon, color, title, desc, ctlHtml, o = {}) {
  const a = reg({ title, desc, icon, color, kw: o.kw });
  return rowWrap(a, icon, color, title, desc, ctlHtml, o.admin, o.cls);
}
function actRow(key) {
  const x = A[key]; if (!x) return ""; const a = reg({ title: x.t, desc: x.d, icon: x.i, color: x.c, act: key });
  return rowWrap(a, x.i, x.c, x.t, x.d, `<button class="btn" data-act="${key}">${x.btn || "Run"}</button>`, x.admin);
}
function acts(keys) {
  keys = keys.filter(k => A[k]); if (!keys.length) return "";
  return `<div class="actions">` + keys.map(k => {
    const x = A[k]; const a = reg({ title: x.t, desc: x.d, icon: x.i, color: x.c, act: k });
    return `<button class="act" id="${a}" data-act="${k}" style="--tc:var(--c-${x.c})">${tile(x.i, x.c)}<div><b>${x.t}${x.admin ? lockBadge : ""}</b>${x.d ? `<small>${x.d}</small>` : ""}</div></button>`;
  }).join("") + `</div>`;
}
const group = (...rows) => rows.some(r => r) ? `<div class="group">${rows.join("")}</div>` : "";
const secIf = (title, body, right = "") => body ? sec(title, right) + body : "";  // a heading only when there's something under it
const sec = (title, right = "") => `<h2 class="sec">${title}${right ? `<span class="right">${right}</span>` : ""}</h2>`;
const note = html => `<div class="note">${ic("bulb")}<div>${html}</div></div>`;
// while something loads, show a soft shimmer instead of the words "Loading…"
const skeleton = (n = 4) => `<div class="skel" aria-label="Loading">${Array.from({ length: n }, (_, i) => `<div class="skel-row"><i class="skel-ic"></i><div><i style="width:${46 + (i * 17) % 40}%"></i><i style="width:${24 + (i * 23) % 30}%"></i></div></div>`).join("")}</div>`;
const empty = (icon, text) => /^(Loading|Looking|Searching|Checking)/.test(text) ? skeleton() : `<div class="empty">${ic(icon)}<div>${text}</div></div>`;
function closeOverlay(el) {  // fade out, then hide
  if (!el.classList.contains("open") || el.classList.contains("closing")) return;
  el.classList.add("closing");
  clearTimeout(el._ct); el._ct = setTimeout(() => el.classList.remove("open", "closing"), SETTINGS.reduceMotion ? 0 : 150);
}
function segHtml(id, opts, cur) { return `<div class="seg" id="${id}">` + opts.map(([v, l, i]) => `<button data-v="${v}" class="${v === cur ? "on" : ""}">${i ? ic(i) : ""}${l}</button>`).join("") + `</div>`; }
function seg(id, onChange) {
  const el = $("#" + id);
  el.addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; $$("button", el).forEach(x => x.classList.toggle("on", x === b)); onChange(b.dataset.v); });
  return () => $(".on", el)?.dataset.v;
}

/* ================= action library ================= */
const CHECK_UPDATES = PLAT.pkg.check || "echo 'No package manager found'";
const PIPEWIRE = PLAT.pipewire !== false;
const PLAY = f => `(command -v pw-play >/dev/null && pw-play ${f} || paplay ${f})`;
const A = {
  checkUpdates: { t: "Check for updates", d: "See what's waiting, installs nothing", i: "search", c: "blue", cmd: CHECK_UPDATES },
  updateAll: { t: "Update everything", d: listText(["System", PLAT.aur ? "AUR" : "", PLAT.flatpak ? "Flatpak" : "", PLAT.snap ? "Snap" : ""].filter(Boolean)) + (PLAT.flatpak || PLAT.snap ? " apps" : " packages"), i: "download", c: "green", admin: true, after: "updatesDone", cmd: `${PLAT.pkg.update}; echo; echo "Tip: if the kernel was updated, restart soon."`, confirm: "This downloads and installs all available updates. Don't turn the computer off while it runs." },
  cleanup: { t: "Clean up packages", d: "Unused dependencies + old downloads", i: "broom", c: "orange", admin: true, cmd: PLAT.pkg.cleanup, confirm: "Removes packages nothing needs anymore and old cached package downloads." },
  pingTest: { t: "Am I online?", d: "Ping the internet and test DNS", i: "globe", c: "teal", cmd: `echo "Pinging 1.1.1.1 (internet, no DNS)…"; ping -c 3 -W 2 1.1.1.1 && echo && echo "Looking up archlinux.org (tests DNS)…" && getent hosts archlinux.org && echo && echo "✅ You're online and DNS works."` },
  speedTest: { t: "Speed test", d: "Download 50 MB from Cloudflare", i: "gauge", c: "cyan", cmd: `echo "Testing download speed…"; curl -s -o /dev/null --max-time 40 -w '%{speed_download} %{time_total}' 'https://speed.cloudflare.com/__down?bytes=50000000' | awk '{printf "Download: %.1f Mbit/s  (%.1f s)\\n", $1*8/1e6, $2}'; echo "Latency:"; ping -c 4 -q 1.1.1.1 | tail -1` },
  publicIp: { t: "My public IP", d: "The address websites see", i: "globe", c: "indigo", cmd: `curl -s --max-time 8 https://ifconfig.me && echo` },
  restartNet: { t: "Restart networking", d: "Fixes most \"connected, no internet\"", i: "refresh", c: "orange", admin: true, cmd: `pkexec systemctl restart NetworkManager && sleep 3 && nmcli general status` },
  ports: { t: "What's listening?", d: "Programs accepting connections", i: "server", c: "slate", cmd: `ss -tulpn` },
  savedNets: { t: "Saved networks", d: "Every connection this PC remembers", i: "list", c: "blue", cmd: `nmcli -f NAME,TYPE,AUTOCONNECT,TIMESTAMP-REAL connection show` },
  drives: { t: "All drives & partitions", d: "Every disk, partition and USB stick", i: "disk", c: "slate", cmd: `lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINTS,LABEL,MODEL; echo; df -h -x tmpfs -x devtmpfs -x efivarfs` },
  bigFolders: { t: "Biggest folders", d: "What's eating your home folder", i: "folder", c: "amber", cmd: `du -h -d1 ~ 2>/dev/null | sort -rh | head -25` },
  bigFiles: { t: "Biggest files", d: "Top 25 files over 100 MB", i: "file", c: "orange", cmd: `find ~ -xdev -type f -size +100M -printf '%s\\t%p\\n' 2>/dev/null | sort -rn | head -25 | numfmt --to=iec --field=1` },
  clearCache: { t: "Clear app cache", d: "~/.cache. Safe, apps rebuild it", i: "broom", c: "pink", btn: "Clear", cmd: `du -sh ~/.cache; rm -rf ~/.cache/* && echo "Cache cleared."`, confirm: "Deletes everything in ~/.cache. Apps rebuild what they need. Close your web browser first.", after: "storage" },
  emptyTrash: { t: "Empty trash", d: "Permanently delete trashed files", i: "trash", c: "red", btn: "Empty", cmd: `du -sh ~/.local/share/Trash 2>/dev/null; rm -rf ~/.local/share/Trash/files/* ~/.local/share/Trash/info/* && echo "Trash emptied."`, confirm: "Files in the trash will be permanently deleted.", after: "storage" },
  pkgCache: { t: "Old package downloads", d: `Installer files ${PLAT.manager || "the package manager"} keeps around`, i: "package", c: "violet", btn: "Clean", admin: true, cmd: PLAT.pkg.cache_dir && PLAT.pkg.cache_clean ? `du -sh ${PLAT.pkg.cache_dir}; ${PLAT.pkg.cache_clean}; du -sh ${PLAT.pkg.cache_dir}` : "", after: "storage" },
  cleanFlatpak: { t: "Unused Flatpak runtimes", d: "Removes old libraries no app is using", i: "box", c: "teal", btn: "Clean", cmd: `flatpak uninstall --unused -y 2>/dev/null || echo "No unused Flatpak runtimes found"`, after: "storage" },
  journalVacuum: { t: "System logs", d: "Keep only the last 2 weeks", i: "scroll", c: "slate", btn: "Shrink", admin: true, cmd: `journalctl --disk-usage; pkexec journalctl --vacuum-time=2weeks; journalctl --disk-usage`, after: "storage" },
  cleanAllJunk: { t: "Clean all safe junk", d: "Package cache, user cache, trash, and unused Flatpaks", i: "sparkles", c: "amber", btn: "Clean All", admin: true, cmd: `echo "=== 1. Emptying Trash ==="; rm -rf ~/.local/share/Trash/files/* ~/.local/share/Trash/info/* 2>/dev/null; echo "=== 2. Cleaning Flatpak ==="; flatpak uninstall --unused -y 2>/dev/null || true; echo "=== 3. Cleaning package cache ==="; ${PLAT.pkg.cache_clean || "true"}; echo "=== 4. Vacuuming journals ==="; pkexec journalctl --vacuum-time=2weeks 2>/dev/null || true; echo "All safe junk cleaned!"`, confirm: "This cleans trash, package installer caches, unused Flatpaks, and trims old logs.", after: "storage" },
  trim: { t: "Optimize SSD (TRIM)", d: "Tell the SSD which blocks are free", i: "sparkles", c: "green", admin: true, cmd: `pkexec fstrim -av` },
  smart: { t: "Drive health check", d: "SMART status for every disk", i: "heart", c: "red", admin: true, cmd: `pkexec bash -c 'for d in $(lsblk -dnpo NAME -e7,11); do echo "== $d"; smartctl -H -A "$d" | tail -n +4; echo; done'` },
  restartAudio: PIPEWIRE ? { t: "Fix sound", d: "Restart PipeWire audio", i: "wrench", c: "pink", cmd: `systemctl --user restart pipewire pipewire-pulse wireplumber && sleep 1 && echo "Audio restarted." && wpctl status | head -40` }
    : { t: "Fix sound", d: "Restart PulseAudio", i: "wrench", c: "pink", cmd: `pulseaudio -k; sleep 2; echo "Audio restarted."; pactl info | head -8` },
  audioDevices: { t: "List audio devices", d: "Speakers, headsets, mics", i: "list", c: "violet", cmd: PIPEWIRE ? `wpctl status` : `echo "== Outputs =="; pactl list short sinks; echo; echo "== Inputs =="; pactl list short sources | grep -v monitor` },
  testSpeaker: { t: "Test speakers", d: "Play a short sound", i: "music", c: "blue", cmd: `f=$(find /usr/share/sounds -name 'complete.oga' -o -name 'bell.oga' -o -name 'message-new-instant.oga' -o -name 'bell.ogg' 2>/dev/null | head -1); echo "Playing $f"; ${PLAY('"$f"')} && echo "Did you hear it?"` },
  testMic: { t: "Test microphone", d: "Record 4 seconds, then play back", i: "mic", c: "red", cmd: `F="$XDG_RUNTIME_DIR/mic-test.wav"; echo "🎙  Recording 4 seconds. Say something…"; if command -v pw-record >/dev/null; then timeout 4 pw-record "$F"; else timeout 4 parecord --file-format=wav "$F"; fi; echo "🔊 Playing it back…"; ${PLAY('"$F"')}; rm -f "$F"; echo Done.` },
  lock: { t: "Lock screen", i: "lock", c: "slate", cmd: `loginctl lock-session` },
  suspend: { t: "Sleep", i: "moon", c: "indigo", cmd: `systemctl suspend` },
  logout: { t: "Log out", i: "logout", c: "amber", cmd: PLAT.logout || `loginctl terminate-session "$XDG_SESSION_ID"`, confirm: "Save your work first. You'll be logged out." },
  reboot: { t: "Restart", i: "restart", c: "orange", cmd: `systemctl reboot`, confirm: "Save your work first. The computer will restart now." },
  poweroff: { t: "Shut down", i: "power", c: "red", cmd: `systemctl poweroff`, confirm: "Save your work first. The computer will turn off now." },
  firmware: { t: "Restart to firmware", d: "Boot into BIOS/UEFI setup", i: "chip", c: "slate", cmd: `systemctl reboot --firmware-setup`, confirm: "Restarts straight into the firmware setup screen." },
  errorsNow: { t: "Errors since boot", d: "What went wrong this session", i: "alertcircle", c: "red", cmd: `journalctl -b -p err --no-pager | tail -200` },
  errorsLast: { t: "Errors from last boot", d: "Useful after a crash or freeze", i: "history", c: "orange", cmd: `journalctl -b -1 -p err --no-pager | tail -200` },
  failedSvc: { t: "Failed services", d: "Background services that crashed", i: "xcircle", c: "red", cmd: `systemctl --failed; systemctl --user --failed` },
  kernel: { t: "Kernel & hardware log", d: "Drivers, USB, devices", i: "cpu", c: "violet", cmd: `journalctl -k -b --no-pager | tail -150` },
  liveLog: { t: "Watch log live", d: "Stream events as they happen", i: "activity", c: "green", cmd: `journalctl -f -n 30` },
  bootTime: { t: "Why is boot slow?", d: "What takes longest at startup", i: "timer", c: "amber", cmd: `systemd-analyze; echo; echo "Slowest parts:"; systemd-analyze blame | head -15` },
  sysinfo: { t: "Full system info", d: "Hardware summary for bug reports", i: "info", c: "blue", cmd: `echo "OS:      $(. /etc/os-release; echo $PRETTY_NAME)"; echo "Kernel:  $(uname -r)"; echo "Host:    $(cat /sys/class/dmi/id/product_name 2>/dev/null)"; echo "CPU:     $(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2 | xargs) ($(nproc) threads)"; echo "GPU:     $(lspci | grep -iE 'vga|3d|display' | cut -d: -f3 | xargs)"; echo "Memory:  $(free -h | awk '/Mem/{print $2}')"; echo "Desktop: $XDG_CURRENT_DESKTOP ($XDG_SESSION_TYPE) $(plasmashell --version 2>/dev/null)"; echo; lsblk -dno NAME,SIZE,MODEL -e7,11` },
  shotRegion: { t: "Screenshot: area", d: "Drag to select part of the screen", i: "crop", c: "blue", launch: PLAT.screenshot?.region },
  shotFull: { t: "Screenshot: screen", d: "Capture everything", i: "camera", c: "indigo", launch: PLAT.screenshot?.full },
  shotWindow: { t: "Screenshot: window", d: "Capture one window", i: "window", c: "violet", launch: PLAT.screenshot?.window },
  colorPick: { t: "Color picker", d: "Click anywhere to get its color", i: "pipette", c: "pink", cmd: PLAT.colorPick === false ? "" : `c=$(qdbus6 org.kde.KWin /ColorPicker org.kde.kwin.ColorPicker.pick | tr -dc 0-9); [ -n "$c" ] && printf 'Picked color: #%06X\\n' $((c & 0xFFFFFF))` },
  weather: { t: "Weather", d: "Forecast for where you are", i: "weather", c: "cyan", cmd: `curl -s --max-time 10 'https://wttr.in/?0QT'` },
  password: { t: "Generate a password", d: "20 random characters", i: "key", c: "amber", cmd: `for i in 1 2 3; do tr -dc 'A-Za-z0-9!@#%^*_+=-' </dev/urandom | head -c 20; echo; done` },
  restartPlasma: { t: "Restart desktop shell", d: "Fixes a frozen panel or widgets", i: "refresh", c: "orange", cmd: PLAT.restartShell === "" ? "" : `systemctl --user restart plasma-plasmashell && echo "Plasma restarted."`, confirm: "Your panel and desktop will flicker for a second. Open windows stay open." },
  fontCache: { t: "Refresh fonts", d: "Rebuild the font cache", i: "type", c: "slate", cmd: `fc-cache -f -v | tail -3` },
  sysSettings: { t: "System Settings", d: `Open ${PLAT.desktopName || "the desktop"}'s full settings app`, i: "sliders", c: "blue", launch: PLAT.settingsApp ?? "systemsettings" },
  fileManager: { t: "File manager", d: "Open your home folder", i: "folder", c: "amber", launch: `xdg-open "$HOME"` },
  konsole: { t: "Real terminal", d: `Open ${PLAT.terminal.name}`, i: "terminal", c: "slate", launch: termOpen() },
  virtManager: { t: "Virtual Machine Manager", d: "Full VM editor", i: "box", c: "indigo", launch: `virt-manager --connect qemu:///system` },
  calendar: { t: "Calendar", d: "Last, this and next month", i: "calendar", c: "red", cmd: `cal -3` },
  // fix things
  resetWifi: { t: "Reset Wi-Fi", d: "Turn Wi-Fi off and on again", i: "wifi", c: "cyan", cmd: `nmcli radio wifi off && echo "Wi-Fi off…" && sleep 2 && nmcli radio wifi on && echo "Wi-Fi on. Reconnecting…" && sleep 5 && nmcli -f DEVICE,TYPE,STATE,CONNECTION device | grep -i wifi` },
  fixBluetooth: { t: "Fix Bluetooth", d: "Restart the Bluetooth service", i: "bluetooth", c: "indigo", admin: true, cmd: `rfkill unblock bluetooth; pkexec systemctl restart bluetooth && sleep 2 && echo "Bluetooth restarted." && bluetoothctl show 2>/dev/null | grep -E "Name|Powered"` },
  flushDns: { t: "Flush DNS cache", d: "When websites won't load after a change", i: "globe", c: "teal", cmd: `if command -v resolvectl >/dev/null && resolvectl status >/dev/null 2>&1; then resolvectl flush-caches && echo "DNS cache cleared."; else echo "This computer doesn't keep a DNS cache, so there's nothing to clear."; fi` },
  rebuildMenu: { t: "Refresh app menu", d: "When a new app doesn't show up", i: "grid", c: "blue", cmd: `update-desktop-database ~/.local/share/applications 2>/dev/null; command -v kbuildsycoca6 >/dev/null && kbuildsycoca6 --noincremental >/dev/null 2>&1; echo "App menu refreshed. New apps should show up now."` },
  clearThumbs: { t: "Clear thumbnails", d: "Fixes wrong or stale file previews", i: "image", c: "pink", cmd: `du -sh ~/.cache/thumbnails 2>/dev/null; rm -rf ~/.cache/thumbnails/* && echo "Thumbnails cleared. They're rebuilt as you browse."`, confirm: "Deletes the saved preview pictures of your files. They're recreated automatically." },
  // check & test
  gpuInfo: { t: "Graphics card", d: "Model and the driver it uses", i: "gpu", c: "violet", cmd: `lspci -k | grep -EA3 '^[0-9a-f:.]+ (VGA compatible|3D|Display) controller' | grep -vE 'Subsystem|modules'; echo; command -v glxinfo >/dev/null && glxinfo -B 2>/dev/null | grep -E 'OpenGL (renderer|core profile version) string' || true; echo "Session: $XDG_SESSION_TYPE"` },
  batteryHealth: { t: "Battery health", d: "How much charge it can still hold", i: "zap", c: "green", cmd: PLAT.battery ? `B=$(upower -e 2>/dev/null | grep -m1 BAT); if [ -n "$B" ]; then upower -i "$B" | grep -E "state|percentage|capacity|energy-full|time to|charge-cycles"; else for b in /sys/class/power_supply/BAT*; do echo "Charge: $(cat $b/capacity)%  ($(cat $b/status))"; f=$(cat $b/energy_full 2>/dev/null || cat $b/charge_full); d=$(cat $b/energy_full_design 2>/dev/null || cat $b/charge_full_design); echo "Health: $((f * 100 / d))% of its original capacity"; done; fi` : "" },
  webcams: { t: "Cameras", d: "Webcams the system can see", i: "camera", c: "red", cmd: `found=0; for d in /sys/class/video4linux/video*; do [ -e "$d" ] || continue; found=1; echo "/dev/$(basename $d): $(cat $d/name)"; done; [ $found = 1 ] || echo "No camera found."; echo; u=$(fuser /dev/video* 2>/dev/null); if [ -n "$u" ]; then echo "In use by: $(ps -o comm= -p $(echo $u | tr ' ' ',') | sort -u | tr '\\n' ' ')"; else echo "Not in use by any app right now."; fi` },
  usbList: { t: "USB devices", d: "Everything plugged in by USB", i: "usb", c: "orange", cmd: `lsusb | sed 's/^Bus [0-9]* Device [0-9]*: ID [0-9a-f:]* //' | sort` },
  bootHistory: { t: "Boot history", d: "When the computer was started", i: "history", c: "slate", cmd: `echo "Up since $(uptime -s) ($(uptime -p))"; echo; journalctl --list-boots --no-pager 2>/dev/null | tail -10` },
  whoLogged: { t: "Who's logged in", d: "Current and recent logins", i: "user", c: "blue", cmd: `echo "== Logged in now =="; who; echo; echo "== Recent logins =="; (last -n 10 2>/dev/null || journalctl -u systemd-logind --since "-7 days" --no-pager | grep -i "new session" | tail -10)` },
  sensorsNow: { t: "All temperatures", d: "Every sensor, right now", i: "thermo", c: "red", cmd: `sensors 2>/dev/null || echo "Install lm_sensors (lm-sensors on Ubuntu) to see temperatures."` },
  // network
  wifiPassword: { t: "Wi-Fi password & QR", d: "Share your Wi-Fi with a phone", i: "key", c: "amber", cmd: `nmcli device wifi show-password 2>&1 || echo "Not connected to Wi-Fi."` },
  lanDevices: { t: "Devices on my network", d: "Ones this computer has talked to recently", i: "network", c: "teal", cmd: `echo "Your router: $(ip route | awk '/default/{print $3; exit}')"; echo; ip -4 neigh show | grep -v FAILED | awk '{printf "%-16s %s\\n", $1, $5}' | while read ip mac; do n=$(getent hosts $ip | awk '{print $2}'); echo "$ip  $mac  $n"; done` },
  tracePath: { t: "Route to the internet", d: "Each hop between you and the web", i: "link", c: "cyan", cmd: `if command -v tracepath >/dev/null; then tracepath -n -m 15 1.1.1.1; else echo "tracepath isn't installed. Package: iputils (iputils-tracepath on Ubuntu)."; fi` },
  dnsServers: { t: "DNS servers", d: "Who turns names into addresses", i: "server", c: "indigo", cmd: `(resolvectl dns 2>/dev/null | grep -v ': *$') || grep nameserver /etc/resolv.conf` },
  // handy & fun
  worldClock: { t: "World clock", d: "The time around the world", i: "globe", c: "blue", cmd: `for z in America/Los_Angeles America/New_York Europe/London Europe/Berlin Asia/Kolkata Asia/Tokyo Australia/Sydney; do printf '%-20s %s\n' "\${z#*/}" "$(TZ=$z date '+%a %H:%M')"; done | tr _ ' '` },
  moon: { t: "Moon phase", d: "Tonight's moon", i: "moon", c: "indigo", cmd: `curl -s --max-time 10 'https://wttr.in/Moon?T' | head -24` },
  dice: { t: "Roll dice & flip a coin", d: "For settling arguments", i: "sparkles", c: "pink", cmd: `echo "🎲 $((RANDOM % 6 + 1))   🎲 $((RANDOM % 6 + 1))"; echo "🪙 $( [ $((RANDOM % 2)) = 0 ] && echo Heads || echo Tails)"` },
  osAge: { t: "How old is my install?", d: "When Linux was installed here", i: "clock", c: "amber", cmd: `b=$(stat -c %W / 2>/dev/null); [ "\${b:-0}" -gt 0 ] || b=$(stat -c %W /etc/machine-id 2>/dev/null); if [ "\${b:-0}" -gt 0 ]; then echo "Installed on $(date -d @$b '+%A, %B %-d, %Y'): $(( ($(date +%s) - b) / 86400 )) days ago."; else echo "This file system doesn't record when it was created."; fi` },
};
Object.keys(A).forEach(k => { if (!A[k].cmd && !A[k].launch) delete A[k]; });  // not available on this system
async function runAction(key) {
  const x = A[key]; if (!x) return;
  if (x.confirm && !(await modal({ title: x.t + "?", text: x.confirm, cmd: x.cmd || x.launch, okText: "Continue", icon: x.i, color: x.c, danger: ["reboot", "poweroff", "logout", "emptyTrash"].includes(key) }))) return;
  if (x.launch) { launch(x.launch); logActivity(x.t, x.launch, true); toast("info", "Opening " + x.t.replace(/^Screenshot: /, "screenshot: "), x.launch); return; }
  const tiles = $$(`[data-act="${key}"]`); tiles.forEach(b => { b.classList.remove("done-ok", "done-fail"); b.classList.add("running"); });
  const j = await run(x.cmd, x.t, { confirmed: !!x.confirm, after: j => { if (x.after && loaders[x.after]) loaders[x.after](); } });
  tiles.forEach(b => { b.classList.remove("running"); if (!j.cancelled) { b.classList.add(j.code === 0 ? "done-ok" : "done-fail"); setTimeout(() => b.classList.remove("done-ok", "done-fail"), 2200); } });
}

/* ================= navigation ================= */
const NAV = [
  ["", [["home", "Home", "home", "blue"], ["assistant", "Assistant", "sparkles", "violet"]]],
  ["Settings", [["appearance", "Appearance", "palette", "pink"], ["display", "Display", "monitor", "blue"], ["sound", "Sound", "volume", "red"], ["network", "Network & Bluetooth", "wifi", "cyan"], ["power", "Power & Lock", "power", "green"], ["profiles", "Profiles", "layers", "violet"], ["time", "Date & Time", "clock", "orange"], ["panel", "Panel & Taskbar", "panel", "violet"], ["mouse", "Mouse & Touchpad", "pointer", "teal"]]],
  ["System", [["apps", "Apps & Updates", "package", "violet"], ["procs", "Running Programs", "activity", "green"], ["services", "Services & Startup", "rocket", "indigo"], ["storage", "Storage", "disk", "amber"], ["sensors", "Sensors & Fans", "thermo", "red"], ["vms", "Virtual Machines", "box", "teal"], ["backups", "Backups", "history", "green"], ["logs", "Logs & Problems", "scroll", "slate"]]],
  ["Tools", [["tools", "Toolbox", "wrench", "orange"], ["terminal", "Terminal", "terminal", "slate"]]],
  ["App", [["settings", "Dashboard settings", "cog", "slate"], ["support", "Ticket", "bug", "red"], ["about", "About", "info", "blue"], ["dev", "Developer", "code", "slate"]]],
];
if (feat("gnome") && !feat("kde")) NAV[1][1].find(x => x[0] === "panel")[1] = "Top Bar & Dock";
else if (!feat("panel") && !feat("clock")) NAV[1][1].find(x => x[0] === "panel")[1] = "Shortcuts";
const UNSUPPORTED = new Set(feat("mouse") ? [] : ["mouse"]);  // pages with nothing to change on this desktop
const PAGEINFO = {};
NAV.forEach(([, items]) => items.forEach(([id, t, i, c]) => PAGEINFO[id] = { t, i, c }));
$("#side").innerHTML = `<div class="brand"><img class="logo" src="/web/app-icon.svg" alt=""><div><b>Linux Dashboard</b><small id="whoami">…</small></div><button class="navedit-btn" id="navEditBtn" title="Edit the sidebar">${ic("pencil")}</button></div>
  <button class="searchbtn" id="openPalette">${ic("search")}<span>Search</span><kbd>Ctrl K</kbd></button>` +
  `<div id="navlist"></div>` +
  `<div class="spacer"></div><div class="adminchip hidden" id="adminChip"></div><div class="themeseg" id="themeSeg"><button data-v="light" title="Light">${ic("sun")}</button><button data-v="auto" title="Match system">${ic("auto")}</button><button data-v="dark" title="Dark">${ic("moon")}</button></div><div class="side-resizer" id="sideResizer" title="Drag to resize · double-click to reset"></div>`;
const loaders = {}; const leavers = {};
let CUR = "";
function show(page, anchor) {
  if (!PAGEINFO[page] || (page === "dev" && !SETTINGS.devMode) || (PAGEINFO[page].allowed && !PAGEINFO[page].allowed()) || UNSUPPORTED.has(page)) page = "home";
  if (CUR && CUR !== page) leavers[CUR]?.();
  if (page === "support" && CUR && CUR !== "support") PREVPAGE = CUR;
  CUR = page;
  $$(".page").forEach(s => s.classList.toggle("active", s.id === "page-" + page));
  $$("#side a[data-page]").forEach(a => a.classList.toggle("active", a.dataset.page === page));
  moveNavIndicator();
  if (!anchor && $("#main").scrollTop) $("#main").scrollTo({ top: 0, behavior: "instant" });
  loaders[page]?.();
  renderPageAlerts(page);
  if (SETTINGS.lastPage !== page) { SETTINGS.lastPage = page; saveSettings(); }
  if (anchor) { const el = document.getElementById(anchor); if (el) { el.scrollIntoView({ block: "center" }); el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); } }
}
window.addEventListener("hashchange", () => show(location.hash.slice(1)));

/* ---------- editable, resizable sidebar ---------- */
const LOCKED = new Set(["assistant", "settings", "about"]);  // these stay where they are
const defaultLayout = () => NAV.map(([g, items], i) => ({ id: g || "top", name: g, items: items.map(x => x[0]) }));
function navLayout() {
  // the saved layout, repaired: every page exactly once, new pages added to their usual section, locked pages kept in place
  const def = defaultLayout();
  let saved = Array.isArray(SETTINGS.navLayout) && SETTINGS.navLayout.length ? SETTINGS.navLayout : def;
  if (!saved.some(s => s.id === "App")) saved = saved.map(s => ({ ...s, items: (s.items || []).filter(id => !["settings", "support", "about", "dev"].includes(id)) }));
  const seen = new Set(), out = saved.map(s => ({ id: String(s.id), name: String(s.name ?? ""), items: (s.items || []).filter(id => PAGEINFO[id] && !LOCKED.has(id) && !seen.has(id) && seen.add(id)) }));
  for (const d of def) {
    let sec = out.find(s => s.id === d.id); if (!sec) { sec = { id: d.id, name: d.name, items: [] }; out.push(sec); }
    d.items.forEach((id, i) => { if (LOCKED.has(id)) sec.items.splice(Math.min(i, sec.items.length), 0, id); else if (!seen.has(id)) { seen.add(id); sec.items.push(id); } });
  }
  return out;
}
let EDITING = false;
function renderSide() {
  const box = $("#navlist"); if (!box) return;
  const layout = navLayout(), hidden = new Set(SETTINGS.hiddenPages || []);
  if (!SETTINGS.devMode) layout.forEach(s => s.items = s.items.filter(id => id !== "dev"));
  layout.forEach(s => s.items = s.items.filter(id => !UNSUPPORTED.has(id) && !(PAGEINFO[id].allowed && !PAGEINFO[id].allowed())));
  document.body.classList.toggle("navediting", EDITING);
  $("#navEditBtn")?.classList.toggle("on", EDITING);
  if (!EDITING) {
    box.innerHTML = `<div class="navind" id="navind"></div>` + layout.map(sec => {
      const items = sec.items.filter(id => !hidden.has(id) || LOCKED.has(id)); if (!items.length) return "";
      return (sec.name ? `<div class="navgroup">${esc(sec.name)}</div>` : "") + items.map(id => { const p = PAGEINFO[id];
        return `<a href="#${id}" data-page="${id}" title="${esc(p.t)}" class="${id === CUR ? "active" : ""}">${tile(p.i, p.c)}<span>${esc(p.t)}</span></a>`; }).join("");
    }).join("");
    if (typeof renderUpdateBadge === "function") renderUpdateBadge();
    moveNavIndicator(true);
    return;
  }
  box.innerHTML = `<div class="navedit-help">${ic("info")}Drag ${ic("grip")} to move pages and whole sections. Type to rename a section. ${ic("lock")} pages stay put.</div>
    <div class="navsecs">${layout.map(sec => `<div class="navsec" data-sec="${esc(sec.id)}">
      <div class="navsec-h"><span class="grip" data-drag="sec" title="Drag to move this section">${ic("grip")}</span><input class="navsec-name" data-secname="${esc(sec.id)}" value="${esc(sec.name)}" placeholder="${sec.id === "top" ? "Top (no title)" : "Section name"}">${sec.items.length ? "" : `<button class="btn sm ghost icon" data-secdel="${esc(sec.id)}" title="Delete this empty section">${ic("trash")}</button>`}</div>
      <div class="navsec-items">${sec.items.map(id => { const p = PAGEINFO[id], lk = LOCKED.has(id), off = hidden.has(id) && !lk;
        return `<div class="navitem ${lk ? "locked" : ""} ${off ? "off" : ""}" data-item="${id}">${lk ? `<span class="grip" title="Stays in place">${ic("lock")}</span>` : `<span class="grip" data-drag="item" title="Drag to move">${ic("grip")}</span>`}${tile(p.i, p.c)}<span class="nm">${esc(p.t)}</span>${lk ? "" : `<button class="btn sm ghost icon" data-navhide="${id}" title="${off ? "Show" : "Hide"} in the sidebar">${ic(off ? "hide" : "eye")}</button>`}</div>`; }).join("")}</div>
    </div>`).join("")}</div>
    <div class="navedit-foot"><button class="btn sm" id="navAddSec">${ic("plus")}Section</button><button class="btn sm ghost" id="navReset">${ic("restart")}Reset</button><button class="btn sm primary" id="navDone">${ic("check")}Done</button></div>`;
}
// the highlight behind the current page glides from item to item
function moveNavIndicator(instant) {
  const ind = $("#navind"), a = $(`#navlist a[data-page="${CUR}"]`); if (!ind) return;
  if (!a) { ind.style.opacity = 0; return; }
  if (instant) ind.style.transition = "none";
  ind.style.opacity = 1; ind.style.transform = `translateY(${a.offsetTop}px)`; ind.style.height = a.offsetHeight + "px";
  if (instant) { void ind.offsetWidth; ind.style.transition = ""; }
}
function layoutFromDom() {
  return $$("#navlist .navsec").map(sec => ({ id: sec.dataset.sec, name: $(".navsec-name", sec).value.trim(), items: $$(".navitem", sec).map(i => i.dataset.item) }));
}
function saveLayout(layout = layoutFromDom()) { SETTINGS.navLayout = layout; saveSettings(); }
// Drag to reorder: a floating copy follows the pointer, a dashed gap shows where it will land,
// and the other entries slide out of the way. Positions come from layout (not animations), so it doesn't jitter.
$("#side").addEventListener("pointerdown", e => {
  const g = e.target.closest("[data-drag]"); if (!g || !EDITING || e.button !== 0) return;
  e.preventDefault();
  const side = $("#side"), kind = g.dataset.drag, el = g.closest(kind === "sec" ? ".navsec" : ".navitem");
  const r0 = el.getBoundingClientRect(), dx = e.clientX - r0.left, dy = e.clientY - r0.top;
  const ghost = el.cloneNode(true);
  ghost.classList.add("drag-ghost");
  Object.assign(ghost.style, { width: r0.width + "px", left: r0.left + "px", top: r0.top + "px" });
  document.body.append(ghost);
  el.classList.add("drag-slot");
  document.body.classList.add("sorting");
  const sideTop = () => side.getBoundingClientRect().top - side.scrollTop;
  // layout position (ignores the slide animations). While something animates the browser may measure from the
  // animating section instead of the sidebar, so add up the offsets all the way to the sidebar.
  const top = x => { let t = 0; for (let n = x; n && n !== side; n = n.offsetParent) t += n.offsetTop; return sideTop() + t; };
  const mid = x => top(x) + x.offsetHeight / 2, bottom = x => top(x) + x.offsetHeight;
  const slide = (els, change) => {  // FLIP: remember where things were, change, then animate them from there
    const before = new Map(els.map(x => [x, x.getBoundingClientRect().top]));
    change();
    for (const x of els) { const d = before.get(x) - x.getBoundingClientRect().top; if (Math.abs(d) > 1) x.animate([{ transform: `translateY(${d}px)` }, { transform: "none" }], { duration: 170, easing: "cubic-bezier(.2,.8,.2,1)" }); }
  };
  let x = e.clientX, y = e.clientY, raf = 0, scrollTimer = 0;
  const place = () => {
    raf = 0;
    ghost.style.left = x - dx + "px"; ghost.style.top = y - dy + "px";
    if (kind === "item") {
      const secs = $$("#navlist .navsec");
      // the section under the pointer, or the nearest one
      const sec = secs.find(s => y >= top(s) - 4 && y <= bottom(s) + 4) || secs.reduce((a, b) => Math.abs(mid(a) - y) < Math.abs(mid(b) - y) ? a : b);
      const list = $(".navsec-items", sec);
      const before = $$(".navitem", list).filter(i => i !== el).find(i => y < mid(i)) || null;
      if (el.parentElement === list && (el.nextElementSibling === before || (!before && !el.nextElementSibling))) return;
      slide($$("#navlist .navitem, #navlist .navsec").filter(i => i !== el), () => list.insertBefore(el, before));
    } else {
      const secs = $$("#navlist .navsec").filter(s => s !== el);
      const before = secs.find(s => y < mid(s)) || null;
      if (el.nextElementSibling === before || (!before && !el.nextElementSibling)) return;
      slide(secs, () => $("#navlist .navsecs").insertBefore(el, before));
    }
  };
  const autoScroll = () => {  // near the top or bottom edge, scroll the sidebar
    const r = side.getBoundingClientRect(), edge = 44;
    const v = y < r.top + edge ? -Math.ceil((r.top + edge - y) / 4) : y > r.bottom - edge ? Math.ceil((y - r.bottom + edge) / 4) : 0;
    if (v) { side.scrollTop += v; if (!raf) raf = requestAnimationFrame(place); }
    scrollTimer = requestAnimationFrame(autoScroll);
  };
  scrollTimer = requestAnimationFrame(autoScroll);
  const move = ev => { x = ev.clientX; y = ev.clientY; if (!raf) raf = requestAnimationFrame(place); };
  const up = () => {
    window.removeEventListener("pointermove", move); cancelAnimationFrame(raf); cancelAnimationFrame(scrollTimer);
    const r = el.getBoundingClientRect();
    const done = () => { ghost.remove(); el.classList.remove("drag-slot"); document.body.classList.remove("sorting"); saveLayout(); renderSide(); };
    const a = ghost.animate([{ left: ghost.style.left, top: ghost.style.top, transform: "scale(1.03) rotate(.6deg)" }, { left: r.left + "px", top: r.top + "px", transform: "none" }], { duration: 150, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" });
    a.onfinish = done; setTimeout(() => { if (ghost.isConnected) done(); }, 400);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up, { once: true });
  window.addEventListener("pointercancel", up, { once: true });
});
$("#side").addEventListener("input", e => { if (e.target.dataset.secname !== undefined) saveLayout(); });
// width: drag the right edge; narrow enough and it switches to icons only
function setSideWidth(w, save) {
  w = Math.round(Math.max(64, Math.min(420, w)));
  document.documentElement.style.setProperty("--side-w", (EDITING ? Math.max(w, 300) : w) + "px");
  document.body.classList.toggle("sidecompact", w < 150 && !EDITING);
  if (save) { SETTINGS.sideWidth = w; SETTINGS.sideCompact = w < 150; saveSettings(); const t = $('[data-pref="sideCompact"]'); if (t) t.checked = w < 150; }
}
$("#sideResizer").addEventListener("pointerdown", e => {
  e.preventDefault(); document.body.classList.add("resizing");
  let w = SETTINGS.sideWidth || 248;
  const move = ev => { w = ev.clientX; setSideWidth(w, false); };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", () => { window.removeEventListener("pointermove", move); document.body.classList.remove("resizing"); setSideWidth(w, true); }, { once: true });
});
$("#sideResizer").addEventListener("dblclick", () => setSideWidth(248, true));
renderSide();  // default layout until your saved one loads
window.addEventListener("resize", debounce(() => moveNavIndicator(true), 100));

/* theme of this app */
let theme = (() => { try { return localStorage.getItem("theme") || "auto"; } catch { return "auto"; } })();
function fadeTheme() { if (SETTINGS.reduceMotion) return; const r = document.documentElement; r.classList.add("theme-fade"); clearTimeout(fadeTheme.t); fadeTheme.t = setTimeout(() => r.classList.remove("theme-fade"), 450); }
function applyTheme() { fadeTheme(); if (theme === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme; $$("#themeSeg button").forEach(b => b.classList.toggle("on", b.dataset.v === theme)); }
$("#themeSeg").onclick = e => { const b = e.target.closest("button"); if (!b) return; theme = b.dataset.v; try { localStorage.setItem("theme", theme); } catch {} applyTheme(); if (typeof applySettings === "function") applySettings(); };
applyTheme();

/* ================= pages ================= */
function pageHead(id, sub, right = "") { const p = PAGEINFO[id]; return `<div class="phead">${tile(p.i, p.c)}<div><h1>${p.t}</h1><p>${sub}</p></div>${right ? `<div class="right">${right}</div>` : ""}</div>`; }
const PAGES = {};

/* ---------- HOME ---------- */
const QS = [["wifi", "Wi-Fi", "wifi"], ["bluetooth", "Bluetooth", "bluetooth"], ["airplane", "Airplane mode", "plane"], ["dark", "Dark mode", "moon"],
  ["nightlight", "Night light", "sunset"], ["dnd", "Do not disturb", "belloff"], ["awake", "Keep awake", "coffee"], ["performance", "Performance", "zap"]].filter(([id]) => hasCtl(id));
PAGES.home = () => {
  QS.forEach(([id, t, i]) => reg({ title: t, desc: "Quick setting", icon: i, color: "blue", ctl: id, anchor: "qs-" + id }));
  return `<div class="hero"><div><h1 id="greeting">Hello</h1><p id="sysline">Loading…</p></div><div class="clock"><b id="clock">--:--</b><small id="date"></small></div></div>
  <div class="qs">${QS.map(([id, t, i]) => `<button class="qt" id="qs-${id}" data-ctl="${id}">${`<span class="ci">${ic(i)}</span>`}<div><b>${t}${ADMIN.has(id) ? `<span class="qlock" title="Asks for your password">${ic("lock")}</span>` : ""}</b><small>…</small></div></button>`).join("")}</div>
  <div class="card tipcard" id="home-tip"></div>
  <div class="homegrid">
    <div class="card pad sliders" id="home-sliders">
      <div class="slider"><span class="lbl"><button class="btn ghost icon" data-mute-ctl="mute" data-on-icon="volume" data-off-icon="mute" data-toggle-ctl="mute"></button>Volume</span><input type="range" min="0" max="150" data-ctl="volume"><span class="val" data-val="volume">–</span></div>
      <div class="slider"><span class="lbl"><button class="btn ghost icon" data-mute-ctl="micmute" data-on-icon="mic" data-off-icon="micoff" data-toggle-ctl="micmute"></button>Mic</span><input type="range" min="0" max="150" data-ctl="mic"><span class="val" data-val="mic">–</span></div>
      <div class="slider"><span class="lbl"><span class="btn ghost icon">${ic("brightness")}</span>Brightness</span><input type="range" min="1" max="100" data-ctl="brightness"><span class="val" data-val="brightness">–</span></div>
    </div>
    <div class="group suggest" id="suggest"><div class="row"><div class="txt"><small>Checking your system…</small></div></div></div>
  </div>
  <div id="home-live">${sec("Live")}
  <div class="monitors">
    ${["cpu|CPU|cpu|blue", "mem|Memory|memory|violet", "net|Network|network|teal", "temp|Temperature|thermo|orange"].map(s => { const [k, t, i, c] = s.split("|"); return `<div class="card mon" style="--mc:var(--c-${c})" id="mon-${k}"><div class="top">${ic(i)}${t}</div><div class="big">–</div><div class="sub">&nbsp;</div><svg class="spark" viewBox="0 0 100 46" preserveAspectRatio="none"></svg><span class="tip-pop" hidden></span></div>`; }).join("")}
    <div class="card mon" style="--mc:var(--c-green)" id="mon-disk"><div class="top">${ic("disk")}Disk</div><div class="big">–</div><div class="sub">&nbsp;</div><div class="meter" style="margin-top:20px"><i></i></div></div>
    <div class="card mon" style="--mc:var(--c-cyan)" id="mon-sys"><div class="top">${ic("clock")}Uptime</div><div class="big">–</div><div class="sub">&nbsp;</div><div class="sub" id="mon-fan" style="margin-top:14px"></div></div>
  </div></div>
  <div id="home-actions">${sec("Quick actions")}
  ${acts(["updateAll", "checkUpdates", "cleanup", "speedTest", "restartAudio", "errorsNow", "shotRegion", "colorPick"])}</div>
  <div id="home-power">${sec("Power")}
  ${acts(["lock", "suspend", "logout", "reboot", "poweroff"])}</div>`;
};

// count smoothly from the old number to the new one (keeps the unit, e.g. "42%" -> "57%")
function tweenText(el, text) {
  const m = String(text).match(/^(-?\d+(?:\.\d+)?)(.*)$/), cur = el.textContent.match(/^(-?\d+(?:\.\d+)?)(.*)$/);
  if (SETTINGS.reduceMotion || !m || !cur || cur[2] !== m[2] || cur[1] === m[1]) { el.textContent = text; return; }
  const from = +cur[1], to = +m[1], dec = (m[1].split(".")[1] || "").length, t0 = performance.now();
  cancelAnimationFrame(el._tw);
  const step = t => { const p = Math.min(1, (t - t0) / 450), e = 1 - (1 - p) ** 3; el.textContent = (from + (to - from) * e).toFixed(dec) + m[2]; if (p < 1) el._tw = requestAnimationFrame(step); };
  el._tw = requestAnimationFrame(step);
}
class Spark {
  constructor(card, { max = null, fmt = v => v } = {}) {
    this.card = card; this.svg = $(".spark", card); this.pop = $(".tip-pop", card); this.data = []; this.max = max; this.fmt = fmt; this.hover = -1;
    this.svg.addEventListener("mousemove", e => { const r = this.svg.getBoundingClientRect(); this.hover = Math.round((e.clientX - r.left) / r.width * (this.N - 1)); this.draw(); });
    this.svg.addEventListener("mouseleave", () => { this.hover = -1; this.draw(); });
  }
  N = Spark.len || 60;
  push(v) { this.data.push(v); if (this.data.length > this.N) this.data.shift(); this.draw(); }
  draw() {
    const d = this.data, N = this.N, off = N - d.length;
    const mx = this.max ?? Math.max(1, ...d) * 1.15;
    const x = i => (i + off) / (N - 1) * 100, y = v => 44 - Math.min(1, v / mx) * 40;
    if (!d.length) return;
    const pts = d.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`);
    let h = `<path class="area" d="M${x(0)},46 L${pts.join(" L")} L100,46Z"/><path class="line" vector-effect="non-scaling-stroke" d="M${pts.join(" L")}"/>`;
    const hi = this.hover - off;
    if (hi >= 0 && hi < d.length) {
      h += `<line class="cross" vector-effect="non-scaling-stroke" x1="${x(hi)}" x2="${x(hi)}" y1="0" y2="46"/>`;
      this.pop.hidden = false; this.pop.textContent = `${this.fmt(d[hi])} · ${(d.length - 1 - hi) * 2}s ago`;
    } else this.pop.hidden = true;
    this.svg.innerHTML = h;
  }
}
let sparks = null, statTimer = null, lastStats = null;
async function loadStats() {
  const s = await api("/api/stats"); lastStats = s;
  ME = s.user; $("#whoami").textContent = s.user + "@" + s.hostname;
  const h = new Date().getHours();
  $("#greeting").textContent = (h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening") + ", " + (SETTINGS.name || s.user);
  $("#sysline").textContent = `${s.os} · ${s.hostname} · up ${dur(s.uptime)}`;
  if (!sparks) Spark.len = Math.max(20, Math.round(+SETTINGS.graphLen / (SETTINGS.refresh || 2)));
  if (!sparks) sparks = {
    cpu: new Spark($("#mon-cpu"), { max: 100, fmt: v => v.toFixed(0) + "%" }), mem: new Spark($("#mon-mem"), { max: 100, fmt: v => v.toFixed(0) + "%" }),
    net: new Spark($("#mon-net"), { fmt: rate }), temp: new Spark($("#mon-temp"), { max: 100, fmt: v => fmtTemp(v) }),
    _len: SETTINGS.graphLen,
  };
  const memP = s.mem_used / s.mem_total * 100, diskP = s.disk_used / s.disk_total * 100;
  const set = (k, big, sub) => { tweenText($(`#mon-${k} .big`), big); $(`#mon-${k} .sub`).textContent = sub; };
  set("cpu", s.cpu.toFixed(0) + "%", `${s.cores} threads · load ${s.load[0]}`); sparks.cpu.push(s.cpu);
  set("mem", memP.toFixed(0) + "%", `${bytes(s.mem_used)} of ${bytes(s.mem_total)}`); sparks.mem.push(memP);
  set("net", rate(s.net_down), `↓ download · ↑ ${rate(s.net_up)} · ${s.ips[0]?.ip || "offline"}`); sparks.net.push(s.net_down);
  set("temp", s.temp ? fmtTemp(s.temp) : "–", s.temp ? `CPU ${s.temp > 85 ? "· hot!" : s.temp > 72 ? "· warm" : "· normal"}${s.gpu_temp ? ` · GPU ${fmtTemp(s.gpu_temp)}` : ""}` : "no sensor"); if (s.temp) sparks.temp.push(s.temp);
  set("disk", bytes(s.disk_total - s.disk_used) + " free", `${bytes(s.disk_used)} used of ${bytes(s.disk_total)}`);
  const m = $("#mon-disk .meter"); m.className = "meter" + (diskP > 90 ? " bad" : diskP > 80 ? " warn" : ""); $("i", m).style.width = diskP + "%";
  set("sys", dur(s.uptime), "since last restart");
  $("#mon-fan").innerHTML = s.fan ? `${ic("fan")} Fans at ${s.fan} rpm` : "";
  $("#mon-fan svg")?.setAttribute("style", "width:14px;height:14px;vertical-align:-2px");
}
function tickClock() {
  const d = new Date();
  $("#clock").textContent = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: !SETTINGS.clock24 });
  $("#date").textContent = d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  const tc = $("#bigclock"); if (tc) { tc.textContent = d.toLocaleTimeString([], { hour12: !SETTINGS.clock24 }); $("#bigdate").textContent = d.toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" }); }
}
/* ---------- alerts: one list, shown on Home, as sidebar badges, and at the top of the page they belong to ---------- */
let ALERTS = [], alertsAt = 0;
function computeAlerts() {
  const di = DISK || {}, a = [];
  const add = (id, page, level, icon, color, title, desc, btn) => {
    const until = (SETTINGS.dismissedAlerts || {})[id];
    if (!until || until < Date.now()) a.push({ id, page, level, icon, color, title, desc, btn });
  };
  const pct = lastStats ? lastStats.disk_used / lastStats.disk_total * 100 : 0;
  if (pct > 85) add("diskfull", "storage", "bad", "alert", "red", "Disk almost full", `${pct.toFixed(0)}% used`, `<button class="btn sm primary" data-act="bigFolders">See what's big</button>`);
  if (di.failed) add("failed", "services", "bad", "xcircle", "red", `${di.failed} service${di.failed > 1 ? "s" : ""} failed`, "Something didn't start properly", `<button class="btn sm primary" data-act="failedSvc">Show which</button>`);
  if (UPDATES?.total > 0 && SETTINGS.updateCheck !== "never") add("updates", "apps", "info", "download", "green", `${UPDATES.total} update${UPDATES.total > 1 ? "s" : ""} waiting`, `Checked at ${UPDATES.checked}`, `<button class="btn sm primary" data-act="updateAll">Update everything</button>`);
  if (lastStats?.temp > 90) add("hot", "sensors", "bad", "flame", "red", `CPU is very hot (${fmtTemp(lastStats.temp)})`, "Close heavy programs or turn the fans up", `<button class="btn sm primary" data-nav="sensors">Fan control</button>`);
  if (PROFILE.wifi_hw?.length && !PROFILE.wifi) add("wifibroken", "network", "warn", "wifioff", "orange", "Your Wi-Fi card isn't working yet",
    `${esc(PROFILE.wifi_hw[0].replace(/^.*?(BCM\w+|AX\d+|RTL\w+|MT\w+).*$/, "$1"))} is installed, but Linux can't use it.${PROFILE.t2 ? " On T2 Macs it usually needs firmware copied from macOS." : ""}`,
    `<button class="btn sm primary" data-askq="My ${esc(PROFILE.wifi_hw[0].replace(/ \(rev.*\)/, ""))} Wi-Fi card is installed but there's no Wi-Fi in Linux${PROFILE.t2 ? " on my T2 Mac (" + esc(PROFILE.model) + ")" : ""}. How do I get it working?">${ic("sparkles")}Help me fix it</button>`);
  if (CTL.ntp === false) add("ntp", "time", "warn", "clock", "orange", "Clock isn't syncing", "Time can drift without internet sync", `<button class="btn sm primary" data-set="ntp" data-v="true">Turn on</button>`);
  if (CTL["svc_fstrim.timer"] === false) add("trim", "storage", "info", "sparkles", "green", "Weekly SSD maintenance is off", "TRIM keeps SSDs fast over time", `<button class="btn sm primary" data-set="svc_fstrim.timer" data-v="true">Turn on</button>`);
  if (di.orphans) add("orphans", "apps", "info", "package", "violet", `${di.orphans} unused package${di.orphans > 1 ? "s" : ""}`, "Leftovers nothing needs anymore", `<button class="btn sm" data-act="cleanup">Clean up</button>`);
  if (di.pkgcache > 2e9) add("pkgcache", "storage", "info", "download", "violet", `Old downloads use ${bytes(di.pkgcache)}`, "Cached package installers", `<button class="btn sm" data-act="pkgCache">Clean</button>`);
  if (di.cache > 1e9) add("cache", "storage", "info", "broom", "pink", `App cache is ${bytes(di.cache)}`, "Safe to clear", `<button class="btn sm" data-act="clearCache">Clear</button>`);
  if (di.trash > 5e8) add("trash", "storage", "info", "trash", "red", `Trash holds ${bytes(di.trash)}`, "Emptying it frees the space", `<button class="btn sm" data-act="emptyTrash">Empty</button>`);
  if (lastStats && lastStats.swap_total === 0 && CTL.zram === false) add("noswap", "storage", "info", "memory", "violet", "No safety net when memory fills up", "Compressed memory (zram) helps if RAM ever runs out", `<button class="btn sm" data-set="zram" data-v="true">Turn on</button>`);
  const order = { bad: 0, warn: 1, info: 2 };
  return a.sort((x, y) => order[x.level] - order[y.level]);
}
async function refreshAlerts(force) {
  if (force || Date.now() - alertsAt > 60e3 || !DISK) { DISK = await api("/api/diskinfo").catch(() => DISK); alertsAt = Date.now(); }
  if (!lastStats) lastStats = await api("/api/stats").catch(() => null);
  ALERTS = computeAlerts();
  renderNavBadges(); renderPageAlerts(CUR); renderSuggestions();
}
const alertRow = (x, dismiss) => `<div class="row alert-${x.level}">${tile(x.icon, x.color, "soft")}<div class="txt"><b>${x.title}</b>${x.desc ? `<small>${x.desc}</small>` : ""}</div><div class="ctl">${x.btn}${dismiss ? `<button class="btn sm ghost icon" data-dismiss="${x.id}" title="Hide for a day">${ic("x")}</button>` : ""}</div></div>`;
function renderSuggestions() {
  const box = $("#suggest"); if (!box) return;
  box.innerHTML = `<div class="row" style="min-height:44px"><div class="txt"><b>Suggestions</b></div>${ALERTS.length > 5 ? `<div class="ctl"><small style="color:var(--muted)">${ALERTS.length} in total</small></div>` : ""}</div>` + (ALERTS.length
    ? ALERTS.slice(0, 5).map(x => alertRow(x, true)).join("")
    : `<div class="row">${tile("checkcircle", "green", "soft")}<div class="txt"><b>Everything looks good</b><small>No problems found</small></div></div>`);
}
function renderPageAlerts(page) {  // banner at the top of the page the alerts belong to
  const pg = $("#page-" + page); if (!pg || page === "home") return;
  let box = $(".page-alerts", pg);
  if (!box) { box = document.createElement("div"); box.className = "page-alerts"; const head = $(".phead", pg); head ? head.after(box) : pg.prepend(box); }
  const mine = ALERTS.filter(x => x.page === page);
  box.innerHTML = mine.length ? `<div class="group">${mine.map(x => alertRow(x, true)).join("")}</div>` : "";
}
function renderNavBadges() {
  const by = {};
  for (const x of ALERTS) (by[x.page] ||= []).push(x);
  if (TK_UNREAD > 0) {
    (by.support ||= []).push({ level: "info", title: "New replies to your tickets" });
  }
  const seen = new Set();
  for (const [page, list] of Object.entries(by)) {
    const a = $(`#navlist a[data-page="${page}"]`); if (!a) continue;
    const worst = list.some(x => x.level === "bad") ? "bad" : list.some(x => x.level === "warn") ? "warn" : "info";
    const n = page === "apps" && UPDATES?.total > 0 ? UPDATES.total : page === "support" && TK_UNREAD > 0 ? TK_UNREAD : list.length;
    if (!n) continue;
    seen.add(page);
    const title = esc(list.map(x => x.title).join(" · "));
    let badge = a.querySelector(".navbadge");
    if (badge) {
      if (badge.textContent !== String(n)) badge.textContent = n;
      badge.className = `navbadge ${worst}`;
      badge.title = title;
    } else {
      a.insertAdjacentHTML("beforeend", `<span class="navbadge ${worst}" title="${title}">${n}</span>`);
    }
  }
  $$("#navlist a[data-page]").forEach(a => {
    if (!seen.has(a.dataset.page)) {
      a.querySelector(".navbadge")?.remove();
    }
  });
}
const loadSuggestions = () => refreshAlerts(true);
let DISK = null;
loaders.home = () => { loadStats(); loadSuggestions(); clearInterval(statTimer); statTimer = setInterval(() => { if (!document.hidden) loadStats(); }, (SETTINGS.refresh || 2) * 1000); };
leavers.home = () => clearInterval(statTimer);

/* ---------- APPEARANCE ---------- */
const ACCENTS = PLAT.accents?.length ? PLAT.accents : ["#3daee9", "#2563eb", "#7c3aed", "#db2777", "#e11d48", "#ea580c", "#d97706", "#16a34a", "#0d9488", "#475569"];
PAGES.appearance = () => {
  if (hasCtl("dark")) reg({ title: "Light or dark mode", desc: "Switch the whole desktop theme", icon: "moon", color: "indigo", ctl: "dark", anchor: "ap-mode" });
  if (hasCtl("accent")) reg({ title: "Accent color", desc: "Highlight color for buttons and selections", icon: "droplet", color: "pink", anchor: "ap-accent" });
  if (hasCtl("wallpaper")) reg({ title: "Wallpaper", desc: "Change the desktop background", icon: "image", color: "teal", anchor: "ap-walls", kw: "background" });
  const motion = group(sld("animspeed", "sparkles", "amber", "Animation speed", "Slide left for snappier windows, right for smoother", { min: 0, max: 2, step: .25 }),
      tog("animations", "sparkles", "amber", "Animations", "Smooth motion when windows open, close and move"),
      tog("singleclick", "click", "teal", "Open files with one click", "Instead of double-clicking in Dolphin and on the desktop"));
  return pageHead("appearance", "Make the desktop look the way you like.") +
    (!hasCtl("dark") && !hasCtl("accent") && !hasCtl("wallpaper") && !motion ? note(`${esc(PLAT.desktopName || "This desktop")} keeps its look in its own settings app. The dashboard can change it on KDE Plasma and GNOME.`) : "") +
    group(!hasCtl("dark") ? "" : `<div class="row" id="ap-mode">${tile("moon", "indigo")}<div class="txt"><b>Style</b><small>Changes colors of every app and the panel</small></div><div class="ctl modepick">
      <button class="modecard" data-set="dark" data-v="false" data-on-ctl="dark" data-v2="false"><div class="prev" style="background:#eff0f1"><i style="width:30%;background:#fff;border-right:1px solid #ddd"></i><i style="flex:1;padding:8px"><i style="height:8px;width:60%;background:#3daee9;border-radius:3px"></i></i></div>Light</button>
      <button class="modecard" data-set="dark" data-v="true" data-on-ctl="dark"><div class="prev" style="background:#1b1e20"><i style="width:30%;background:#232629;border-right:1px solid #333"></i><i style="flex:1;padding:8px"><i style="height:8px;width:60%;background:#3daee9;border-radius:3px"></i></i></div>Dark</button></div></div>`,
      !hasCtl("accent") ? "" : `<div class="row" id="ap-accent">${tile("droplet", "pink")}<div class="txt"><b>Accent color</b><small>Buttons, selections and highlights</small></div><div class="ctl swatches">${ACCENTS.map(c => `<button class="swatch" style="--sc:${c}" data-accent="${c}" title="${c}">${ic("check")}</button>`).join("")}</div></div>`,
      sel("colorscheme", "palette", "violet", "Color scheme", "Fine-grained color palette", []),
      sel("lookandfeel", "layers", "blue", "Global theme", "Colors, icons, cursor and panel style together", [], { kw: "look and feel" })) +
    (!hasCtl("wallpaper") ? "" : sec("Wallpaper", `<button class="btn sm" id="pickWall">${ic("folder")}Choose image…</button>`) +
    `<div class="group" id="ap-walls"><div class="walls" id="walls">${empty("image", "Loading wallpapers…")}</div></div>`) +
    secIf("Motion & behavior", motion) +
    secIf("Desktop effects",
    group(tog("fx_wobblywindows", "wand", "violet", "Wobbly windows", "Windows jiggle like jelly when you drag them"),
      tog("fx_magiclamp", "sparkles", "pink", "Magic lamp minimize", "Windows get sucked into the panel like a genie"),
      tog("fx_blur", "droplet", "blue", "Blur behind panels", "Frosted-glass look on transparent surfaces"),
      tog("fx_translucency", "layers", "cyan", "Translucent while moving", "See through windows as you drag them"),
      tog("fx_diminactive", "eye", "slate", "Dim inactive windows", "Makes the window you're using stand out"),
      tog("fx_shakecursor", "pointer", "orange", "Shake cursor to find it", "Wiggle the mouse and the pointer grows")));
};
let APPEAR = null;
loaders.appearance = async () => {
  if (!APPEAR) {
    APPEAR = await api("/api/appearance");
    const cs = $('select[data-ctl="colorscheme"]'), lf = $('select[data-ctl="lookandfeel"]'), wl = $("#walls");
    if (cs) cs.innerHTML = APPEAR.schemes.map(s => `<option value="${esc(s)}">${esc(s.replace(/([a-z])([A-Z])/g, "$1 $2"))}</option>`).join("");
    const nice = s => s.replace(/^org\.kde\./, "").replace(/\.desktop$/, "").replace(/^breeze(dark|twilight)?$/, m => ({ breeze: "Breeze", breezedark: "Breeze Dark", breezetwilight: "Breeze Twilight" }[m])).replace(/^./, c => c.toUpperCase());
    if (lf) lf.innerHTML = APPEAR.lookandfeel.map(s => `<option value="${esc(s)}">${esc(nice(s))}</option>`).join("");
    if (wl) wl.innerHTML = APPEAR.wallpapers.map(w => `<button class="wall" data-wall="${esc(w.path)}" title="${esc(w.name)}"><img loading="lazy" src="/api/thumb?t=${TOKEN}&path=${encodeURIComponent(w.thumb)}" alt=""><span>${esc(w.name)}${w.mine ? " · yours" : ""}</span></button>`).join("") || empty("image", "No wallpapers found");
    syncControls();
  }
  $$(".swatch").forEach(s => s.classList.toggle("on", (CTL.accent || "").toLowerCase() === s.dataset.accent || hexFromRgb(CTL.accent) === s.dataset.accent));
};
const hexFromRgb = s => { const m = String(s || "").match(/^(\d+),(\d+),(\d+)/); return m ? "#" + m.slice(1).map(x => (+x).toString(16).padStart(2, "0")).join("") : ""; };

/* ---------- DISPLAY ---------- */
PAGES.display = () => pageHead("display", "Brightness, night light, size and resolution.") +
  group(sld("brightness", "brightness", "amber", "Brightness", "How bright the screen is", { min: 1, max: 100 }),
    tog("nightlight", "sunset", "orange", "Night light", "Warmer colors that are easier on the eyes at night", { kw: "blue light filter" }),
    sld("nighttemp", "flame", "red", "Night light warmth", "Left is warmer. Drag to preview; turns night light on", { min: 1000, max: 6500, step: 100, cls: "warm", commit: true, preview: "nightpreview", kw: "kelvin temperature" })) +
  `<div id="displays">${empty("monitor", "Looking for displays…")}</div>` +
  (feat("displaysEdit") ? note(`Size and resolution changes ask you to confirm. If you don't press <b>Keep</b> within 15 seconds they undo themselves, so you can't get stuck with an unreadable screen.`)
    : note(`To change the size of everything, the resolution or rotation, use ${esc(PLAT.desktopName || "your desktop")}'s display settings.${PLAT.settingsPages?.display || PLAT.settingsApp ? ` <button class="btn sm" data-launch="${esc(PLAT.settingsPages?.display || PLAT.settingsApp)}">${ic("external")}Open display settings</button>` : ""}`));
const ROT = [["none", "Normal"], ["left", "Left"], ["right", "Right"], ["inverted", "Upside down"]];
const ROTVAL = { 1: "none", 2: "left", 4: "inverted", 8: "right" };
let DISPLAYS = [];
loaders.display = async () => {
  DISPLAYS = await api("/api/displays");
  if (DISPLAYS.some(d => d.readonly)) {  // this desktop doesn't let other apps change screens: just show them
    $("#displays").innerHTML = sec("Screens") + group(...DISPLAYS.map(d => `<div class="row">${tile("monitor", "blue")}<div class="txt"><b>${esc(d.name)}</b><small>${d.enabled ? "On" : "Off"}</small></div><div class="ctl"><span class="chip plain">${esc(d.modes[0]?.label || "")}</span></div></div>`)) || "";
    return;
  }
  $("#displays").innerHTML = DISPLAYS.map((d, n) => sec(`${ic("monitor")} ${esc(d.name)}${d.size?.width ? ` · ${Math.round(Math.hypot(d.size.width, d.size.height) / 25.4)}″` : ""}`) + group(
    `<div class="row">${tile("scale", "blue")}<div class="txt"><b>Size of everything</b><small>Text, windows and icons (scale)</small></div><div class="ctl">${segHtml("scale-" + n, [1, 1.25, 1.5, 1.75, 2, 2.5].map(v => [String(v), Math.round(v * 100) + "%"]), String(d.scale))}</div></div>`,
    `<div class="row">${tile("monitor", "indigo")}<div class="txt"><b>Resolution</b><small>Highest is sharpest</small></div><div class="ctl"><select id="mode-${n}">${d.modes.map(m => `<option value="${m.id}" ${m.id === d.mode ? "selected" : ""}>${m.label}</option>`).join("")}</select></div></div>`,
    `<div class="row">${tile("rotate", "violet")}<div class="txt"><b>Rotation</b><small>For monitors turned sideways</small></div><div class="ctl">${segHtml("rot-" + n, ROT, ROTVAL[d.rotation] || "none")}</div></div>`)).join("") || empty("monitor", "No displays found");
  DISPLAYS.forEach((d, n) => {
    seg("scale-" + n, v => displayChange(d, "scale", v, String(d.scale)));
    seg("rot-" + n, v => displayChange(d, "rotation", v, ROTVAL[d.rotation] || "none"));
    $("#mode-" + n).onchange = e => displayChange(d, "mode", e.target.value, d.mode);
  });
};
async function displayChange(d, what, value, old) {
  const id = `display:${d.name}:${what}`;
  const r = await setCtl(id, value, { quiet: true, label: `${d.name} ${what}` });
  if (!r.ok) return loaders.display();
  let left = 15; const timer = setInterval(() => { left--; $("#mText").textContent = `Reverting in ${left} seconds…`; if (left <= 0) modal.cancel?.(); }, 1000);
  const keep = await modal({ title: "Keep these display settings?", text: `Reverting in ${left} seconds…`, okText: "Keep", cancel: "Revert", icon: "monitor" });
  clearInterval(timer);
  if (!keep) { await setCtl(id, old, { quiet: true, label: `${d.name} ${what} (reverted)` }); toast("info", "Display settings reverted"); }
  loaders.display();
}

/* ---------- SOUND ---------- */
PAGES.sound = () => pageHead("sound", "Volume, speakers, headphones and microphones.") +
  sec("Output") + group(
    custom("volume", "red", "Volume", "", `<button class="btn ghost icon" data-mute-ctl="mute" data-on-icon="volume" data-off-icon="mute" data-toggle-ctl="mute"></button><div class="slider"><input type="range" min="0" max="150" data-ctl="volume"><span class="val" data-val="volume">–</span></div>`, { kw: "loud sound" }),
    `<div id="sinks"></div>`) +
  sec("Input") + group(
    custom("mic", "pink", "Microphone level", "", `<button class="btn ghost icon" data-mute-ctl="micmute" data-on-icon="mic" data-off-icon="micoff" data-toggle-ctl="micmute"></button><div class="slider"><input type="range" min="0" max="150" data-ctl="mic"><span class="val" data-val="mic">–</span></div>`),
    `<div id="sources"></div>`) +
  sec("Apps playing sound", `<button class="btn sm ghost" id="streamsRefresh">${ic("refresh")}Refresh</button>`) + `<div class="group" id="streams"></div>` +
  sec("Tools") + acts(["testSpeaker", "testMic", "restartAudio", "audioDevices"]);
loaders.sound = async () => {
  const a = await api("/api/audio");
  const devIcon = d => /headset|headphone/i.test(d) ? "headphones" : /hdmi|displayport/i.test(d) ? "monitor" : "speaker";
  const inUse = (list, id) => [...list].sort((x, y) => (y.name === CTL[id]) - (x.name === CTL[id]));
  a.sinks = inUse(a.sinks, "sink"); a.sources = inUse(a.sources, "source");
  $("#sinks").innerHTML = a.sinks.map(s => `<div class="row">${tile(devIcon(s.desc), "slate", "soft")}<div class="txt"><b>${esc(s.desc)}</b></div><div class="ctl"><button class="btn sm" data-set="sink" data-v='${esc(JSON.stringify(s.name))}' data-v-raw="${esc(s.name)}">Use this</button></div></div>`).join("");
  $("#sources").innerHTML = a.sources.map(s => `<div class="row">${tile(/headset/i.test(s.desc) ? "headphones" : "mic", "slate", "soft")}<div class="txt"><b>${esc(s.desc)}</b></div><div class="ctl"><button class="btn sm" data-set="source" data-v='${esc(JSON.stringify(s.name))}' data-v-raw="${esc(s.name)}">Use this</button></div></div>`).join("");
  $("#streams").innerHTML = a.streams.length ? a.streams.map(s => `<div class="row">${tile("music", "red", "soft")}<div class="txt"><b>${esc(s.app)}</b><small>${esc(s.media)}</small></div><div class="ctl"><button class="btn ghost icon" data-stream-mute="${s.id}" data-m="${s.mute ? 1 : ""}">${ic(s.mute ? "mute" : "volume")}</button><div class="slider"><input type="range" min="0" max="150" value="${s.volume}" data-stream="${s.id}" style="--p:${s.volume / 1.5}%"><span class="val">${s.volume}%</span></div></div></div>`).join("")
    : empty("music", "Nothing is playing sound right now.");
  markDevices();
};
function markDevices() {
  $$("[data-set=sink], [data-set=source]").forEach(b => { const on = CTL[b.dataset.set] === b.dataset.vRaw; b.textContent = on ? "In use" : "Use this"; b.className = "btn sm" + (on ? " primary" : ""); b.disabled = on; });
}

/* ---------- NETWORK ---------- */
PAGES.network = () => pageHead("network", "Wi-Fi, wired connections, Bluetooth and sharing.") +
  group(tog("wifi", "wifi", "blue", "Wi-Fi", "Wireless networking"), tog("airplane", "plane", "orange", "Airplane mode", "Turn off all wireless radios"),
    tog("bluetooth", "bluetooth", "indigo", "Bluetooth", "Headphones, mice, controllers…")) +
  sec("Connections") + `<div class="grid3" id="netDevices"></div>` +
  sec("Wi-Fi networks", `<button class="btn sm ghost" id="wifiRescan">${ic("refresh")}Rescan</button>`) + `<div class="group"><div class="scroll" id="wifiList"></div></div>` +
  sec("Bluetooth devices") + `<div class="group" id="btList"></div>` +
  sec("Sharing & Security") + group(tog("svc_sshd", "terminal", "slate", "Remote login (SSH)", "Let other computers log in to this one over the network", { kw: "ssh server" }),
    tog("svc_avahi-daemon", "network", "teal", "Network discovery", "Find printers and shared devices automatically (Avahi)"),
    tog("svc_ufw", "shield", "red", "Firewall (UFW)", "Block unexpected incoming network connections", { kw: "security firewall" })) +
  sec("Tools") + acts(["pingTest", "speedTest", "publicIp", "restartNet", "ports", "savedNets"]);
loaders.network = async () => {
  const [w, bt] = await Promise.all([api("/api/wifi"), api("/api/bluetooth")]);
  $("#netDevices").innerHTML = w.devices.filter(d => !["bridge", "tun", "wifi-p2p", "loopback"].includes(d.type)).map(d => {
    const on = d.state.startsWith("connected");
    return `<div class="card pad" style="display:flex;gap:12px;align-items:center">${tile(d.type === "wifi" ? "wifi" : "ethernet", on ? "green" : "slate", on ? "" : "soft")}<div style="min-width:0"><b>${esc(d.connection || (d.type === "ethernet" ? "Ethernet" : d.type))}</b><div style="color:var(--muted);font-size:12.5px">${esc(d.device)} · ${on ? "connected" : esc(d.state)}</div></div></div>`;
  }).join("");
  $("#wifiList").innerHTML = w.networks.length ? `<table class="tbl"><tbody>` + w.networks.map((n, i) => `<tr><td style="width:44px">${tile(n.signal > 66 ? "wifi" : n.signal > 33 ? "signal" : "signal", n.active ? "green" : "blue", n.active ? "" : "soft")}</td><td><b>${esc(n.ssid)}</b> ${n.active ? `<span class="chip good">connected</span>` : ""}<div class="desc">${n.security ? ic("lock").replace('class="i"', 'class="i" style="width:11px;height:11px;vertical-align:-1px"') + " " + esc(n.security) : "Open network"}</div></td><td style="width:120px"><div class="meter"><i style="width:${n.signal}%"></i></div></td><td class="acts">${n.active ? `<button class="btn sm" data-wpass="${i}">${ic("key")}Password</button> <button class="btn sm" data-wd="${i}">Disconnect</button>` : `<button class="btn sm primary" data-wc="${i}">Connect</button>`}</td></tr>`).join("") + `</tbody></table>`
    : empty("wifioff", w.wifi_radio === "enabled" ? "No Wi-Fi networks in range (or no Wi-Fi adapter). You're on a wired connection." : "Wi-Fi is turned off.");
  $("#wifiList")._nets = w.networks;
  $("#btList").innerHTML = !bt.available ? `<div class="row">${tile("bluetooth", "indigo", "soft")}<div class="txt"><b>Bluetooth is off</b><small>Turn it on above to see your devices</small></div></div>`
    : bt.devices.length ? bt.devices.map(d => `<div class="row">${tile(/audio|head/.test(d.icon) ? "headphones" : /phone/.test(d.icon) ? "phone" : /mouse/.test(d.icon) ? "pointer" : /keyboard/.test(d.icon) ? "keyboard" : "bluetooth", d.connected ? "indigo" : "slate", d.connected ? "" : "soft")}<div class="txt"><b>${esc(d.name)}</b><small>${d.connected ? "Connected" : "Paired"}</small></div><div class="ctl"><label class="sw"><input type="checkbox" data-btdev="${esc(d.path)}" ${d.connected ? "checked" : ""}><span></span></label></div></div>`).join("")
    : `<div class="row">${tile("bluetooth", "indigo", "soft")}<div class="txt"><b>No paired devices</b><small>Pair new devices in your system settings, under Bluetooth</small></div><div class="ctl">${PLAT.settingsPages?.bluetooth || PLAT.settingsApp ? `<button class="btn sm" data-launch="${esc(PLAT.settingsPages?.bluetooth || PLAT.settingsApp)}">Open</button>` : ""}</div></div>`;
};

/* ---------- POWER ---------- */
const mins = (list, never = "Never") => [[0, never], ...list.map(m => [m * 60, m < 60 ? `${m} minute${m > 1 ? "s" : ""}` : `${m / 60} hour${m > 60 ? "s" : ""}`])];
PAGES.power = () => pageHead("power", "Sleep, screen lock, performance and power buttons.") +
  `<div id="batteryTopHero"></div>` +
  group(tog("awake", "coffee", "amber", "Keep awake", "Never dim, lock or sleep while this is on (like caffeine)", { kw: "caffeine prevent sleep" }),
    tog("performance", "zap", "orange", "Performance mode", "Run the CPU at full speed. Uses more power, resets on restart", { kw: "cpu governor" })) +
  secIf("When idle",
  group(sel("screenoff", "monitor", "blue", "Turn off screen after", "", mins([1, 2, 5, 10, 15, 30, 60])),
    sel("autosleep", "moon", "indigo", "Go to sleep after", "", mins([5, 10, 15, 30, 60, 120, 180]), { kw: "suspend" }),
    sel("autolock", "lock", "slate", "Lock screen after", "", [[0, "Never"], ...[1, 2, 5, 10, 15, 30, 60].map(m => [m, `${m} minute${m > 1 ? "s" : ""}`])]),
    tog("lockresume", "shield", "green", "Lock when waking from sleep", "Ask for your password after sleep"))) +
  `<div id="batteryCareSec"></div>` +
  sec("Power") + acts(["lock", "suspend", "logout", "reboot", "poweroff", "firmware"]);
let batTimer = null;
loaders.power = async () => {
  clearInterval(batTimer);
  const updateBattery = async () => {
    const b = await api("/api/battery").catch(() => null);
    const topEl = $("#batteryTopHero");
    const el = $("#batteryCareSec");
    if (!b?.present || !b.batteries?.length) {
      if (topEl) topEl.innerHTML = "";
      if (el) el.innerHTML = "";
      return;
    }
    const bat = b.batteries[0];
    const isCharging = bat.status.toLowerCase() === "charging";
    const isFull = bat.status.toLowerCase() === "full";
    const statColor = isCharging ? "green" : isFull ? "teal" : (bat.capacity < 30 ? "red" : bat.capacity < 60 ? "amber" : "blue");
    const statIcon = isCharging ? "zap" : "battery";
    const precise = (bat.exact_pct != null ? Number(bat.exact_pct).toFixed(1) : bat.capacity.toFixed(1)) + "%";

    if (topEl) {
      topEl.innerHTML = `
        <div class="card pad" style="margin-bottom:14px;background:linear-gradient(135deg, rgba(var(--c-${statColor}-rgb, 49, 134, 255), 0.12), transparent);border:1px solid rgba(var(--c-${statColor}-rgb, 49, 134, 255), 0.25)">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap">
            <div style="display:flex;align-items:center;gap:14px">
              ${tile(statIcon, statColor)}
              <div>
                <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);font-weight:600">${esc(bat.name)} · ${esc(bat.status)}</div>
                <div style="font-size:32px;font-weight:750;letter-spacing:-0.02em;font-variant-numeric:tabular-nums;color:var(--text)" id="liveBatExact">${precise}</div>
              </div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${bat.watts ? `<span class="chip plain">${bat.watts} W</span>` : ""}
              ${bat.voltage ? `<span class="chip plain">${bat.voltage} V</span>` : ""}
              ${bat.health != null ? `<span class="chip ${bat.health > 80 ? 'good' : bat.health > 60 ? 'warn' : 'bad'}">Health: ${bat.health}%</span>` : ""}
              ${bat.cycles > 0 ? `<span class="chip plain">${bat.cycles} cycles</span>` : ""}
            </div>
          </div>
          <div class="meter ${bat.capacity < 20 ? 'bad' : bat.capacity < 40 ? 'warn' : ''}" style="margin-top:12px;--mc:var(--c-${statColor})">
            <i style="width:${isFull ? 100 : Math.min(100, Math.max(0, bat.exact_pct != null ? bat.exact_pct : bat.capacity))}%"></i>
          </div>
        </div>`;
    }

    if (el) {
      const healthRow = bat.health != null ? `<div class="row">${tile("heart", "red", "soft")}<div class="txt"><b>Battery health</b><small>Maximum capacity compared to when new</small></div><div class="ctl"><span class="chip ${bat.health > 80 ? "good" : bat.health > 60 ? "warn" : "bad"}">${bat.health}%</span></div></div>` : "";
      const cycleRow = bat.cycles > 0 ? `<div class="row">${tile("refresh", "blue", "soft")}<div class="txt"><b>Cycle count</b><small>Total charge & discharge cycles completed</small></div><div class="ctl"><span class="chip plain">${bat.cycles} cycles</span></div></div>` : "";
      const statusRow = `<div class="row">${tile("battery", statColor, "soft")}<div class="txt"><b>${esc(bat.name)}: ${precise}</b><small>${esc(bat.status)} · ${esc(bat.technology)} ${esc(bat.model || bat.manufacturer)}</small></div><div class="ctl"><span class="chip ${statColor}">${esc(bat.status)}</span></div></div>`;

      let thresholdHtml = "";
      if (b.supported) {
        thresholdHtml = custom("sliders", "green", "Charging limit (Battery care)", "Stop charging at 80% to prolong battery lifespan",
          `<div style="display:flex;align-items:center;gap:12px"><b id="batLimVal">${b.limit || 80}%</b><input type="range" id="batLim" min="60" max="100" step="5" value="${b.limit || 80}" style="width:140px"><button class="btn sm" id="batLimApply">Set</button></div>`,
          { admin: true, kw: "battery charge threshold health care" });
      } else {
        thresholdHtml = `<div class="row">${tile("info", "slate", "soft")}<div class="txt"><b>Charge limit control</b><small>Hardware-level charge stopping is not supported by your battery controller firmware</small></div></div>`;
      }

      el.innerHTML = sec("Battery & Health") + group(statusRow, healthRow, cycleRow, thresholdHtml);

      const slider = $("#batLim");
      if (slider) {
        slider.oninput = () => { $("#batLimVal").textContent = slider.value + "%"; };
        $("#batLimApply").onclick = async () => {
          await setCtl("battery_care", +slider.value, { label: `Battery limit ${slider.value}%` });
          toast("ok", `Battery limit set to ${slider.value}%`);
        };
      }
    }
  };
  await updateBattery();
  batTimer = setInterval(() => { if (CUR === "power" && !document.hidden) updateBattery(); }, 3000);
};
leavers.power = () => clearInterval(batTimer);

/* ---------- TIME ---------- */
PAGES.time = () => pageHead("time", "Clock, time zone and computer name.") +
  `<div class="card pad" style="text-align:center;padding:26px"><div id="bigclock" style="font-size:44px;font-weight:650;letter-spacing:-.03em;font-variant-numeric:tabular-nums">--:--</div><div id="bigdate" style="color:var(--muted)"></div></div>` +
  sec("Clock") + group(tog("ntp", "refresh", "green", "Set time automatically", "Keep the clock synced from the internet (NTP)", { kw: "ntp sync" }),
    custom("globe", "blue", "Time zone", "Where you are in the world", `<input type="text" data-ctl="timezone" list="tzlist" style="width:240px" id="tzInput"><datalist id="tzlist"></datalist><button class="btn" id="tzApply">Apply</button>`, { admin: true, kw: "timezone" })) +
  sec("This computer") + group(custom("hash", "slate", "Computer name", "How this PC appears on the network (hostname)", `<input type="text" data-ctl="hostname" style="width:200px" id="hostInput"><button class="btn" id="hostApply">Rename</button>`, { admin: true, kw: "hostname" })) +
  sec("Tools") + acts(["calendar"]);
let TZ = null;
loaders.time = async () => { tickClock(); if (!TZ) { TZ = await api("/api/timezones"); $("#tzlist").innerHTML = TZ.map(t => `<option value="${t}">`).join(""); } };

/* ---------- APPS ---------- */
const ARCHY = PLAT.family === "arch" || !PLAT.family;
const POPULAR = [["firefox", "Firefox"], ["chromium", "Chromium"], ["vlc", "VLC"], ["gimp", "GIMP"], [ARCHY ? "libreoffice-fresh" : "libreoffice", "LibreOffice"], ["com.discordapp.Discord", "Discord"], ["steam", "Steam"], ["obs-studio", "OBS Studio"], ["thunderbird", "Thunderbird"], ["krita", "Krita"], ["kdenlive", "Kdenlive"], [ARCHY && PLAT.aur !== "" ? "visual-studio-code-bin" : "com.visualstudio.code", "VS Code"], [ARCHY ? "telegram-desktop" : "telegram", "Telegram"], ["com.spotify.Client", "Spotify"], ["blender", "Blender"], ["htop", "htop"]];
PAGES.apps = () => pageHead("apps", `Install, remove and update software from ${SOURCES_TEXT}.`) +
  `<div class="grid3" id="pkgStats"></div>` + sec("Updates") + acts(["checkUpdates", "updateAll", "cleanup"]) +
  sec("Default apps") + `<div class="group" id="defApps">${empty("grid", "Loading…")}</div>` +
  sec("Find software") +
  `<div class="field">${segHtml("appMode", [["search", "Get new apps", "search"], ["installed", "Installed", "package"]], "search")}<input type="search" id="appQuery" placeholder="Search e.g. vlc, gimp, discord…"><button class="btn primary" id="appGo">${ic("search")}Search</button></div>
  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px" id="popular">${POPULAR.map(([q, l]) => `<button class="chip plain" style="cursor:pointer" data-pop="${q}">${l}</button>`).join("")}</div>
  <div class="group" style="margin-top:12px"><div class="scroll" id="appTable">${empty("package", "Search for an app above, or tap a popular one.")}</div></div>`;
let appRows = [], installedCache = null;
const SRC = { repo: ["accent", "Official"], pacman: ["accent", "Official"], aur: ["warn", "AUR"], flatpak: ["good", "Flatpak"], snap: ["plain", "Snap"] };
const srcChip = s => `<span class="chip ${(SRC[s] || SRC.repo)[0]}" title="${s === "repo" ? esc(PLAT.repoName || "") : ""}">${(SRC[s] || SRC.repo)[1]}</span>`;
const installCmd = p => pkgCmd({ flatpak: PLAT.pkg.install_flatpak, aur: PLAT.pkg.install_aur, snap: PLAT.pkg.install_snap }[p.source] || PLAT.pkg.install, p.name);
const removeCmd = p => pkgCmd({ flatpak: PLAT.pkg.remove_flatpak, snap: PLAT.pkg.remove_snap }[p.source] || PLAT.pkg.remove, p.name);
async function searchApps() {
  const q = $("#appQuery").value.trim(), t = $("#appTable");
  if (appMode() === "search") {
    if (!q) { t.innerHTML = empty("package", "Search for an app above, or tap a popular one."); return; }
    t.innerHTML = empty("search", `Searching ${SOURCES_TEXT}…`);
    appRows = await api("/api/pkgsearch?q=" + encodeURIComponent(q));
  } else {
    if (!installedCache) { t.innerHTML = empty("package", "Loading…"); installedCache = await api("/api/installed"); }
    appRows = installedCache;
  }
  renderApps();
}
function renderApps() {
  const q = $("#appQuery").value.trim().toLowerCase(), inst = appMode() === "installed";
  const rows = inst ? appRows.filter(p => !q || (p.name + (p.label || "")).toLowerCase().includes(q)) : appRows;
  if (!rows.length) { $("#appTable").innerHTML = empty("search", "Nothing found."); return; }
  $("#appTable").innerHTML = `<table class="tbl"><thead><tr><th>App</th><th>Source</th><th>Version</th><th></th></tr></thead><tbody>` + rows.slice(0, 400).map((p, i) => `<tr>
    <td><b>${esc(p.label || p.name)}</b>${p.label ? ` <span class="desc">${esc(p.name)}</span>` : ""}${p.desc ? `<div class="desc">${esc(p.desc)}</div>` : ""}</td>
    <td>${srcChip(p.source)}</td><td class="desc mono">${esc(p.version)}</td>
    <td class="acts">${inst || p.installed ? `<button class="btn sm danger" data-rm="${i}">${ic("trash")}Remove</button>` : `<button class="btn sm primary" data-in="${i}">${ic("download")}Install</button>`}</td></tr>`).join("") + "</tbody></table>";
  $("#appTable")._rows = rows;
}
let appMode = () => "search";
async function loadDefaultApps() {
  const d = await api("/api/defaultapps").catch(() => []);
  const icons = { browser: ["globe", "blue"], mail: ["bell", "red"], files: ["folder", "amber"], pdf: ["file", "red"], image: ["image", "teal"], music: ["music", "pink"], video: ["play", "violet"], text: ["type", "slate"] };
  $("#defApps").innerHTML = d.map(c => { const [i, col] = icons[c.key] || ["grid", "slate"];
    return `<div class="row">${tile(i, col)}<div class="txt"><b>${c.label}</b><small>Opens when you click a ${c.label.toLowerCase().replace(/s$/, "")}${c.options.length < 2 ? " · install another app to get a choice" : ""}</small></div><div class="ctl"><select data-defapp="${c.key}">${c.options.map(o => `<option value="${esc(o.id)}" ${o.id === c.current ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select></div></div>`; }).join("");
}
loaders.updatesDone = () => { try { localStorage.removeItem("updatesChecked"); } catch {} UPDATES = null; renderUpdateBadge(); checkUpdatesQuietly(); };
loaders.apps = async () => {
  loadDefaultApps();
  const d = DISK || await api("/api/diskinfo"); DISK = d;
  $("#pkgStats").innerHTML = [["package", "violet", d.packages, "packages installed"], ["layers", "green", d.flatpaks, "Flatpak apps"], ["broom", "orange", d.orphans, "unused packages"]]
    .map(([i, c, n, l]) => `<div class="card pad" style="display:flex;gap:12px;align-items:center">${tile(i, c, "soft")}<div><div style="font-size:22px;font-weight:650">${n}</div><div style="color:var(--muted);font-size:12.5px">${l}</div></div></div>`).join("");
};

/* ---------- PROCESSES ---------- */
PAGES.procs = () => pageHead("procs", "Like Task Manager: see what's using your computer and close anything frozen.") +
  `<div class="field">${segHtml("procSort", [["cpu", "CPU", "cpu"], ["mem", "Memory", "memory"]], "cpu")}<input type="search" id="procFilter" placeholder="Filter by name…"><label style="display:flex;gap:8px;align-items:center;color:var(--text2)"><label class="sw"><input type="checkbox" id="procAuto" checked><span></span></label>Live</label></div>
  <div class="group" style="margin-top:12px"><div class="scroll" id="procTable"></div></div>` +
  note(`<b>End</b> asks the program to close nicely (<code>kill PID</code>). <b>Force quit</b> stops it instantly (<code>kill -9 PID</code>). Use that only if End doesn't work.`);
let procTimer, procData = [], procSort = () => "cpu";
async function loadProcs() {
  procData = await api("/api/processes?sort=" + procSort()); renderProcs();
  clearTimeout(procTimer);
  if ($("#procAuto").checked && CUR === "procs") procTimer = setTimeout(loadProcs, 2500);
}
function renderProcs() {
  const f = $("#procFilter").value.toLowerCase();
  const rows = procData.filter(p => p.name !== "ps" && (!f || p.args.toLowerCase().includes(f)));
  $("#procTable").innerHTML = `<table class="tbl"><thead><tr><th>Program</th><th>User</th><th class="num">CPU</th><th class="num">Memory</th><th class="num">PID</th><th></th></tr></thead><tbody>` +
    rows.map(p => `<tr><td><b>${esc(p.name)}</b><div class="desc mono" style="max-width:480px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(p.args)}">${esc(p.args)}</div></td><td class="desc">${esc(p.user)}</td><td class="num"><span style="color:${p.cpu > 50 ? "var(--bad)" : p.cpu > 15 ? "var(--warn)" : "inherit"}">${p.cpu.toFixed(1)}%</span></td><td class="num">${bytes(p.rss)}</td><td class="num desc">${p.pid}</td>
    <td class="acts"><button class="btn sm" data-kill="${p.pid}" data-n="${esc(p.name)}" data-u="${esc(p.user)}">End</button> <button class="btn sm danger" data-kill9="${p.pid}" data-n="${esc(p.name)}" data-u="${esc(p.user)}">Force quit</button></td></tr>`).join("") + "</tbody></table>";
}
loaders.procs = loadProcs;
leavers.procs = () => clearTimeout(procTimer);

/* ---------- SERVICES & STARTUP ---------- */
PAGES.services = () => pageHead("services", "What starts when you turn on the computer or log in.") +
  sec("Start at boot") + group(
    tog("svc_bluetooth", "bluetooth", "indigo", "Bluetooth service", "Needed for any Bluetooth device"),
    tog("svc_sshd", "terminal", "slate", "SSH server", "Remote logins from other computers"),
    tog("svc_avahi-daemon", "network", "teal", "Avahi (network discovery)", "Finds printers and shared devices"),
    tog("svc_libvirtd", "box", "violet", "Virtual machines (libvirt)", "Needed for your VMs"),
    tog("svc_fstrim.timer", "sparkles", "green", "Weekly SSD TRIM", "Keeps your SSD fast. Recommended"),
    tog("svc_paccache.timer", "package", "orange", "Weekly package cache cleanup", "Needs pacman-contrib installed")) +
  sec("Apps that open when you log in") +
  `<div style="display:flex;justify-content:flex-end;margin-bottom:8px"><button class="btn sm primary" id="addAutostartBtn">${ic("plus")}Add startup app</button></div>` +
  `<div class="group" id="autostart"></div>` +
  sec("All services") +
  `<div class="field">${segHtml("svcScope", [["system", "System"], ["user", "My user"]], "system")}${segHtml("svcShow", [["running", "Running"], ["failed", "Failed"], ["all", "All"]], "running")}<input type="search" id="svcFilter" placeholder="Filter, e.g. bluetooth"></div>
  <div class="group" style="margin-top:12px"><div class="scroll" id="svcTable"></div></div>`;
let svcData = [], svcScope = () => "system", svcShow = () => "running";
async function loadSvcs() { $("#svcTable").innerHTML = empty("rocket", "Loading…"); svcData = await api("/api/services?scope=" + svcScope()); renderSvcs(); }
function renderSvcs() {
  const f = $("#svcFilter").value.toLowerCase(), show = svcShow();
  const rows = svcData.filter(s => (!f || (s.unit + s.description).toLowerCase().includes(f)) && (show === "all" || show === "running" && s.active === "active" || show === "failed" && s.active === "failed"));
  if (!rows.length) { $("#svcTable").innerHTML = empty(show === "failed" ? "checkcircle" : "search", show === "failed" ? "No failed services 🎉" : "Nothing matches."); return; }
  $("#svcTable").innerHTML = `<table class="tbl"><thead><tr><th>Service</th><th>Status</th><th>At boot</th><th></th></tr></thead><tbody>` + rows.map(s => {
    const st = s.active === "active" ? `<span class="chip good">${s.sub}</span>` : s.active === "failed" ? `<span class="chip bad">failed</span>` : `<span class="chip">${s.active}</span>`;
    const en = s.enabled === "enabled" ? `<span class="chip accent">enabled</span>` : s.enabled ? `<span class="chip plain">${s.enabled}</span>` : "";
    const canEnable = s.enabled === "enabled" || s.enabled === "disabled";
    return `<tr><td><b>${esc(s.unit.replace(/\.service$/, ""))}</b><div class="desc">${esc(s.description)}</div></td><td>${st}</td><td>${en}</td>
    <td class="acts" data-u="${esc(s.unit)}">${s.active === "active" ? `<button class="btn sm" data-sa="restart">Restart</button> <button class="btn sm" data-sa="stop">Stop</button>` : `<button class="btn sm" data-sa="start">Start</button>`}${canEnable ? (s.enabled === "enabled" ? ` <button class="btn sm" data-sa="disable">Disable</button>` : ` <button class="btn sm" data-sa="enable">Enable</button>`) : ""} <button class="btn sm ghost" data-sa="logs">${ic("scroll")}Logs</button></td></tr>`;
  }).join("") + "</tbody></table>";
}
async function loadAutostart() {
  const a = await api("/api/autostart");
  $("#autostart").innerHTML = a.map(e => `<div class="row">${tile(e.system ? "cog" : "rocket", e.system ? "slate" : "indigo", "soft")}<div class="txt"><b>${esc(e.name)}</b><small>${esc(e.comment || e.file)}${e.system ? " · part of the desktop, leave on unless you know why" : ""}</small></div><div class="ctl" style="display:flex;align-items:center;gap:10px">${e.user ? `<button class="btn sm ghost" data-autostart-rm="${esc(e.file)}" title="Remove startup entry">${ic("trash")}</button>` : ""}<label class="sw"><input type="checkbox" data-autostart="${esc(e.file)}" ${e.enabled ? "checked" : ""}><span></span></label></div></div>`).join("") || empty("rocket", "No startup apps");
  const addBtn = $("#addAutostartBtn");
  if (addBtn) {
    addBtn.onclick = async () => {
      const name = prompt("Application Name (e.g. My Script):");
      if (!name) return;
      const cmd = prompt("Command or program path to run:");
      if (!cmd) return;
      await setCtl("autostart_add", { name, exec: cmd });
      toast("ok", `Added ${name} to startup`);
      loadAutostart();
    };
  }
  $$("#autostart [data-autostart-rm]").forEach(btn => {
    btn.onclick = async () => {
      const file = btn.dataset.autostartRm;
      if (!confirm(`Remove ${file} from startup?`)) return;
      await setCtl("autostart_remove:" + file, true);
      toast("ok", "Removed startup item");
      loadAutostart();
    };
  });
}
loaders.services = () => { loadSvcs(); loadAutostart(); };

/* ---------- STORAGE ---------- */
PAGES.storage = () => pageHead("storage", "See where your space went and clean it up.") +
  `<div class="grid2" id="drivesList"></div>` +
  sec("Memory") + group(tog("zram", "memory", "violet", "Compressed memory (zram)", "Extra breathing room when RAM fills up, by compressing what isn't being used. A good safety net, especially without a swap file", { kw: "swap zram ram" })) +
  sec("Free up space") + group(actRow("cleanAllJunk"), actRow("clearCache"), actRow("emptyTrash"), actRow("pkgCache"), actRow("cleanFlatpak"), actRow("journalVacuum")) +
  sec("Find files") + `<div class="field"><input type="text" id="findName" placeholder="Part of the file name, e.g. resume"><input type="text" id="findIn" placeholder="In folder (default: home)" style="max-width:240px"><button class="btn primary" id="findGo">${ic("filesearch")}Find</button></div>` +
  sec("Open a folder") + `<div style="display:flex;gap:8px;flex-wrap:wrap" id="folders"></div>` +
  sec("Tools") + acts(["bigFolders", "bigFiles", "drives", "trim", "smart"]);
loaders.storage = async () => {
  const [dr, di] = await Promise.all([api("/api/drives"), api("/api/diskinfo")]); DISK = di;
  $("#drivesList").innerHTML = dr.map(d => {
    const p = d.size ? d.used / d.size * 100 : 0;
    return `<div class="card pad"><div style="display:flex;gap:12px;align-items:center">${tile(d.removable ? "usb" : "ssd", d.removable ? "orange" : "amber")}<div style="flex:1;min-width:0"><b>${esc(d.mount === "/" ? "System drive" : d.name)}</b><div style="color:var(--muted);font-size:12.5px">${[d.mount || "not mounted", d.fs, d.mount === "/" ? d.name : ""].filter(Boolean).map(esc).join(" · ")}</div></div>
      ${d.mount ? `<button class="btn sm" data-launch-path="${esc(d.mount)}">${ic("folder")}Open</button>` : `<button class="btn sm primary" data-cmd="udisksctl mount -b ${esc(d.path)}" data-name="Mount ${esc(d.name)}">Mount</button>`}${d.removable && d.mount ? ` <button class="btn sm" data-cmd="udisksctl unmount -b ${esc(d.path)}" data-name="Eject ${esc(d.name)}">Eject</button>` : ""}</div>
      ${d.mount ? `<div class="meter ${p > 90 ? "bad" : p > 80 ? "warn" : ""}" style="margin:14px 0 6px;--mc:var(--c-amber)"><i style="width:${p}%"></i></div><div style="display:flex;justify-content:space-between;font-size:12.5px;color:var(--muted)"><span>${bytes(d.used)} used</span><span><b style="color:var(--text)">${bytes(d.size - d.used)}</b> free of ${bytes(d.size)}</span></div>` : ""}</div>`;
  }).join("");
  const sizes = { clearCache: di.cache, emptyTrash: di.trash, pkgCache: di.pkgcache, journalVacuum: di.journal };
  Object.entries(sizes).forEach(([k, v]) => { const b = $(`#page-storage [data-act="${k}"]`); if (b && v != null) { let s = b.parentElement.querySelector(".sz"); if (!s) { s = document.createElement("span"); s.className = "chip plain sz"; b.before(s); } s.textContent = v ? bytes(v) : "–"; } });
};

/* ---------- SENSORS ---------- */
PAGES.sensors = () => pageHead("sensors", "Temperatures, fans and power draw, updated live.") +
  `<div id="fanCtl"></div><div class="sensorgrid" id="sensorList" style="margin-top:14px"></div>`;
let sensTimer;
async function loadSensors() {
  const g = await api("/api/sensors");
  const icon = { CPU: ["cpu", "blue"], "Graphics card": ["gpu", "violet"], SSD: ["ssd", "amber"], "Mac sensors": ["fan", "cyan"], Ethernet: ["ethernet", "teal"] };
  $("#sensorList").innerHTML = g.map(c => { const [i, col] = icon[c.name] || ["thermo", "slate"]; return `<div class="group"><h3>${tile(i, col)}${esc(c.name)}</h3><div>${c.items.map(it => {
    const v = it.value ?? 0;
    if (it.kind === "temp") { const mx = it.max && it.max < 150 ? it.max : 100, p = v / mx * 100; return `<div class="sensor"><span class="lbl">${esc(it.label)}</span><div class="meter ${p > 85 ? "bad" : p > 70 ? "warn" : ""}" style="--mc:var(--c-${col})"><i style="width:${Math.min(100, p)}%"></i></div><span class="v">${fmtTemp(v)}</span></div>`; }
    if (it.kind === "fan") { const p = it.max ? v / it.max * 100 : 0; return `<div class="sensor"><span class="lbl">${esc(it.label)}</span><div class="meter" style="--mc:var(--c-cyan)"><i style="width:${Math.min(100, p)}%"></i></div><span class="v">${Math.round(v)} rpm</span></div>`; }
    return `<div class="sensor"><span class="lbl">${esc(it.label)}</span><div style="flex:1"></div><span class="v">${v.toFixed(0)} W</span></div>`;
  }).join("")}</div></div>`; }).join("") || empty("thermo", "No sensors found");
  if (CUR === "sensors") sensTimer = setTimeout(loadSensors, 2000);
}
/* fan control: temperature curves, force-stop, or "Apple automatic" handing control back to firmware */
const FAN_MODES = [
  ["auto", "Apple automatic", "sparkles", "Mac's built-in control, the way macOS does it"],
  ["quiet", "Quiet", "moon", "Stays slow until 60°C, full speed at 85°C"],
  ["balanced", "Balanced", "gauge", "Speeds up from 55°C, full speed at 75°C"],
  ["cool", "Cool", "fan", "Speeds up early from 45°C, full speed at 68°C"],
  ["max", "Full speed", "zap", "Always at the normal maximum. Loud"],
  ["stop", "Force stop", "stop", "Shuts off services and forces fans to stop (0 rpm)"],
  ["overdrive", "Overdrive", "rocket", "Past the normal maximum, as fast as your fans can go"],
];
const FAN_CURVE_NAMES = [["exponential", "Gentle start"], ["linear", "Even"], ["logarithmic", "Early boost"]];
let FAN = null, fanTimer;
function fanCurveSvg(low, high, curve, temp) {
  // the shape of fan speed vs temperature (approximate), with the current temperature marked
  const X = t => (t - 30) / 70 * 300, Y = r => 110 - r * 100;
  const shape = r => curve === "exponential" ? r ** 3 : curve === "logarithmic" ? Math.log(1 + 9 * r) / Math.log(10) : r;
  let d = "";
  for (let t = 30; t <= 100; t += 1) { const r = t <= low ? 0 : t >= high ? 1 : shape((t - low) / (high - low)); d += `${d ? "L" : "M"}${X(t).toFixed(1)},${Y(r).toFixed(1)} `; }
  const tm = temp != null ? `<line x1="${X(temp)}" x2="${X(temp)}" y1="8" y2="110" class="fc-now"/><text x="${X(temp) + 4}" y="20" class="fc-t">now ${temp}°C</text>` : "";
  return `<svg viewBox="-28 0 340 132" class="fancurve" role="img" aria-label="Fan speed rises from ${low}°C to full speed at ${high}°C">
    <line x1="0" x2="300" y1="110" y2="110" class="fc-axis"/><line x1="0" x2="0" y1="10" y2="110" class="fc-axis"/>
    ${[40, 60, 80, 100].map(t => `<text x="${X(t)}" y="126" class="fc-l" text-anchor="middle">${t}°</text>`).join("")}
    <text x="-6" y="14" class="fc-l" text-anchor="end">max</text><text x="-6" y="112" class="fc-l" text-anchor="end">min</text>
    <path d="${d}" class="fc-line" vector-effect="non-scaling-stroke"/>${tm}</svg>`;
}
// Overdrive: a fixed speed between the fans' normal maximum and the limit they actually reach
function overdriveHtml() {
  const top = Math.max(...FAN.fans.map(f => f.max), 0); if (!top) return "";
  const limit = SETTINGS.fanLimit, ceil = Math.round(top * 1.5), hi = limit && limit > top ? Math.min(limit, ceil) : ceil;
  const cur = FAN.overdrive.target || hi, open = FAN.mode === "overdrive" || FAN.odOpen;
  return `<details class="fanadv" id="odBox" ${open ? "open" : ""}><summary>${ic("rocket")}Overdrive${FAN.mode === "overdrive" ? ` <span class="chip accent">on: ${FAN.overdrive.target} rpm</span>` : ""}</summary>
    <div class="fanadv-body"><div class="fanadv-ctl" style="flex:2 1 360px">
      <label>Fan speed <b id="odV">${cur} rpm · ${Math.round(cur / top * 100)}% of normal max</b><input type="range" id="odRpm" min="${top}" max="${hi}" step="25" value="${Math.min(cur, hi)}"></label>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" id="odStart">${ic("rocket")}${FAN.mode === "overdrive" ? "Change speed" : "Start overdrive"}</button><button class="btn" id="odTest">${ic("gauge")}Find my fans' real limit</button></div>
      <small style="color:var(--muted)">${limit ? `Tested limit: <b>${limit} rpm</b> (${Math.round(limit / top * 100)}% of the normal ${top} rpm).` : `Not tested yet. The slider goes up to the hard ceiling of 150% (${ceil} rpm), but your fans may top out sooner. Run the test to find out.`}</small>
    </div><div class="callout warn" style="flex:1 1 260px;margin:0">${ic("alert")}<div><b>Loud and harder on the fans.</b> Overdrive never runs the fans slower than their normal maximum, so it can only cool more. Running fans this fast wears their bearings sooner, so use it for heavy work rather than all day. Pick any other mode to stop.</div></div></div></details>`;
}
async function loadFan() {
  FAN = await api("/api/fan").catch(() => null);
  const box = $("#fanCtl"); if (!box) return;
  if (!FAN?.supported) { box.innerHTML = ""; return; }
  const c = FAN.config, temp = Math.max(FAN.cpu ?? 0, FAN.gpu ?? 0) || null;
  const status = FAN.mode === "auto" ? "Apple automatic control" : FAN.mode === "stop" ? "Fans forced to stop (0 rpm)" : FAN.mode === "custom" ? `Custom curve: ${c.low}°C → ${c.high}°C` : ((FAN_MODES.find(m => m[0] === FAN.mode)?.[1] || FAN.mode) + " mode");
  const subText = `${status} · ${FAN.gpu != null ? `following the hotter of CPU ${fmtTemp(FAN.cpu)} / graphics ${fmtTemp(FAN.gpu)}` : `following the CPU, now ${fmtTemp(FAN.cpu)}`}`;
  const chipsHtml = FAN.fans.map(f => `<span class="chip plain mono">${ic("fan").replace('class="i"', 'class="i" style="width:12px;height:12px"')} ${f.rpm} rpm</span>`).join("");
  const existing = $("#fanrow");
  if (existing) {
    const st = $("#fanStatus"), ch = $("#fanChips");
    if (st) st.textContent = subText;
    if (ch) ch.innerHTML = chipsHtml;
    $$(".fanmode").forEach(b => b.classList.toggle("on", b.dataset.fanmode === FAN.mode));
    return;
  }
  box.innerHTML = `<div class="group fanbox" id="fanrow">
    <div class="row">${tile("fan", "cyan")}<div class="txt"><b>Fan control</b><small id="fanStatus">${subText}</small></div>
      <div class="ctl" id="fanChips">${chipsHtml}</div></div>
    <div class="fanmodes">${FAN_MODES.map(([k, n, i, d]) => `<button class="fanmode ${FAN.mode === k ? "on" : ""}" data-fanmode="${k}">${ic(i)}<b>${n}</b><small>${d}</small></button>`).join("")}</div>
    <details class="fanadv" ${FAN.mode === "custom" ? "open" : ""}><summary>${ic("sliders")}Custom curve</summary>
      <div class="fanadv-body"><div>${fanCurveSvg(c.low, c.high, c.curve, temp)}</div><div class="fanadv-ctl">
        <label>Start speeding up at <b id="fcLowV">${c.low}°C</b><input type="range" id="fcLow" min="30" max="85" value="${c.low}"></label>
        <label>Full speed at <b id="fcHighV">${c.high}°C</b><input type="range" id="fcHigh" min="45" max="95" value="${c.high}"></label>
        <div class="seg" id="fcCurve">${FAN_CURVE_NAMES.map(([v, l]) => `<button data-v="${v}" class="${c.curve === v ? "on" : ""}">${l}</button>`).join("")}</div>
        <button class="btn primary" id="fcApply">${ic("check")}Use this curve</button></div></div></details>
    ${overdriveHtml()}
    ${FAN.installed ? "" : `<div class="row"><div class="txt"><small>${ic("info").replace('class="i"', 'class="i" style="width:13px;height:13px;vertical-align:-2px"')} Choosing a mode sets up the fan service (asks for your password once). Apple hardware uses safe curves or manual control to protect the fans.</small></div></div>`}
  </div>`;
  const paint = () => { $$("#fanrow input[type=range]").forEach(el => el.style.setProperty("--p", (el.value - el.min) / (el.max - el.min) * 100 + "%")); };
  paint();
  const redraw = () => {
    let lo = +$("#fcLow").value, hi = +$("#fcHigh").value;
    if (hi - lo < 5) { if (document.activeElement === $("#fcLow")) lo = hi - 5; else hi = lo + 5; $("#fcLow").value = lo; $("#fcHigh").value = hi; }
    $("#fcLowV").textContent = lo + "°C"; $("#fcHighV").textContent = hi + "°C"; paint();
    $(".fanadv-body > div").innerHTML = fanCurveSvg(lo, hi, $("#fcCurve .on").dataset.v, temp);
  };
  $("#fcLow").oninput = $("#fcHigh").oninput = redraw;
  $("#fcCurve").onclick = e => { const b = e.target.closest("button"); if (!b) return; $$("#fcCurve button").forEach(x => x.classList.toggle("on", x === b)); redraw(); };
  $("#fanrow details").ontoggle = e => { FAN.advOpen = e.target.open; };
  const od = $("#odRpm"), top = Math.max(...FAN.fans.map(f => f.max), 1);
  if (od) { od.oninput = () => { $("#odV").textContent = `${od.value} rpm · ${Math.round(od.value / top * 100)}% of normal max`; paint(); }; $("#odBox").ontoggle = e => { FAN.odOpen = e.target.open; }; }
}
loaders.sensors = () => { clearTimeout(sensTimer); clearInterval(fanTimer); loadFan(); loadSensors(); fanTimer = setInterval(() => { if (CUR === "sensors" && !document.hidden && !$("#fanrow details[open]")) loadFan(); }, 4000); };
leavers.sensors = () => { clearTimeout(sensTimer); clearInterval(fanTimer); };
reg.call(null, { page: "sensors", title: "Fan control", desc: "Quiet, balanced, cool or full-speed fans", icon: "fan", color: "cyan", anchor: "fanrow", kw: "fan speed cooling noise loud quiet" });

/* ---------- VMS ---------- */
PAGES.vms = () => pageHead("vms", "Your virtual machines (libvirt / QEMU).", `<button class="btn primary" id="vmNew">${ic("plus")}New virtual machine</button><button class="btn" data-act="virtManager">${ic("external")}Open VM Manager</button>`) +
  `<div id="vmCreate" class="hidden"></div><div class="grid2" id="vmList"></div>` + sec("Settings") + group(tog("svc_libvirtd", "box", "violet", "Virtualization service", "Must be on to run VMs"));
loaders.vms = async () => {
  const v = await api("/api/vms");
  $("#vmList").innerHTML = v.map(m => {
    const running = m.state === "running", win = /win/i.test(m.name);
    return `<div class="card pad vmcard ${running ? "running" : ""}"><div style="display:flex;gap:12px;align-items:center">${osLogo(m.hint || m.name, "lg")}<div style="flex:1"><b style="font-size:15px">${esc(m.name)}</b><div style="color:var(--muted);font-size:12.5px">${esc(m.os || OS_LOGOS[osKey(m.hint)][2])} · ${esc(m.cpus)} CPUs · ${m.memory ? bytes(parseInt(m.memory) * 1024) : ""} RAM</div></div><span class="chip ${running ? "good" : m.state === "paused" ? "warn" : "plain"}">${esc(m.state)}</span></div>
    <div style="display:flex;gap:6px;margin-top:14px;flex-wrap:wrap">${running ? `<button class="btn sm primary" data-vm-open="${esc(m.name)}">${ic("external")}Show screen</button><button class="btn sm" data-vm="shutdown" data-n="${esc(m.name)}">${ic("power")}Shut down</button><button class="btn sm danger" data-vm="destroy" data-n="${esc(m.name)}">Force off</button>` : `<button class="btn sm primary" data-vm="start" data-n="${esc(m.name)}">${ic("play")}Start & open</button><button class="btn sm" data-vm-open="${esc(m.name)}">${ic("external")}Open</button>`}<span style="flex:1"></span><button class="btn sm ghost" data-vmlogin="${esc(m.name)}" title="Login info and notes">${ic("key")}Login info</button><button class="btn sm ghost danger" data-vmdel="${esc(m.name)}" title="Delete this virtual machine">${ic("trash")}</button></div></div>`;
  }).join("") || `<div class="card">${empty("box", "No virtual machines found.")}</div>`;
};

/* ---------- create a virtual machine ---------- */
const GET_ISO = [["Ubuntu", "https://ubuntu.com/download/desktop"], ["Linux Mint", "https://linuxmint.com/download.php"], ["Fedora", "https://fedoraproject.org/workstation/download"],
  ["Debian", "https://www.debian.org/distrib/"], ["Windows 11", "https://www.microsoft.com/software-download/windows11"], ["Windows 10", "https://www.microsoft.com/software-download/windows10"]];
let VMNEW = null;
async function openVmCreate() {
  const box = $("#vmCreate"); box.classList.remove("hidden");
  VMNEW = { isos: null, limits: null, sel: -1, name: "", mem: 4, cpus: 4, disk: 32, tab: VMNEW?.tab || "local", templates: null, tinfo: {}, osinfo: "" };
  box.innerHTML = `<div class="card vmc">${skeleton(3)}</div>`;
  box.scrollIntoView({ block: "start", behavior: "smooth" });
  const [isos, limits, templates] = await Promise.all([api("/api/isos"), api("/api/vm/limits"), api("/api/vm/templates")]);
  Object.assign(VMNEW, { isos, limits, templates });
  resolveTemplates();
  const firstOk = isos.findIndex(x => x.arch === "x86"); if (firstOk >= 0) pickIso(firstOk, false);
  renderVmCreate();
}
const slugName = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "vm";
function pickIso(i, render = true) {
  const x = VMNEW.isos[i]; if (!x || x.arch !== "x86") return;
  VMNEW.sel = i; VMNEW.osinfo = ""; VMNEW.template = "";
  const win = x.family === "windows", maxMem = Math.floor((VMNEW.limits.ram_mb - 2048) / 1024);
  VMNEW.mem = Math.min(win ? 8 : 4, maxMem); VMNEW.cpus = Math.min(4, VMNEW.limits.threads); VMNEW.disk = Math.min(win ? 64 : 32, VMNEW.limits.free_gb - 20);
  let base = slugName(x.os), name = base, n = 2; while (VMNEW.limits.names.includes(name)) name = `${base}-${n++}`;
  VMNEW.name = name;
  if (render) renderVmCreate();
}
function renderVmCreate() {
  const v = VMNEW, x = v.isos[v.sel], L = v.limits, maxMem = Math.floor((L.ram_mb - 2048) / 1024), maxDisk = Math.min(2000, L.free_gb - 20);
  const folder = p => p.replace(HOME, "~").replace(/\/[^/]+$/, "");
  $("#vmCreate").innerHTML = `<div class="card vmc">
    <div class="vmc-head">${tile("box", "teal")}<div><h3>New virtual machine</h3><small>A computer inside your computer, to try another system safely</small></div><button class="btn ghost icon" id="vmCancel" title="Close">${ic("x")}</button></div>
    <div class="vmc-step"><span class="vmc-num">1</span>Choose an installer<div class="vmc-tabs seg">${[["local", "On this computer", "folder"], ["templates", "Download a system", "download"]].map(([k, l, i]) => `<button data-vmtab="${k}" class="${v.tab === k ? "on" : ""}">${ic(i)}${l}</button>`).join("")}</div></div>
    ${v.tab === "templates" ? templatesHtml() : `<div class="isogrid">${v.isos.map((o, i) => `<button class="iso ${i === v.sel ? "on" : ""} ${o.arch !== "x86" ? "off" : ""}" data-iso="${i}" ${o.arch !== "x86" ? "disabled" : ""}>
        ${osLogo(o.os + " " + o.file)}<div><b>${esc(o.os)}</b><small>${esc(o.file)} · ${bytes(o.size)} · ${esc(folder(o.path))}</small>${o.arch !== "x86" ? `<span class="chip warn plain">ARM: won't run on this Mac</span>` : ""}</div>${i === v.sel ? ic("checkcircle") : ""}</button>`).join("")}
      <button class="iso pick" id="vmPickIso">${tile("folder", "slate", "soft")}<div><b>Choose another file…</b><small>Any .iso installer on this computer</small></div></button></div>
    <div class="vmc-get"><span>Need an installer?</span>${GET_ISO.map(([n, u]) => `<button class="chip plain" data-geturl="${u}">${ic("download").replace('class="i"', 'class="i" style="width:12px;height:12px"')}${n}</button>`).join("")}<button class="btn sm ghost" id="vmRefreshIsos">${ic("refresh")}Refresh list</button></div>`}
    ${x ? `<div class="vmc-step"><span class="vmc-num">2</span>Name and size</div>
    <div class="vmc-form">
      <label class="vmc-name">Name <input type="text" id="vmName" value="${esc(v.name)}" maxlength="40"></label>
      <label>Memory <b id="vmMemV">${v.mem} GB</b><input type="range" id="vmMem" min="1" max="${maxMem}" value="${v.mem}"><small>${x.family === "windows" ? "Windows needs at least 4 GB; 8 GB feels smooth." : "4 GB is plenty for most Linux desktops."} Your Mac has ${Math.round(L.ram_mb / 1024)} GB.</small></label>
      <label>Processor cores <b id="vmCpuV">${v.cpus}</b><input type="range" id="vmCpu" min="1" max="${L.threads}" value="${v.cpus}"><small>Shared with your Mac (${L.threads} in total). 2–4 is usually enough.</small></label>
      <label>Disk <b id="vmDiskV">${v.disk} GB</b><input type="range" id="vmDisk" min="10" max="${maxDisk}" step="2" value="${v.disk}"><small>Only uses real space as the VM fills it. ${L.free_gb} GB free.</small></label>
    </div>
    <div class="vmc-sum"><div>${ic("info")}<span id="vmSum"></span></div><button class="btn primary" id="vmCreateGo">${ic("plus")}Create and open</button></div>` : `<div class="empty">${ic("download")}<div>No installers found. Download one above, then press Refresh list.</div></div>`}
  </div>`;
  updateVmSum();
  const paint = () => $$("#vmCreate input[type=range]").forEach(el => el.style.setProperty("--p", (el.value - el.min) / (el.max - el.min) * 100 + "%"));
  paint();
  $$("#vmCreate input[type=range]").forEach(el => el.oninput = () => { VMNEW.mem = +$("#vmMem").value; VMNEW.cpus = +$("#vmCpu").value; VMNEW.disk = +$("#vmDisk").value; $("#vmMemV").textContent = VMNEW.mem + " GB"; $("#vmCpuV").textContent = VMNEW.cpus; $("#vmDiskV").textContent = VMNEW.disk + " GB"; paint(); updateVmSum(); });
  const nm = $("#vmName"); if (nm) nm.oninput = () => { VMNEW.name = nm.value.trim(); updateVmSum(); };
}
function updateVmSum() {
  const v = VMNEW, x = v.isos?.[v.sel], el = $("#vmSum"); if (!el || !x) return;
  const bad = !/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(v.name) ? "Use letters, numbers and dashes for the name" : v.limits.names.includes(v.name) ? "A virtual machine with that name already exists" : "";
  el.innerHTML = bad ? `<span style="color:var(--bad)">${bad}</span>` : `<b>${esc(v.name)}</b>: ${esc(x.os)} with ${v.mem} GB memory, ${v.cpus} core${v.cpus > 1 ? "s" : ""} and a ${v.disk} GB disk. After it's created, its window opens and the installer starts.`;
  $("#vmCreateGo").disabled = !!bad;
}
async function createVm() {
  const v = VMNEW, x = v.isos[v.sel];
  const r = await api("/api/vm/createcmd", { name: v.name, iso: x.path, memory: v.mem * 1024, cpus: v.cpus, disk: v.disk, windows: x.family === "windows", label: x.os, osinfo: v.osinfo });
  if (r.error) return toast("fail", "Can't create it yet", r.error);
  const name = v.name;
  $("#vmCreateGo").disabled = true; $("#vmCreateGo").innerHTML = `<span class="spin"></span>Creating…`;
  const j = await run(r.cmd, "Create " + name, { confirmed: true });
  if (j.code === 0) {
    $("#vmCreate").classList.add("hidden");
    await api("/api/vm/meta", { name, save: true, data: { os: x.os, iso: x.file, template: v.template || "", created: new Date().toISOString().slice(0, 16).replace("T", " ") } });
    VMNEW = null;
    launch(`virt-manager --connect qemu:///system --show-domain-console ${shq(name)}`);
    showVmLogin(name, true);
  } else if (!j.cancelled) { $("#vmCreateGo").disabled = false; $("#vmCreateGo").innerHTML = `${ic("plus")}Try again`; }
  loaders.vms();
}
/* templates: popular systems, downloaded from their official sites and checked before use */
const TAG_COLORS = { Beginner: "good", KDE: "accent", Small: "plain", Advanced: "warn" };
function templatesHtml() {
  const v = VMNEW;
  if (!v.templates) return skeleton(3);
  return `<p class="vmc-note">${ic("shield")}Always the latest release, straight from each project's official site. Every download is checked against its published fingerprint (SHA-256) before it's used.</p>
    <div class="isogrid">${v.templates.map(t => { const r = v.tinfo[t.id];
      const meta = t.link ? "From Microsoft's website" : !r ? `<span class="spin"></span> checking the latest version…` : r.error ? esc(r.error) : `${esc(r.version)} · ${r.size ? bytes(r.size) : "?"}`;
      return `<button class="iso tpl" data-tpl="${t.id}">${osLogo(t.id === "win10" || t.id === "win11" ? "windows" : t.id)}<div><b>${esc(t.name)}</b><small>${esc(t.desc)}</small><small class="tplmeta">${meta}</small>
        <div class="tpltags">${t.tags.map(g => `<span class="chip ${TAG_COLORS[g] || "plain"}">${g}</span>`).join("")}${r?.downloaded ? `<span class="chip good">Downloaded</span>` : ""}</div></div>
        ${t.link ? ic("external") : r?.downloaded ? ic("checkcircle") : ic("download")}</button>`; }).join("")}</div>`;
}
async function resolveTemplates() {
  const v = VMNEW; if (!v?.templates) return;
  await Promise.all(v.templates.filter(t => t.direct).map(async t => {
    v.tinfo[t.id] = await api("/api/vm/template", { id: t.id }).catch(e => ({ error: e.message }));
    if (VMNEW === v && v.tab === "templates") renderVmCreate();
  }));
}
async function useTemplate(id) {
  const v = VMNEW, t = v.templates.find(x => x.id === id);
  if (t.link) { toast("info", `Opening Microsoft's ${t.name} download page`, "Save the .iso to Downloads, then choose it under “On this computer”"); return launch(`xdg-open ${shq(t.link)}`); }
  let r = v.tinfo[id] || await api("/api/vm/template", { id });
  if (r.error) return toast("fail", "Can't get " + t.name, r.error);
  const select = async () => {  // pick the downloaded file and use the template's sizes
    v.isos = await api("/api/isos"); v.tab = "local";
    const i = v.isos.findIndex(x => x.path === r.path); if (i < 0) return renderVmCreate();
    pickIso(i, false);
    const L = v.limits;
    v.mem = Math.min(t.mem, Math.floor((L.ram_mb - 2048) / 1024)); v.cpus = Math.min(t.cpus, L.threads); v.disk = Math.min(t.disk, L.free_gb - 20); v.osinfo = t.osinfo;
    let base = slugName(t.name), name = base, n = 2; while (L.names.includes(name)) name = `${base}-${n++}`; v.name = name;
    v.template = t.id;
    renderVmCreate(); $("#vmCreateGo")?.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  if (r.downloaded) return select();
  if (!(await modal({ title: `Download ${t.name} ${r.version}?`, text: `${r.size ? bytes(r.size) + " " : ""}from the official site, saved to your Downloads folder. You can keep using the dashboard while it downloads, and it's checked when it finishes.`, okText: "Download", icon: "download", color: "teal" }))) return;
  const card = $(`[data-tpl="${id}"]`); if (card) { card.classList.add("busy"); $(".tplmeta", card).innerHTML = `<span class="spin"></span> downloading… (see Activity & output)`; }
  const j = await run(r.cmd, "Download " + t.name, { confirmed: true });
  if (j.code !== 0) { if (card) card.classList.remove("busy"); if (!j.cancelled) toast("fail", `${t.name} didn't finish downloading`, "Press it again to carry on where it left off"); return; }
  r = v.tinfo[id] = { ...r, downloaded: true };
  toast("ok", `${t.name} downloaded and checked`, "Now check the sizes and press Create");
  if (VMNEW === v) select();
}

window.__pickedIso = path => {
  if (!VMNEW) return;
  const file = path.split("/").pop(), win = /win(dows)?1[01]|windows/i.test(file);
  VMNEW.isos.unshift({ path, file, size: 0, os: file.replace(/\.iso$/i, ""), arch: /arm64|aarch64/i.test(file) ? "arm" : "x86", family: win ? "windows" : "linux" });
  pickIso(0);
};

/* the login a new VM starts with (live session), and your own notes */
async function showVmLogin(name, justCreated) {
  const m = await api("/api/vm/meta", { name });
  const L = m.login || {}, cred = L.user ? `<div class="vmlogin">
      <div><small>Username</small><code>${esc(L.user)}</code><button class="btn sm ghost icon" data-copy="${esc(L.user)}" title="Copy">${ic("copy")}</button></div>
      <div><small>Password</small>${L.password ? `<code>${esc(L.password)}</code><button class="btn sm ghost icon" data-copy="${esc(L.password)}" title="Copy">${ic("copy")}</button>` : `<em>none, just press Enter</em>`}</div></div>` : "";
  const html = `${justCreated ? `<p class="warnwhy" style="margin:0 0 10px !important">${ic("checkcircle")}<b>${esc(name)}</b> is ready, and its window is opening.</p>` : ""}
    <p style="margin:0 0 6px">${esc(L.note || "")}</p>${cred}
    <div class="callout note" style="margin:12px 0 10px">${ic("info")}<div><b>After you install</b>, you choose your own username and password in the installer. The dashboard never sets one, so jot yours down below or somewhere safe.</div></div>
    <label class="vmnotes"><small>Your notes for this VM (saved only on this computer, as plain text, so best not to put real passwords here)</small><textarea id="vmNotes" rows="3" placeholder="e.g. my username is alex">${esc(m.notes || "")}</textarea></label>`;
  const ok = await modal({ title: justCreated ? `Logging in to ${name}` : `${name}: login info`, html, okText: "Save notes", cancel: "Close", icon: "key", color: "teal" });
  if (ok) { await api("/api/vm/meta", { name, save: true, data: { notes: $("#vmNotes")?.value ?? "" } }); toast("ok", "Notes saved"); }
}

/* ---------- LOGS ---------- */
PAGES.logs = () => pageHead("logs", "When something breaks, the answer is usually in here.") +
  acts(["errorsNow", "errorsLast", "failedSvc", "kernel", "liveLog", "bootTime", "sysinfo"]) +
  sec("Logs for one program") + `<div class="field"><input type="text" id="logUnit" placeholder="Service name, e.g. NetworkManager, bluetooth, sddm"><button class="btn primary" id="logGo">${ic("scroll")}Show logs</button></div>`;

/* ---------- TOOLBOX ---------- */
// small tools that take one thing you type
const QTOOLS = {
  timer: { ok: v => /^\d{1,3}(\.\d+)?$/.test(v) && +v > 0 && +v <= 600, bad: "Type a number of minutes, like 5",
    cmd: v => `M=${v}; setsid -f sh -c "sleep $(echo "$M*60" | awk '{print int($1*60)}') && notify-send -a 'Linux Dashboard' -i alarm 'Timer done' '${v} minute${+v === 1 ? "" : "s"} are up' && (f=\\$(find /usr/share/sounds -name 'alarm-clock-elapsed.oga' -o -name 'complete.oga' 2>/dev/null | head -1); pw-play \\"\\$f\\" 2>/dev/null || paplay \\"\\$f\\")" >/dev/null 2>&1; echo "⏱  Timer set for ${v} minute${+v === 1 ? "" : "s"}. You'll get a notification at $(date -d "+${Math.round(v * 60)} seconds" +%H:%M)."` },
  calc: { ok: v => /^[\d\s.+\-*/%^()]+$/.test(v), bad: "Only numbers and + - * / % ^ ( )",
    cmd: v => `awk 'BEGIN { r = ${v.replace(/\^/g, "**")}; printf "${v.replace(/%/g, "%%")} = %.10g\\n", r }'` },
  cheat: { ok: v => /^[\w.+-]{1,40}$/.test(v), bad: "Type one command name, like tar or grep",
    cmd: v => `curl -s --max-time 12 'https://cheat.sh/${v}?T' | head -70` },
  site: { ok: v => /^[\w.-]+\.[a-z]{2,}(:\d+)?(\/[\w./?=&%-]*)?$/i.test(v.replace(/^https?:\/\//, "")), bad: "Type a website, like example.com",
    cmd: v => { const u = "https://" + v.replace(/^https?:\/\//, ""); return `curl -sS -o /dev/null -L --max-time 12 -w 'Status %{http_code} · answered in %{time_total}s · server %{remote_ip}\\n' ${shq(u)} && echo "✅ It's up (for you, at least)." || echo "❌ Couldn't reach it from here."`; } },
  port: { ok: v => /^\d{1,5}$/.test(v) && +v < 65536, bad: "Type a port number, like 8080",
    cmd: v => `ss -tulpn 'sport = :${v}' | tail -n +2 | grep . || echo "Nothing is using port ${v}."` },
  hash: { ok: v => v.length > 0, bad: "Type the path of a file", cmd: v => `F=${shq(v.replace(/^~(?=\/|$)/, HOME))}; ls -lh "$F" | awk '{print $5, $9}' && sha256sum "$F" | cut -d' ' -f1 | sed 's/^/SHA-256: /'` },
  qr: { ok: v => v.length > 0 && v.length < 500, bad: "Type some text or a link",
    cmd: v => `if command -v qrencode >/dev/null; then qrencode -t UTF8 -m 2 -- ${shq(v)}; else echo "This needs qrencode.${PLAT.pkg.install ? " Install it with: " + pkgCmd(PLAT.pkg.install, "qrencode", true) : ""}"; fi` },
};
const qtRow = (id, icon, color, title, desc, ph, btn, kw) => custom(icon, color, title, desc,
  `<input type="text" class="qtool-in" id="qt-${id}" data-qt="${id}" placeholder="${esc(ph)}" spellcheck="false" style="width:220px"><button class="btn" data-qtool="${id}">${btn}</button>`, { kw });
async function runQtool(id) {
  const t = QTOOLS[id], inp = $("#qt-" + id); if (!t || !inp) return;
  const v = inp.value.trim();
  if (!t.ok(v)) { inp.classList.add("shake"); setTimeout(() => inp.classList.remove("shake"), 400); return toast("fail", t.bad); }
  run(t.cmd(v), { timer: "Timer", calc: "Calculate", cheat: "Cheat sheet: " + v, site: "Is " + v + " up?", port: "Port " + v, hash: "Checksum", qr: "QR code" }[id]);
}
PAGES.tools = () => pageHead("tools", "Handy one-click utilities.") +
  secIf("Screenshots", acts(["shotRegion", "shotFull", "shotWindow", "colorPick"])) +
  sec("Quick tools") + group(
    qtRow("timer", "timer", "orange", "Timer", "Get a notification after this many minutes", "Minutes, e.g. 10", "Start", "countdown alarm reminder"),
    qtRow("calc", "hash", "blue", "Calculator", "Quick maths, like (120*1.2)/3", "e.g. 2^10 / 4", "=", "math sum"),
    qtRow("cheat", "terminal", "slate", "Command cheat sheet", "Short examples for any command", "e.g. tar", "Look up", "help man examples"),
    qtRow("site", "globe", "teal", "Is a website down?", "Or is it just you?", "e.g. example.com", "Check", "website up down"),
    qtRow("port", "server", "indigo", "What's using a port?", "Find the program holding a network port", "e.g. 8080", "Find", "port in use"),
    qtRow("hash", "shield", "green", "File checksum", "Check a download isn't damaged (SHA-256)", "~/Downloads/file.iso", "Check", "sha256 verify hash"),
    qtRow("qr", "grid", "violet", "Make a QR code", "Text or a link, to scan with your phone", "e.g. https://example.com", "Make", "qr code phone")) +
  sec("Fix things") + acts(["restartPlasma", "restartAudio", "restartNet", "resetWifi", "fixBluetooth", "flushDns", "rebuildMenu", "clearThumbs", "fontCache"]) +
  sec("Check & test") + acts(["sysinfo", "gpuInfo", "batteryHealth", "sensorsNow", "webcams", "usbList", "bootHistory", "whoLogged"]) +
  sec("Network") + acts(["wifiPassword", "lanDevices", "tracePath", "dnsServers"]) +
  sec("Handy") + acts(["weather", "moon", "worldClock", "calendar", "password", "dice", "osAge"]) +
  sec("Open") + acts(["sysSettings", "fileManager", "konsole", "virtManager"]) +
  (PLAT.kdeconnect === false ? "" : sec("Phone (KDE Connect)") + `<div class="group" id="kdc"></div>`);
loaders.tools = async () => {
  if (!$("#kdc")) return;
  const d = await api("/api/kdeconnect");
  $("#kdc").innerHTML = d.length ? d.map(p => `<div class="row">${tile("phone", "green")}<div class="txt"><b>${esc(p.name)}</b><small>Connected</small></div><div class="ctl"><button class="btn sm" data-cmd="kdeconnect-cli -d ${esc(p.id)} --ring" data-name="Ring phone">Ring</button><button class="btn sm" data-cmd="kdeconnect-cli -d ${esc(p.id)} --ping" data-name="Ping phone">Ping</button></div></div>`).join("")
    : `<div class="row">${tile("phone", "green", "soft")}<div class="txt"><b>No phone connected</b><small>Install the KDE Connect app on your phone, on the same network, to ring it, share files and see notifications</small></div><div class="ctl">${PLAT.settingsPages?.kdeconnect ? `<button class="btn sm" data-launch="${esc(PLAT.settingsPages.kdeconnect)}">Set up</button>` : ""}</div></div>`;
};

/* ---------- TERMINAL ---------- */
const LEARN = [
  ["folder", "amber", "pwd", "Which folder am I in?"], ["list", "blue", "ls -lah", "List files here, with hidden ones and sizes"],
  ["chevright", "slate", "cd ~/Downloads && ls", "Go into a folder, then list it (&& = then)"], ["file", "slate", "cat ~/.bashrc", "Print a file's contents"],
  ["plus", "green", "mkdir -p ~/Projects/new-thing", "Make a folder (and parents)"], ["copy", "indigo", "cp -r source dest", "Copy (-r for folders). mv moves, rm deletes"],
  ["filesearch", "orange", "find ~ -iname '*.pdf' | head", "Find files by name. | pipes output onward"], ["search", "violet", "grep -rin 'hello' ~/Documents", "Search inside files for text"],
  ["folder", "amber", "du -sh ~/Downloads", "How big is a folder?"], ["disk", "slate", "df -h", "Free space on every drive"],
  ["memory", "violet", "free -h", "Memory usage"], ["activity", "green", "ps aux | grep firefox", "Find a running program"],
  ...(PLAT.pkg.info ? [["package", "violet", pkgCmd(PLAT.pkg.info, "firefox", true), "Info about a package"], ["package", "violet", pkgCmd(PLAT.pkg.owner, "/usr/bin/ls", true), "Which package owns this file?"],
  ["list", "blue", pkgCmd(PLAT.pkg.files, "firefox", true), "Files a package installed"]] : []), ["cog", "indigo", "systemctl status bluetooth --no-pager", "Is a service running?"],
  ["network", "teal", "ip -br a", "Network interfaces & addresses"], ["usb", "orange", "lsusb", "USB devices"],
  ["gpu", "violet", "lspci -k | grep -A3 -i vga", "Graphics card and driver"], ["chip", "slate", "uname -a", "Kernel version"],
  ["key", "amber", "chmod +x script.sh", "Make a script runnable"], ["info", "blue", "man ls | head -60", "Manual for any command"],
];
PAGES.terminal = () => pageHead("terminal", "Type any command. ↑ and ↓ cycle through history.") +
  `<div class="term-in"><span class="pr">$</span><input id="cmd" placeholder="e.g. ls -la ~/Downloads" autocomplete="off" spellcheck="false"><button class="btn primary" id="cmdRun">${ic("play")}Run</button><button class="btn" id="cmdKonsole" title="For programs that ask questions or need full screen">${ic("external")}${esc(PLAT.terminal.name)}</button><button class="btn" id="cmdExplain" title="Ask the assistant what this does">${ic("sparkles")}Explain</button><button class="btn" id="cmdSave">${ic("star")}Save</button></div>
  <div style="display:flex;gap:8px;align-items:center;margin-top:10px;color:var(--muted);font-size:12.5px">${ic("folder")}Run in folder <input type="text" id="cwd" class="mono" value="~" style="max-width:320px;padding:4px 9px;font-size:12px"></div>` +
  note(`Commands starting with <code>sudo</code> are switched to <code>pkexec</code>, which shows a password popup. For programs that ask questions or take over the screen (<code>nano</code>, <code>htop</code>, y/n prompts) use <b>${esc(PLAT.terminal.name)}</b>.`) +
  sec(`${ic("star")} Saved commands`) + `<div class="learn" id="favs"></div>` +
  sec(`${ic("bulb")} Learn: common commands`) + `<div class="learn" id="learn">${LEARN.map(([i, c, cmd, d]) => `<button class="lc" data-learn="${esc(cmd)}">${tile(i, c, "soft")}<div><code>${esc(cmd)}</code><p>${esc(d)}</p></div></button>`).join("")}</div>`;
let favs = [], hist = (() => { try { return JSON.parse(localStorage.getItem("hist") || "[]"); } catch { return []; } })(), hi = -1;
function renderFavs() {
  $("#favs").innerHTML = favs.length ? favs.map((f, i) => `<div class="lc" data-fav="${i}">${tile("star", "amber", "soft")}<div style="min-width:0;flex:1"><b>${esc(f.name)}</b><br><code>${esc(f.cmd)}</code></div><div class="favacts"><button class="btn sm primary" data-frun="${i}">${ic("play")}</button><button class="btn sm ghost" data-fdel="${i}">${ic("x")}</button></div></div>`).join("")
    : `<div class="card">${empty("star", "Type a command above and press Save to keep it here.")}</div>`;
}
function termRun() {
  let c = $("#cmd").value.trim(); if (!c) return;
  const lc = c.toLowerCase().replace(/[.!?]+$/, "").replace(/\s+/g, " ");
  if (lc === "whoami" && new Date().getHours() < 5) { Eggs.say("Someone who should be asleep", "It's " + new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + ". Go to bed"); }
  const egg = Eggs.term[lc];
  if (egg) { $("#cmd").value = ""; return Eggs.play(egg[2], egg[0], egg[1]); }
  if (/^sudo\s/.test(c)) { c = c.replace(/^sudo\s+/, "pkexec "); toast("info", "sudo → pkexec", "A password popup will appear"); }
  hist = [c, ...hist.filter(h => h !== c)].slice(0, 100); hi = -1;
  try { localStorage.setItem("hist", JSON.stringify(hist)); } catch {}
  run(c, c.split(" ")[0], { cwd: $("#cwd").value.trim().replace(/^~/, HOME) || undefined });
  $("#cmd").value = "";
}
loaders.terminal = async () => { favs = await api("/api/favorites"); renderFavs(); setTimeout(() => $("#cmd").focus(), 50); };

/* ---------- ASSISTANT ---------- */
const RISK = { read: ["good", "Just looks", "eye"], change: ["warn", "Changes something", "wrench"], danger: ["bad", "Risky", "alert"] };
let CHAT = (() => { try { return JSON.parse(localStorage.getItem("chat") || "[]"); } catch { return []; } })();  // pre-history chats migrate below
const newChatId = () => (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).slice(0, 16);
let CHAT_ID = newChatId();  // every app start opens a new chat; earlier ones stay in History
let assistBusy = false, autoRounds = 0, tipFilter = "All";
CHAT.forEach(m => (m.steps || []).forEach(s => { if (s.status === "running") s.status = "fail"; }));  // interrupted by a restart
const chatTitle = () => (CHAT.find(m => m.role === "user")?.text || "New chat").replace(/\s+/g, " ").slice(0, 70);
const saveChat = debounce(() => {
  try { localStorage.setItem("chatId", CHAT_ID); localStorage.removeItem("chat"); } catch {}
  if (CHAT.some(m => m.role === "user")) api("/api/chat/save", { id: CHAT_ID, title: chatTitle(), messages: CHAT }).catch(() => {});
}, 400);
async function openChat(id) {
  try { const c = await api("/api/chat?id=" + encodeURIComponent(id)); CHAT = c.messages || []; CHAT_ID = id; }
  catch { CHAT = []; CHAT_ID = newChatId(); }
  CHAT.forEach(m => (m.steps || []).forEach(s => { if (s.status === "running") s.status = "fail"; }));
  try { localStorage.setItem("chatId", CHAT_ID); } catch {}
  autoRounds = 0; chatSeen = CHAT.length; renderChat(); $("#main").scrollTop = 0;
}
function newChat() { saveChat(); CHAT = []; chatSeen = 0; CHAT_ID = newChatId(); try { localStorage.setItem("chatId", CHAT_ID); } catch {} renderChat(); Ghost.start(); }
const mdInline = t => esc(t).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
// Tiny, safe markdown: `code`, **bold**, "- " bullet lists, "1." numbered lists, line breaks
function md(s) {
  let html = "", list = null;
  for (const line of String(s ?? "").split("\n")) {
    const ul = line.match(/^\s*[-•*]\s+(.*)/), ol = line.match(/^\s*\d+[.)]\s+(.*)/), item = ul || ol;
    if (item) { const tag = ul ? "ul" : "ol"; if (list !== tag) { if (list) html += `</${list}>`; html += `<${tag}>`; list = tag; } html += `<li>${mdInline(item[1])}</li>`; continue; }
    if (list) { html += `</${list}>`; list = null; }
    html += line.trim() ? mdInline(line) + "<br>" : "<br>";
  }
  if (list) html += `</${list}>`;
  return html.replace(/(<br>)+$/, "").replace(/<br>(<[uo]l>)/g, "$1");
}
// The extra visual parts of an answer: stat cards, table, tip/warning boxes, glossary, links, next questions
function extrasHtml(m) {
  let h = "";
  const hl = (m.highlights || []).filter(x => x.label && x.value);
  if (hl.length) h += `<div class="hl-grid">${hl.map(x => { const tone = { good: "good", warn: "warn", bad: "bad" }[x.tone] || "";
    return `<div class="hl ${tone}"><span class="hl-l">${esc(x.label)}</span><span class="hl-v">${esc(x.value)}</span>${x.detail ? `<span class="hl-d">${mdInline(x.detail)}</span>` : ""}${x.percent >= 0 ? `<div class="meter ${tone}"><i style="width:${Math.min(100, x.percent)}%"></i></div>` : ""}</div>`; }).join("")}</div>`;
  const tb = m.table;
  if (tb && tb.columns?.length && tb.rows?.length) h += `<div class="ans-table">${tb.title ? `<div class="checks-h">${ic("list")}${esc(tb.title)}</div>` : ""}<table class="tbl"><thead><tr>${tb.columns.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${tb.rows.map(r => `<tr>${r.map(c => `<td>${mdInline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  for (const c of m.callouts || []) { const [icon, cls, label] = { tip: ["bulb", "tip", "Tip"], warning: ["alert", "warn", "Careful"], note: ["info", "note", "Note"] }[c.kind] || ["info", "note", "Note"];
    h += `<div class="callout ${cls}">${ic(icon)}<div><b>${label}</b> ${mdInline(c.text)}</div></div>`; }
  if ((m.terms || []).length) h += `<details class="terms"><summary>${ic("bulb")}Words explained <span>(${m.terms.length})</span></summary><dl>${m.terms.map(t => `<dt>${esc(t.term)}</dt><dd>${mdInline(t.meaning)}</dd>`).join("")}</dl></details>`;
  if ((m.links || []).length) h += `<div class="ans-links">${m.links.map(l => `<a class="chip plain" href="${esc(l.url)}" target="_blank" rel="noopener">${ic("external").replace('class="i"', 'class="i" style="width:12px;height:12px"')}${esc(l.title)}</a>`).join("")}</div>`;
  if ((m.followups || []).length) h += `<div class="followups"><span>${ic("sparkles")}You could ask next</span>${m.followups.map(f => `<button data-suggest="${esc(f)}">${mdInline(f)}</button>`).join("")}</div>`;
  return h;
}
PAGES.assistant = () => {
  GUIDES.forEach(g => reg({ title: g.t, desc: g.d, icon: g.i, color: g.c, guide: g.id, kw: "guide fix help" }));
  return pageHead("assistant", "Ask for anything you'd do in a terminal. It explains each step, then runs it for you.", `<button class="btn" id="chatClear">${ic("plus")}New chat</button>`) +
  segHtml("asTabs", [["chat", "Chat", "sparkles"], ["history", "History & memory", "history"], ["guides", "Guided fixes", "wrench"], ["tips", "Tips", "bulb"]], "chat") +
  `<div id="as-chat"><div id="aiNotice"></div><div class="chat" id="chat"></div>
    <div class="composer"><div class="box"><div class="tawrap"><textarea id="asInput" rows="1" placeholder="What do you want to do? e.g. “install VLC” or “why is my Wi-Fi slow?”"></textarea><div class="ghost" id="asGhost" aria-hidden="true"></div></div><button class="btn primary" id="asSend">${ic("arrowup")}Send</button></div>
    <div class="opts"><div class="asopt" data-asopt="aiModel"></div><div class="asopt" data-asopt="assistStyle"></div><span class="optsep"></span><button class="pill" data-pill="autoRunSafe" title="Run steps that only look at things (they change nothing) straight away. Anything that changes your system always waits for you.">${ic("eye")}Auto-check</button><span class="hint"><kbd>Enter</kbd> send · <kbd>Shift</kbd>+<kbd>Enter</kbd> new line<span id="tabHint" class="faded"> · <kbd>Tab</kbd> to fill in</span></span></div></div></div>
  <div id="as-history" class="hidden">
    <div class="field" style="margin-top:4px"><input type="search" id="chatSearch" placeholder="Search past chats…"><button class="btn danger" id="chatDeleteAll">${ic("trash")}Delete all</button></div>
    <div class="group" style="margin-top:12px"><div class="scroll" id="chatList" style="max-height:44vh"></div></div>
    ${sec(`${ic("brain")} What the assistant remembers`)}
    <div class="group">${rowWrap(reg({ title: "Remember things between chats", desc: "Assistant memory", icon: "brain", color: "violet", kw: "memory history" }), "brain", "violet", "Remember things between chats", "Short notes about your setup and what it did, so you don't have to repeat yourself. Stored only on this computer.", `<label class="sw"><input type="checkbox" data-pref="rememberChats"><span></span></label>`)}<div id="memList"></div></div>
  </div>
  <div id="as-guides" class="hidden"><p style="color:var(--muted)">Ready-made step-by-step fixes. They work even without the AI. Every step is explained, and anything that changes your system waits for your OK.</p><div class="actions">${GUIDES.map(g => `<button class="act" data-guide="${g.id}" style="--tc:var(--c-${g.c})">${tile(g.i, g.c)}<div><b>${g.t}</b><small>${g.d}</small></div></button>`).join("")}</div></div>
  <div id="as-tips" class="hidden"><div class="chips" id="tipCats" style="justify-content:flex-start;margin-top:4px"></div><div class="tipgrid" id="tipGrid"></div></div>`;
};
function stepHtml(m, mi, s, si, nextIdx) {
  const [cls, label, ri] = RISK[s.risk] || RISK.change, st = s.status || "pending";
  const num = st === "ok" ? ic("check") : st === "fail" ? ic("x") : st === "running" ? ic("more") : si + 1;
  return `<div class="step s-${st} ${si === nextIdx && !assistBusy ? "next" : ""}"><div class="snum">${num}</div><div class="sbody">
    <div class="shead"><b>${esc(s.title)}</b><span class="chip ${cls}">${label}</span>${s.admin ? `<span class="chip warn">${ic("lock").replace('class="i"', 'class="i" style="width:11px;height:11px"')} password</span>` : ""}${s.terminal ? `<span class="chip plain">needs a terminal</span>` : ""}</div>
    <div class="swhy">${md(s.why)}</div>
    ${(s.warnings || []).map(w => `<div class="swarn ${w.kind}">${ic((HARM[w.kind] || HARM.system)[1])}${esc(w.text)}</div>`).join("")}
    <div class="scmd"><code>$ ${esc(s.cmd)}</code><button class="btn sm" data-copy="${esc(s.cmd)}" title="Copy">${ic("copy")}</button></div>
    ${st === "pending" ? `<div class="sacts"><button class="btn sm ${s.risk === "danger" ? "danger" : "primary"}" data-srun="${mi}:${si}">${ic(s.terminal ? "external" : "play")}${s.terminal ? "Open in Konsole" : "Run"}</button><button class="btn sm ghost" data-sskip="${mi}:${si}">Skip</button></div>` : ""}
    ${st === "running" ? `<div class="sacts"><button class="btn sm" data-sstop="${mi}:${si}">${ic("stop")}Stop</button></div>` : ""}
    ${s.output || st === "running" ? `<details class="sres" data-k="${mi}:${si}" ${st === "running" || s.open !== false ? "open" : ""}><summary>${ic("chevright")}Result${st === "running" ? " (running…)" : st === "ok" ? "" : s.code != null ? ` (error ${s.code}${(s.code === 126 || s.code === 127) && s.admin ? ", password cancelled?" : ""})` : ""}</summary><pre class="sout" id="out-${mi}-${si}">${esc(cleanText(s.output || "Running…").slice(-20000)) || "(no output)"}</pre></details>` : ""}
  </div></div>`;
}
// Quick checks: the commands behind an answer, each with its output one click away
function checksHtml(q, qi, live) {
  return `<div class="checks"><div class="checks-h">${ic("terminal")}${live ? "Checking…" : "How I checked"}</div>` + q.steps.map((s, si) => {
    const st = s.status || "pending", icon = st === "ok" ? ic("check") : st === "fail" ? ic("x") : st === "running" ? '<span class="spin"></span>' : ic("more");
    return `<details class="check s-${st}" data-k="${qi}:${si}" ${st === "running" || s.open ? "open" : ""}><summary><span class="ck-i">${icon}</span><code>$ ${esc(s.cmd)}</code><span class="ck-t">${esc(s.title)}</span><button class="btn sm ghost icon" data-copy="${esc(s.cmd)}" title="Copy command">${ic("copy")}</button>${ic("chevdown").replace('class="i"', 'class="i ck-c"')}</summary><pre class="sout" id="out-${qi}-${si}">${esc(cleanText(s.output || (st === "running" ? "Running…" : "(no output)")).slice(-20000))}</pre></details>`;
  }).join("") + `</div>`;
}
// A few random ideas from the big list (the typing box shows the rest)
function ideaChips() {
  const pick = SUGGESTIONS.map(s => [Math.random(), s]).sort((a, b) => a[0] - b[0]).slice(0, 6).map(x => x[1]);
  return pick.map(s => `<button data-suggest="${esc(s)}">${md(s)}</button>`).join("");
}
let chatSeen = 0;  // messages already shown (only newer ones animate in)
function renderChat(opts = {}) {
  const box = $("#chat"); if (!box) return;
  if (!CHAT.length) {
    box.innerHTML = `<div class="welcome">${tile("sparkles", "violet")}<h2>What would you like to do?</h2><p>Describe it in your own words. I'll explain the steps and run them for you.</p>
      <div class="chips" id="ideaChips">${ideaChips()}</div>
      <button class="btn sm ghost" id="moreIdeas" style="margin-top:10px">${ic("refresh")}Show other ideas</button>
      <p style="margin:18px 0 10px">Or start a guided fix:</p><div class="chips">${GUIDES.slice(0, 4).map(g => `<button data-guide="${g.id}">${g.t}</button>`).join("")}<button data-tab-guides>More…</button></div></div>`;
    return;
  }
  box.innerHTML = CHAT.map((m, mi) => {
    if (m.role === "user") return `<div class="msg me" data-mi="${mi}">${md(m.text)}</div>`;
    if (m.role === "results") return m.quiet ? "" : `<div class="msg sys">${ic("upload")}Sent the results to the assistant</div>`;
    if (m.answeredBy != null && CHAT[m.answeredBy]) return "";  // shown attached to its answer instead
    if (m.quick) return `<div class="msg ai" data-mi="${mi}"><img src="/web/app-icon.svg" alt=""><div class="body"><div class="text checking">${md(m.reply)}</div>${checksHtml(m, mi, m.steps.some(s => s.status !== "ok" && s.status !== "fail"))}</div></div>`;
    if (m.role === "error") return `<div class="msg err">${ic("alertcircle")}<div>${md(m.text)}${["setup", "sdk", "auth", "model", "limit"].includes(m.code) ? `<div style="margin-top:8px"><button class="btn sm primary" data-ai-setup>${ic("cog")}AI settings</button></div>` : ""}</div></div>`;
    const nextIdx = (m.steps || []).findIndex(s => (s.status || "pending") === "pending");
    const ran = (m.steps || []).some(s => s.status === "ok" || s.status === "fail");
    const resolved = nextIdx < 0 && !(m.steps || []).some(s => s.status === "running");
    const pg = m.page && PAGEINFO[m.page] ? `<button class="btn sm" data-nav="${m.page}">${ic(PAGEINFO[m.page].i)}Open ${PAGEINFO[m.page].t}</button>` : "";
    return `<div class="msg ai" data-mi="${mi}"><img src="/web/app-icon.svg" alt=""><div class="body">
      ${m.role === "guide" ? `<div class="label">${ic("wrench")}Guided fix</div>` : ""}${m.offTopic ? `<div class="label">${ic("info")}Linux help only</div>` : ""}
      <div class="text">${m.html ? m.reply : md(m.reply)}</div>
      ${extrasHtml(m)}
      ${SETTINGS.devMode && SETTINGS.devRawAnswers && m.raw ? `<details class="devraw"><summary>${ic("code")}Raw answer${m.model ? " · " + esc(m.model) : ""}</summary><pre>${esc(JSON.stringify(m.raw, null, 1))}</pre></details>` : ""}
      ${m.checks != null && CHAT[m.checks]?.steps ? checksHtml(CHAT[m.checks], m.checks, false) : ""}
      ${(m.steps || []).length ? `<div class="steps">${m.steps.map((s, si) => stepHtml(m, mi, s, si, nextIdx)).join("")}</div>` : ""}
      <div class="meta">${pg}${resolved && ran && !m.sent ? `<button class="btn sm primary" data-explain="${mi}">${ic("sparkles")}Explain the results</button>` : ""}${SETTINGS.showCost && (m.cost != null || m.tokens) ? `<span title="${esc(m.model || "")}">${m.seconds}s · ${m.cost != null ? "~$" + m.cost.toFixed(3) : (m.tokens / 1000).toFixed(1) + "k tokens"}</span>` : ""}${(m.remembered || []).length ? `<span class="chip accent plain" title="${esc(m.remembered.join("\n"))}" style="cursor:pointer" data-goto-memory>${ic("brain").replace('class="i"', 'class="i" style="width:12px;height:12px"')} Remembered: ${esc(m.remembered[0])}${m.remembered.length > 1 ? ` (+${m.remembered.length - 1})` : ""}</span>` : ""}</div>
    </div></div>`;
  }).join("") + (assistBusy ? `<div class="msg ai"><img src="/web/app-icon.svg" alt=""><div class="body"><div class="text typing"><i></i><i></i><i></i></div></div></div>` : "");
  $$("#chat [data-mi]").forEach(el => { if (+el.dataset.mi >= chatSeen) el.classList.add("msg-new"); });
  $("#chat .typing")?.closest(".msg")?.classList.add("msg-new");
  chatSeen = Math.max(chatSeen, CHAT.length);
  if (CUR !== "assistant") return;
  const main = $("#main");
  if (opts.focus != null) {  // bring the start of a new answer into view
    const el = box.querySelector(`[data-mi="${opts.focus}"]`);
    if (el) main.scrollTo({ top: el.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop - 18, behavior: "smooth" });
  } else if (opts.bottom) main.scrollTo({ top: main.scrollHeight, behavior: "smooth" });
}
async function streamRun(cmd, onText, id) {
  const r = await fetch("/api/run", { method: "POST", headers: { "X-Token": TOKEN, "Content-Type": "application/json" }, body: JSON.stringify({ cmd, id }) });
  const reader = r.body.getReader(), dec = new TextDecoder(); let text = "";
  for (;;) { const { value, done } = await reader.read(); if (done) break; text += dec.decode(value, { stream: true }); onText(text.replace(/\n\x00EXIT:-?\d+$/, "")); }
  const m = text.match(/\n\x00EXIT:(-?\d+)$/);
  return { code: m ? +m[1] : -1, text: text.replace(/\n\x00EXIT:-?\d+$/, "") };
}
async function runStep(mi, si, { auto = false } = {}) {
  const m = CHAT[mi], s = m.steps[si];
  if (s.terminal) {
    launch(termRunCmd(s.cmd));
    s.status = "ok"; s.code = 0; s.output = `Opened in ${PLAT.terminal.name}. Follow along there.`; s.konsole = true; renderChat(); saveChat(); return;
  }
  if (!auto && !(await warnGate(s.cmd, s.title, { force: s.risk === "danger", why: s.why }))) return;
  s.status = "running"; s.output = ""; s.jobId = Math.random().toString(36).slice(2); renderChat();
  const r = await streamRun(s.cmd, txt => { s.output = txt; const el = $(`#out-${mi}-${si}`); if (el) { el.textContent = cleanText(txt).slice(-20000); el.scrollTop = el.scrollHeight; } }, s.jobId);
  s.code = r.code; s.output = r.text; s.status = r.code === 0 ? "ok" : "fail";
  logActivity("Assistant: " + s.title, s.cmd, r.code === 0, r.text);
  renderChat(); saveChat();
}
async function advance(mi) {
  const m = CHAT[mi]; if (!m?.steps) return;
  for (;;) {
    const si = m.steps.findIndex(s => (s.status || "pending") === "pending");
    if (si < 0) break;
    const s = m.steps[si];
    if (s.risk === "read" && !s.terminal && SETTINGS.autoRunSafe) { await runStep(mi, si, { auto: true }); continue; }
    return renderChat();  // wait for the user to run or skip this one
  }
  const ran = m.steps.some(s => (s.status === "ok" || s.status === "fail") && !s.konsole);
  if (ran && !m.sent && SETTINGS.autoExplain && autoRounds < 4) sendResults(mi);
  else renderChat();
}
function resultsText(m) {
  return m.steps.map((s, i) => `Step ${i + 1} "${s.title}": \`${s.cmd}\`\n` + (s.status === "skipped" ? "(skipped by the user)" : s.konsole ? "(opened in a terminal; output not captured)" : `exit code ${s.code}\n${cleanText(s.output || "(no output)").slice(-2500)}`)).join("\n\n");
}
function sendResults(mi, manual = false) {
  const m = CHAT[mi]; m.sent = true; autoRounds = manual ? 0 : autoRounds + 1;
  CHAT.push({ role: "results", text: resultsText(m), quiet: !!m.quick, of: mi }); askAssistant();
}
async function askAssistant() {
  if (!aiReady()) return goAISetup();
  const last = CHAT.at(-1), answering = last?.role === "results" && last.quiet ? last.of : null;
  assistBusy = true; renderChat({ bottom: last?.role === "user" });  // show your message and the typing dots
  const msgs = CHAT.filter(m => ["user", "assistant", "guide", "results"].includes(m.role)).map(m =>
    m.role === "assistant" || m.role === "guide" ? { role: "assistant", text: (m.html ? m.reply.replace(/<[^>]+>/g, "") : m.reply) + (m.steps?.length ? "\nSteps proposed: " + m.steps.map((s, i) => `${i + 1}. ${s.title}: \`${s.cmd}\``).join("; ") : "") } : { role: m.role, text: m.text });
  const t0 = Date.now();
  let r; try { r = await api("/api/assist", { messages: msgs, memory: !!SETTINGS.rememberChats, style: SETTINGS.assistStyle, effort: SETTINGS.assistEffort, }); } catch (e) { r = { error: "Couldn't reach the assistant: " + e.message }; }
  assistBusy = false;
  if (!r.error) notifyIfAway("The assistant answered", r.reply || "", t0);
  if (r.error) { if (r.code === "setup") refreshAI().then(renderAINotice); CHAT.push({ role: "error", text: r.error, code: r.code }); renderChat({ focus: CHAT.length - 1 }); saveChat(); return; }
  const steps = (r.steps || []).map(s => ({ ...s, status: "pending" }));
  // Only-looking steps that the app will run and explain by itself: show them as a quick check under the answer
  const quick = steps.length > 0 && !r.done && steps.every(s => s.risk === "read" && !s.terminal) && SETTINGS.autoRunSafe && SETTINGS.autoExplain && autoRounds < 4;
  CHAT.push({ role: "assistant", reply: r.reply, steps, quick, checks: answering, page: r.page, cost: r.cost, tokens: r.tokens, seconds: r.seconds, done: r.done, offTopic: !!r.off_topic, remembered: (r.remembered || []).map(x => x.text),
    highlights: r.highlights, table: r.table, callouts: r.callouts, terms: r.terms, links: r.links, followups: r.followups, model: r.model, raw: SETTINGS.devRawAnswers ? r : undefined });
  if (answering != null && CHAT[answering]) CHAT[answering].answeredBy = CHAT.length - 1;
  saveChat(); renderChat({ focus: CHAT.length - 1 }); advance(CHAT.length - 1);
}
function sendUser(text) {
  text = text.trim(); if (!text || assistBusy) return;
  if (Eggs.try(text)) return;
  if (!aiReady()) return goAISetup();
  autoRounds = 0; CHAT.push({ role: "user", text }); saveChat(); askAssistant();
}
function askAbout(text) { if (!aiReady()) return goAISetup(); location.hash = "assistant"; asTab("chat"); setTimeout(() => sendUser(text), 50); }
function startGuide(id) {
  const g = GUIDES.find(x => x.id === id); if (!g) return;
  location.hash = "assistant"; asTab("chat"); autoRounds = 0;
  CHAT.push({ role: "user", text: g.t });
  CHAT.push({ role: "guide", reply: g.d + ". Here's the plan. Steps marked “Just looks” only read information.", steps: g.steps.map(s => ({ ...s, admin: s.cmd.includes("pkexec"), terminal: false, status: "pending" })) });
  saveChat(); renderChat({ focus: CHAT.length - 2 }); advance(CHAT.length - 1);
}
function tryTip(i) {
  const t = TIPS[i]; location.hash = "assistant"; asTab("chat"); autoRounds = 0;
  CHAT.push({ role: "user", text: "Show me: " + t.t });
  CHAT.push({ role: "guide", html: true, reply: t.d, steps: [{ title: "Try it", cmd: t.cmd, why: "This command only looks. It doesn't change anything.", risk: "read", status: "pending" }] });
  saveChat(); renderChat(); advance(CHAT.length - 1);
}
function renderTips() {
  const cats = ["All", ...new Set(TIPS.map(t => t.cat))];
  $("#tipCats").innerHTML = cats.map(c => `<button data-tipcat="${c}" style="${c === tipFilter ? "border-color:var(--accent);color:var(--accent);font-weight:600" : ""}">${c}</button>`).join("");
  $("#tipGrid").innerHTML = TIPS.map((t, i) => [t, i]).filter(([t]) => tipFilter === "All" || t.cat === tipFilter).map(([t, i]) => tipCard(t, i)).join("");
}
const tipCard = (t, i) => `<div class="card tipc"><span class="cat">${t.cat}</span><b>${t.t}</b><p>${t.d}</p><div class="acts2">${t.cmd ? `<button class="btn sm primary" data-trytip="${i}">${ic("play")}Try it</button>` : ""}${t.page ? `<button class="btn sm" data-nav="${t.page}">${ic(PAGEINFO[t.page].i)}${PAGEINFO[t.page].t}</button>` : ""}</div></div>`;
let CHATS = [];
async function renderHistory() {
  CHATS = await api("/api/chats");
  const f = ($("#chatSearch").value || "").toLowerCase();
  const when = t => { const d = new Date(t * 1000), now = new Date(); return d.toDateString() === now.toDateString() ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" }); };
  const rows = CHATS.filter(c => !f || c.title.toLowerCase().includes(f));
  $("#chatList").innerHTML = rows.length ? rows.map(c => `<div class="row" style="min-height:52px">${tile("sparkles", c.id === CHAT_ID ? "violet" : "slate", "soft")}<div class="txt"><b>${esc(c.title)}</b><small>${when(c.updated)} · ${c.count} message${c.count === 1 ? "" : "s"}${c.id === CHAT_ID ? " · open now" : ""}</small></div><div class="ctl"><button class="btn sm" data-open-chat="${c.id}">Open</button><button class="btn sm ghost" data-del-chat="${c.id}" title="Delete">${ic("trash")}</button></div></div>`).join("")
    : empty("history", f ? "No chats match." : "No past chats yet. They'll show up here.");
  const mem = await api("/api/memory");
  $("#memList").innerHTML = mem.length ? mem.map((m, i) => [m, i]).reverse().map(([m, i]) => `<div class="row" style="min-height:44px">${tile("brain", "violet", "soft")}<div class="txt"><b style="font-weight:500">${esc(m.text)}</b><small>Learned ${esc(m.date)}</small></div><div class="ctl"><button class="btn sm ghost" data-forget="${i}" title="Forget this">${ic("x")}</button></div></div>`).join("") +
    `<div class="row" style="min-height:44px;justify-content:flex-end"><button class="btn sm danger" id="forgetAll">${ic("trash")}Forget everything</button></div>`
    : `<div class="row">${tile("brain", "violet", "soft")}<div class="txt"><b style="font-weight:500">Nothing remembered yet</b><small>As you use the assistant it notes lasting things about your setup here</small></div></div>`;
}
let asTab = () => {};
loaders.assistant = () => {
  refreshAI().then(() => { renderAINotice(); renderAsOpts(); if (!aiReady() && !$("#as-chat")?.classList.contains("hidden") && !loaders.assistant.sent) { loaders.assistant.sent = true; goAISetup(); } });
  renderChat(); applySettings(); setTimeout(() => $("#asInput")?.focus(), 50); Ghost.start();
  loadAISuggestions();
  api("/api/chats").then(list => Complete.learn([...CHAT.filter(m => m.role === "user").map(m => m.text).reverse(), ...list.map(c => c.title)])).catch(() => {});
};
leavers.assistant = () => Ghost.stop();

// The "Tab to fill in" hint fades in and out without changing the layout, so the box never moves
const tabHint = show => $("#tabHint")?.classList.toggle("faded", !show);

/* The empty message box "types" suggestions like a person would: uneven speed,
   pauses at spaces and punctuation, the odd slip of the finger that gets backspaced. */
const Ghost = (() => {
  const NEAR = { a: "qsz", b: "vgn", c: "xdv", d: "sfe", e: "wrd", f: "dgr", g: "fht", h: "gjy", i: "uok", j: "hku", k: "jli", l: "ko", m: "nk", n: "bmj",
    o: "ipl", p: "ol", q: "wa", r: "etf", s: "adw", t: "ryg", u: "yij", v: "cfb", w: "qes", x: "zcs", y: "tuh", z: "xa" };
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let run = 0, idle = null, shown = "", target = "", order = [];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const box = () => $("#asInput"), el = () => $("#asGhost");
  const draw = typing => { const g = el(); if (!g) return; g.classList.toggle("typing", typing); g.innerHTML = esc(shown) + '<span class="caret"></span>'; };
  const alive = id => id === run && CUR === "assistant" && !box()?.value && !document.hidden && !$("#as-chat")?.classList.contains("hidden") && !$("#as-chat")?.classList.contains("ai-off");
  async function wait(ms, id) {
    await new Promise(r => setTimeout(r, ms));
    if (alive(id)) return true;
    if (id === run) stop();
    return false;
  }
  async function type(ch, id) {
    shown += ch; draw(true);
    let ms = rnd(45, 125) * (Math.random() < .15 ? 1.8 : 1);       // uneven rhythm, some slower keys
    if (ch === " ") ms += rnd(30, 140);
    if (/[,.?!]/.test(ch)) ms += rnd(180, 420);
    if (Math.random() < .04) ms += rnd(300, 800);                  // a little "thinking" pause
    return wait(ms, id);
  }
  async function backspace(n, id, fast) {
    for (let i = 0; i < n; i++) {
      shown = shown.slice(0, -1); draw(true);
      // holding backspace: slow first presses, then key repeat kicks in
      if (!(await wait(fast ? (i < 3 ? rnd(110, 160) : rnd(22, 42)) : rnd(70, 120), id))) return false;
    }
    return true;
  }
  async function loop(id) {
    while (alive(id)) {
      if (!order.length) order = SUGGESTIONS.map((_, i) => i).sort(() => Math.random() - .5);
      target = SUGGESTIONS[order.pop()];
      for (let i = 0; i < target.length; i++) {
        const ch = target[i], lower = ch.toLowerCase();
        if (NEAR[lower] && i > 2 && Math.random() < .045) {           // slip onto a neighbouring key...
          let typo = NEAR[lower][Math.floor(Math.random() * NEAR[lower].length)];
          if (ch !== lower) typo = typo.toUpperCase();
          if (!(await type(typo, id))) return;
          const late = Math.floor(rnd(0, 3));                          // ...maybe notice a couple of letters late
          let k = 0;
          for (; k < late && i + 1 + k < target.length && target[i + 1 + k] !== " "; k++) if (!(await type(target[i + 1 + k], id))) return;
          if (!(await wait(rnd(160, 380), id))) return;
          if (!(await backspace(k + 1, id, false))) return;
        }
        if (!(await type(ch, id))) return;
      }
      draw(false);
      if (!(await wait(rnd(1700, 2800), id))) return;                 // let it be read
      if (!(await backspace(shown.length, id, true))) return;
      draw(false);
      if (!(await wait(rnd(450, 900), id))) return;
    }
  }
  function stop() { run++; clearTimeout(idle); shown = ""; target = ""; const g = el(); if (g) { g.innerHTML = ""; g.parentElement.classList.remove("ghosting"); tabHint(false); } if (box()) box().placeholder = asPlaceholder(); }
  function start(delay = 1200) {
    stop(); if (reduced || SETTINGS.reduceMotion || box()?.value) return;
    const id = run;
    idle = setTimeout(() => { if (!alive(id)) return; box().placeholder = ""; el().parentElement.classList.add("ghosting"); tabHint(true); draw(false); loop(id); }, delay);
  }
  // Tab puts the whole suggestion in the box
  function accept() { if (!target || box().value) return false; box().value = target; stop(); box().dispatchEvent(new Event("input")); return true; }
  return { start, stop, accept };
})();

/* Live autocomplete while typing: the rest of a likely sentence shows in gray after
   the cursor; Tab (or →) fills it in. Purely local and instant - no AI involved. */
const Complete = (() => {
  let pool = null, words = null, cand = "", comp = "", dismissed = "", past = [], aiPhrases = [], fromAI = false;
  const aiCache = new Map(); let aiTimer = null, aiSeq = 0;
  const box = () => $("#asInput"), el = () => $("#asGhost");
  // "can you", "please", "how do I"… at the start don't change what someone wants, so match without them
  const FILLER = /^(?:(?:can|could|would|will) you(?: please)?|please|pls|plz|help me(?: to)?|i (?:want|need|would like|'d like|wanna) to|i wanna|how (?:do|can|would|should) i|how to|is there a way to|(?:show|tell|teach) me how to|i'm trying to|im trying to|lets|let's)\s+/i;
  const core = t => { let c = t, prev; do { prev = c; c = c.replace(FILLER, ""); } while (c !== prev); return c; };
  function build() {
    const seen = new Set(); pool = [];
    for (const p of [...past, ...aiPhrases, ...SUGGESTIONS, ...COMPLETE_PHRASES]) { const k = p.toLowerCase(); if (!seen.has(k)) { seen.add(k); const c = core(p); pool.push([p, c.toLowerCase(), c]); } }
    const freq = {};
    for (const [p] of pool) for (const w of p.toLowerCase().match(/[a-z][a-z0-9.+-]{3,}/g) || []) freq[w] = (freq[w] || 0) + 1;
    for (const w of COMPLETE_WORDS) freq[w] = (freq[w] || 0) + 1;
    words = Object.keys(freq).sort((a, b) => freq[b] - freq[a]);
  }
  function learn(texts) { past = [...new Set(texts.map(t => String(t).trim()).filter(t => t.length > 3 && t.length < 90 && !t.includes("\n")))]; pool = null; }
  function addPhrases(list) { aiPhrases = list || []; pool = null; }
  function find(v) {
    const lv = v.toLowerCase();
    if (cand && cand.toLowerCase().startsWith(lv) && cand.length > v.length) return cand.slice(v.length);  // keep it steady
    if (!pool) build();
    cand = ""; fromAI = false;
    if (v.trim().length >= 2) {
      const hit = pool.find(([p]) => p.length > v.length && p.toLowerCase().startsWith(lv));
      if (hit) { cand = hit[0]; return hit[0].slice(v.length); }
      const c = core(v).toLowerCase();  // e.g. "can you install sp" -> "install sp" -> "Install Spotify"
      if (c.length >= 3 && c !== lv) { const h2 = pool.find(([, pc]) => pc.length > c.length && pc.startsWith(c)); if (h2) return h2[2].slice(c.length); }  // keep the phrase's own capitals
    }
    for (const [base, ai] of aiCache) if (ai && (base + ai).toLowerCase().startsWith(lv) && (base + ai).length > v.length) { fromAI = true; return (base + ai).slice(v.length); }
    const part = (v.match(/([a-zA-Z][a-zA-Z0-9.+-]*)$/) || [])[1];  // finish just the current word
    if (part && part.length >= 3) { const w = words.find(w => w.length > part.length && w.startsWith(part.toLowerCase())); if (w) return w.slice(part.length); }
    return "";
  }
  function askAI(v) {
    clearTimeout(aiTimer);
    if (!SETTINGS.aiComplete || v.trim().length < 8 || aiCache.has(v) || /[.?!]$/.test(v.trim())) return;
    aiTimer = setTimeout(async () => {
      const seq = ++aiSeq;
      let r; try { r = await api("/api/complete", { text: v }); } catch { return; }
      aiCache.set(v, r.completion || "");
      if (seq === aiSeq && box().value.toLowerCase().startsWith(v.toLowerCase())) update();
    }, 900);  // only after you pause
  }
  function update() {
    const t = box(), g = el(); if (!t || !g) return;
    const v = t.value, atEnd = t.selectionStart === v.length && t.selectionEnd === v.length;
    comp = v && atEnd && v !== dismissed ? find(v) : "";
    if (comp && /\s$/.test(v) && /^\s/.test(comp)) comp = comp.trimStart();
    g.innerHTML = comp ? `<span class="typed">${esc(v)}</span><span class="comp${fromAI ? " ai" : ""}">${esc(comp)}</span>` : "";
    g.scrollTop = t.scrollTop;
    tabHint(!!comp);
    if (!comp && v && atEnd && v !== dismissed) askAI(v); else clearTimeout(aiTimer);
  }
  function accept() {
    if (!comp) return false;
    const t = box(); t.value += comp; comp = ""; cand = "";
    t.setSelectionRange(t.value.length, t.value.length);
    t.dispatchEvent(new Event("input"));
    return true;
  }
  function dismiss() { dismissed = box().value; clearTimeout(aiTimer); update(); }
  function clear() { comp = ""; cand = ""; dismissed = ""; clearTimeout(aiTimer); const g = el(); if (g && !g.parentElement.classList.contains("ghosting")) g.innerHTML = ""; }
  return { update, accept, dismiss, clear, learn, addPhrases, active: () => !!comp };
})();

let aiSuggest = null, aiSuggestBusy = false;
async function loadAISuggestions(force = false) {
  if (!aiSuggest) aiSuggest = await api("/api/suggestions").catch(() => ({ phrases: [] }));
  if ((force || !aiSuggest.phrases?.length) && SETTINGS.aiComplete && !aiSuggestBusy && (AI || await refreshAI().catch(() => null), AI?.configured)) {
    aiSuggestBusy = true; renderSuggestInfo();
    const r = await api("/api/suggestions/generate", {}).catch(e => ({ error: e.message }));
    aiSuggestBusy = false;
    if (r.error) { if (force) toast("fail", "Couldn't make new suggestions", r.error); } else { aiSuggest = r; if (force) toast("ok", `${r.added} new suggestions added (${r.phrases.length} in total)`); }
  }
  const ai = aiSuggest.phrases || [];
  Complete.addPhrases(ai);
  for (const p of ai) if (!SUGGESTIONS.includes(p)) SUGGESTIONS.push(p);  // also used by the typing animation and idea buttons
  renderSuggestInfo();
}
function renderSuggestInfo() {
  const el = $("#suggestInfo"); if (!el) return;
  el.textContent = aiSuggestBusy ? "Making suggestions for your computer… (about a minute)" : aiSuggest?.phrases?.length ? `${aiSuggest.phrases.length} made for this computer on ${aiSuggest.date}` : "Not made yet";
}

/* Answer length and thinking: small dropdown pills under the message box */
const AS_OPTS = {
  assistStyle: { label: "Answers", options: [
    ["short", "Short", "list", "Just what you need to know"],
    ["medium", "Normal", "file", "A little more on why each step matters"],
    ["detailed", "Explain more", "bulb", "The why behind every step and what to expect"]] },
  assistEffort: { label: "Thinking", options: [
    ["low", "Fast", "zap", "Quickest replies, for simple questions"],
    ["medium", "Mid", "gauge", "Good for most tasks"],
    ["high", "Smart", "brain", "Takes longer, best for tricky problems"]] },
};
// the model menu lists the connected AI's own sizes (Gemini: Flash Lite, Flash, Pro; Claude: Haiku, Sonnet, Opus, Fable…)
const shortModel = m => String(m || "").replace(/^models\//, "").replace(/^claude-/, "").replace(/-(\d+)-(\d+)$/, " $1.$2");
const AI_SHORT = { anthropic: "Claude", openai: "GPT", gemini: "Gemini", mistral: "Mistral", deepseek: "DeepSeek", xai: "" };
const aiNow = () => { if (!AI?.configured) return "no AI"; const t = AI.tiers?.find(x => x.model === AI.model), sh = AI_SHORT[AI.provider];
  return t ? [sh, t.label].filter(Boolean).join(" ") : `${AI.providers[AI.provider].name} · ${shortModel(AI.model)}`; };
function asOpt(key) {
  if (key !== "aiModel") return { ...AS_OPTS[key], value: SETTINGS[key] };
  const opts = (AI?.tiers || []).map(t => [t.model, esc(t.label), t.icon, esc(`${t.desc} · ${t.model}`)]);
  if (AI?.model && !opts.some(o => o[0] === AI.model)) opts.push([AI.model, esc(shortModel(AI.model)), "cog", "The model you picked in settings"]);
  opts.forEach(o => o[4] = esc(key === "aiModel" ? [AI_SHORT[AI.provider], AI.tiers?.find(t => t.model === o[0])?.label].filter(Boolean).join(" ") || o[1] : o[1]));
  return { label: `${AI?.providers?.[AI.provider]?.name || "AI"} model`, options: opts, value: AI?.model, foot: `<button class="asmenu-it" data-ai-setup>${tile("cog", "slate", "soft")}<div><b>Other models & providers…</b><small>Dashboard settings → Assistant</small></div></button>` };
}
function renderAsOpts() {
  $$("[data-asopt]").forEach(box => {
    const key = box.dataset.asopt;
    // hide what doesn't apply: no model menu without an AI, no thinking level for models that don't take one
    const hide = key === "aiModel" ? !AI?.configured : key === "assistEffort" ? AI?.configured && !AI.effort : false;
    box.classList.toggle("hidden", hide); if (hide) { box.innerHTML = ""; return; }
    const o = asOpt(key); if (!o.options.length) { box.innerHTML = ""; return; }
    const cur = o.options.find(x => x[0] === o.value) || o.options[0], open = box.classList.contains("open");
    box.innerHTML = `<button class="pill on" data-asopen="${key}" title="${o.label}">${ic(cur[2])}${cur[4] || cur[1]}${ic("chevdown").replace('class="i"', 'class="i chev"')}</button>
      ${open ? `<div class="asmenu"><div class="asmenu-h">${o.label}</div>${o.options.map(([v, l, i, d]) => `<button class="asmenu-it ${v === cur[0] ? "on" : ""}" data-aspick="${key}" data-v="${v}">${tile(i, v === cur[0] ? "violet" : "slate", "soft")}<div><b>${l}</b><small>${d}</small></div>${v === cur[0] ? ic("check") : ""}</button>`).join("")}${o.foot || ""}</div>` : ""}`;
  });
}

/* tip of the day on Home */
let tipIdx = Math.floor(Date.now() / 864e5) % TIPS.length;
function renderHomeTip() {
  const t = TIPS[tipIdx], el = $("#home-tip"); if (!el) return;
  el.innerHTML = `${tile("bulb", "amber")}<div class="txt"><b>Tip: ${t.t}</b><p>${t.d}</p></div><div class="acts2">${t.cmd ? `<button class="btn sm" data-trytip="${tipIdx}">${ic("play")}Try it</button>` : ""}<button class="btn sm ghost" id="tipNext" title="Another tip">${ic("chevright")}</button><button class="btn sm ghost" data-alltips>All tips</button></div>`;
}

/* ---------- MOUSE & TOUCHPAD ---------- */
PAGES.mouse = () => pageHead("mouse", "Pointer speed, scrolling and buttons. Changes apply instantly.") +
  `<div class="note" id="mouseDevs">${ic("pointer")}<div>Looking for your mouse…</div></div>` +
  group(sld("mouse_speed", "pointer", "teal", "Pointer speed", "How far the pointer moves when you move the mouse", { min: -1, max: 1, step: 0.05, kw: "sensitivity dpi" }),
    sld("mouse_scroll", "sort", "blue", "Scroll speed", "How far one wheel click scrolls", { min: 0.25, max: 3, step: 0.25, kw: "wheel" }),
    tog("mouse_natural", "arrowdown", "indigo", "Natural scrolling", "Content follows your fingers, like a phone (reversed wheel)"),
    tog("mouse_lefthanded", "click", "orange", "Left-handed", "Swap the left and right buttons"),
    tog("mouse_flat", "gauge", "red", "Precise pointer (no acceleration)", "Moves exactly as far as your hand. Great for games and drawing", { kw: "acceleration gaming raw" })) +
  note(feat("gnome") && !feat("kde") ? `These go straight to GNOME, the same as Settings → Mouse & Touchpad. They're saved, so they stay after a restart.` : `These go straight to KDE, the same as System Settings → Mouse. They're saved, so they stay after a restart.`);
loaders.mouse = async () => { await loadCtl(); const p = CTL._pointers || []; $("#mouseDevs div").innerHTML = p.length ? `Applies to: <b>${p.map(esc).join("</b>, <b>")}</b>` : "No mouse or touchpad found."; };

/* ---------- PANEL & TASKBAR ---------- */
const WIDGET_NAMES = { kickoff: ["App launcher", "grid", "blue"], kicker: ["App launcher", "grid", "blue"], pager: ["Virtual desktops", "layers", "violet"], icontasks: ["Taskbar", "panel", "indigo"],
  taskmanager: ["Taskbar", "panel", "indigo"], marginsseparator: ["Spacer", "width", "slate"], panelspacer: ["Spacer", "width", "slate"], systemtray: ["System tray", "bell", "teal"],
  digitalclock: ["Clock", "clock", "orange"], showdesktop: ["Show desktop", "monitor", "cyan"], notes: ["Sticky note", "file", "amber"], weather: ["Weather", "weather", "cyan"] };
PAGES.panel = () => !feat("panel") ? panelOther() : pageHead("panel", "The bar along the edge of your screen: where it sits, how it looks, what's on it.") +
  `<div class="group"><div class="pprev" id="pprev"><div class="win"></div><div class="bar" id="pbar"><i></i><i></i><i></i><i></i><i></i><i></i></div><span class="hint">Preview</span></div></div>` +
  sec("Layout") + group(
    segCtl("panel_location", "panel", "violet", "Position", "Which edge of the screen", [["bottom", "Bottom"], ["top", "Top"], ["left", "Left"], ["right", "Right"]], { kw: "move taskbar" }),
    sld("panel_height", "height", "blue", "Thickness", "How tall the panel is", { min: 24, max: 96, step: 2, commit: true, kw: "size height" }),
    segCtl("panel_length", "width", "teal", "Width", "Stretch across the screen or just fit the icons", [["fill", "Full width"], ["fit", "Fit content"]]),
    segCtl("panel_alignment", "align", "cyan", "Alignment", "Where it sits when not full width", [["left", "Left"], ["center", "Center"], ["right", "Right"]])) +
  sec("Look & behavior") + group(
    tog("panel_floating", "float", "indigo", "Floating", "Lifts the panel off the edge with rounded corners"),
    sel("panel_hiding", "hide", "slate", "Visibility", "Hide the panel to get more screen space", [["none", "Always visible"], ["autohide", "Auto-hide"], ["dodgewindows", "Dodge windows"], ["windowsgobelow", "Windows can cover it"]], { kw: "autohide auto hide" }),
    segCtl("panel_opacity", "opacity", "pink", "Transparency", "", [["adaptive", "Adaptive"], ["opaque", "Solid"], ["translucent", "See-through"]])) +
  sec("Clock") + group(
    tog("clock_seconds", "timer", "orange", "Show seconds", ""), tog("clock_date", "calendar", "red", "Show date", ""), tog("clock_24h", "clock", "amber", "24-hour clock", "13:00 instead of 1:00 PM")) +
  sec("Taskbar") + group(
    tog("tasks_group", "layers", "indigo", "Group windows from the same app", "One icon per app instead of one per window"),
    tog("tasks_thisdesk", "monitor", "blue", "Only show windows from this desktop", "When using virtual desktops"),
    tog("tasks_audio", "volume", "red", "Show which apps are playing sound", "A small speaker on their taskbar icon")) +
  sec("What's on the panel") + `<div class="group"><div class="wlist" id="pwidgets"></div></div>` +
  note(`To add, remove or rearrange widgets, right-click the panel and choose <b>Show Panel Configuration</b>. Changes here apply to your main panel instantly.`) +
  sec("Virtual desktops") + group(segCtl("vdesks", "layers", "indigo", "Number of desktops", "Separate workspaces you can switch between (Ctrl+F1, F2…)", [[1, "1"], [2, "2"], [3, "3"], [4, "4"], [6, "6"]], { kw: "workspaces" })) +
  sec("Linux Dashboard") + group(
    tog("app_taskbar", "pin", "violet", "Pin to taskbar", "Keep the dashboard icon on your panel"),
    tog("app_desktop", "monitor", "blue", "Desktop shortcut", "An icon on your desktop"));
// GNOME's top bar and dock, or just the dashboard's own shortcuts on other desktops
function panelOther() {
  const gn = feat("gnome");
  return pageHead("panel", gn ? "The clock in the top bar, workspaces, and the dock." : "Where Linux Dashboard shows up.") +
    secIf("Clock", group(tog("clock_seconds", "timer", "orange", "Show seconds", ""), tog("clock_weekday", "calendar", "red", "Show the weekday", ""),
      tog("clock_date", "calendar", "red", "Show date", ""), tog("clock_24h", "clock", "amber", "24-hour clock", "13:00 instead of 1:00 PM"))) +
    secIf("Top bar", group(PLAT.battery ? tog("battery_pct", "zap", "green", "Battery percentage", "Show the number next to the battery icon") : "")) +
    secIf("Workspaces", group(segCtl("vdesks", "layers", "indigo", "Number of workspaces", "Separate desktops you can switch between (Super+Page Up/Down)", [[1, "1"], [2, "2"], [3, "3"], [4, "4"], [6, "6"]], { kw: "virtual desktops" }))) +
    sec("Linux Dashboard") + group(
      tog("app_taskbar", "pin", "violet", gn ? "Pin to the dock" : "Pin to taskbar", gn ? "Keep the dashboard in your favourites" : "Keep the dashboard icon on your panel"),
      tog("app_desktop", "monitor", "blue", "Desktop shortcut", "An icon on your desktop"));
}
function syncPanelPreview() {
  const bar = $("#pbar"); if (!bar || !CTL.panel_location) return;
  const loc = CTL.panel_location, vert = loc === "left" || loc === "right", fl = CTL.panel_floating, fit = CTL.panel_length === "fit";
  const t = Math.max(10, Math.round((CTL.panel_height || 46) / 3.4)), gap = fl ? 6 : 0;
  const st = { left: "auto", right: "auto", top: "auto", bottom: "auto", width: "auto", height: "auto", borderRadius: fl ? "7px" : "0", flexDirection: vert ? "column" : "row", opacity: CTL.panel_hiding === "autohide" ? ".45" : "1" };
  st[loc] = gap + "px";
  const al = CTL.panel_alignment || "center";
  if (vert) { st.width = t + "px"; if (fit) { st.height = "52%"; st[al === "left" ? "top" : al === "right" ? "bottom" : "top"] = al === "center" ? "24%" : gap + "px"; } else { st.top = st.bottom = gap + "px"; } }
  else { st.height = t + "px"; if (fit) { st.width = "42%"; st[al] = al === "center" ? "29%" : gap + "px"; if (al === "center") st.left = "29%"; } else { st.left = st.right = gap + "px"; } }
  Object.assign(bar.style, st);
}
loaders.panel = async () => {
  await loadCtl(); if (!$("#pwidgets")) return;
  $("#pwidgets").innerHTML = (CTL._panel_widgets || []).map(w => { const k = w.split(".").pop(); const [n, i, c] = WIDGET_NAMES[k] || [k, "widgets", "slate"]; return `<span>${tile(i, c)}${esc(n)}</span>`; }).join("") || `<span>No panel found</span>`;
};

/* ---------- FONTS ---------- */
// family: name as fontconfig knows it ("" = system default); pkg: Arch package to install it (aur: from the AUR)
const FONTS = [
  { family: "", name: "System default", vibe: "Clean and familiar, matches your desktop", tag: "Default" },
  { family: "Hack", name: "Terminal", vibe: "Hack: the classic terminal font", tag: "Mono", pkg: "ttf-hack" },
  { family: "Inter", vibe: "Crisp and modern, very easy to read", tag: "Sans", pkg: "inter-font" },
  { family: "JetBrains Mono", vibe: "A coder favourite with friendly shapes", tag: "Mono", pkg: "ttf-jetbrains-mono" },
  { family: "Fira Code", vibe: "Monospace with ligatures for symbols", tag: "Mono", pkg: "ttf-fira-code" },
  { family: "Fira Sans", vibe: "Warm, open and highly readable", tag: "Sans", pkg: "ttf-fira-sans" },
  { family: "IBM Plex Sans", vibe: "Sharp corporate-tech look", tag: "Sans", pkg: "ttf-ibm-plex" },
  { family: "IBM Plex Mono", vibe: "Plex's typewriter-style sibling", tag: "Mono", pkg: "ttf-ibm-plex" },
  { family: "Cascadia Code", vibe: "Microsoft's fun terminal font", tag: "Mono", pkg: "ttf-cascadia-code" },
  { family: "Monaspace Neon", vibe: "GitHub's sleek monospace", tag: "Mono", pkg: "otf-monaspace" },
  { family: "Monaspace Radon", vibe: "Monospace that looks handwritten", tag: "Fun", pkg: "otf-monaspace" },
  { family: "Iosevka", vibe: "Tall, narrow and very sleek", tag: "Mono", pkg: "ttc-iosevka" },
  { family: "Source Code Pro", vibe: "Adobe's tidy monospace", tag: "Mono", pkg: "adobe-source-code-pro-fonts" },
  { family: "Ubuntu", vibe: "The rounded Ubuntu look", tag: "Sans", pkg: "ttf-ubuntu-font-family" },
  { family: "Roboto", vibe: "Android's familiar font", tag: "Sans", pkg: "ttf-roboto" },
  { family: "Cantarell", vibe: "The GNOME desktop look", tag: "Sans", pkg: "cantarell-fonts" },
  { family: "Nunito", vibe: "Soft, rounded and friendly", tag: "Sans", pkg: "ttf-nunito" },
  { family: "Atkinson Hyperlegible", vibe: "Designed to be easy to read with low vision", tag: "Readable", pkg: "ttf-atkinson-hyperlegible" },
  { family: "Noto Serif", vibe: "Bookish and elegant", tag: "Serif" },
  { family: "Victor Mono", vibe: "Monospace with cursive italics", tag: "Fun", pkg: "ttf-victor-mono", aur: true },
  { family: "Comic Neue", vibe: "Comic Sans, but tasteful", tag: "Fun", pkg: "ttf-comic-neue", aur: true },
  { family: "Recursive", vibe: "Playful casual-to-strict variable font", tag: "Fun", pkg: "ttf-recursive", aur: true },
  { family: "Press Start 2P", vibe: "Retro 8-bit arcade pixels", tag: "Fun", pkg: "ttf-press-start-2p", aur: true },
];
// the same fonts under other systems' package names; the first one that exists gets installed
const FONT_PKGS = {
  "Hack": { debian: ["fonts-hack", "fonts-hack-ttf"], fedora: ["hack-fonts"], suse: ["hack-fonts"] },
  "Inter": { debian: ["fonts-inter", "fonts-inter-variable"], fedora: ["rsms-inter-fonts"], suse: ["inter-fonts"] },
  "JetBrains Mono": { debian: ["fonts-jetbrains-mono"], fedora: ["jetbrains-mono-fonts-all", "jetbrains-mono-fonts"], suse: ["jetbrains-mono-fonts"] },
  "Fira Code": { debian: ["fonts-firacode"], fedora: ["fira-code-fonts"], suse: ["fira-code-fonts"] },
  "Fira Sans": { debian: ["fonts-fira-sans", "fonts-mozilla-fira"], fedora: ["mozilla-fira-sans-fonts"], suse: ["mozilla-fira-fonts", "fira-sans-fonts"] },
  "IBM Plex Sans": { debian: ["fonts-ibm-plex"], fedora: ["ibm-plex-sans-fonts"], suse: ["ibm-plex-sans-fonts"] },
  "IBM Plex Mono": { debian: ["fonts-ibm-plex"], fedora: ["ibm-plex-mono-fonts"], suse: ["ibm-plex-mono-fonts"] },
  "Cascadia Code": { debian: ["fonts-cascadia-code"], fedora: ["cascadia-code-fonts", "cascadia-fonts-all"], suse: ["cascadia-code-fonts"] },
  "Iosevka": { suse: ["iosevka-fonts"] },
  "Source Code Pro": { debian: ["fonts-adobe-sourcecodepro", "fonts-source-code-pro"], fedora: ["adobe-source-code-pro-fonts"], suse: ["adobe-sourcecodepro-fonts"] },
  "Ubuntu": { debian: ["fonts-ubuntu"], suse: ["ubuntu-fonts"] },
  "Roboto": { debian: ["fonts-roboto"], fedora: ["google-roboto-fonts"], suse: ["google-roboto-fonts"] },
  "Cantarell": { debian: ["fonts-cantarell"], fedora: ["abattis-cantarell-fonts"], suse: ["cantarell-fonts"] },
  "Nunito": { debian: ["fonts-nunito"], suse: ["nunito-fonts"] },
  "Atkinson Hyperlegible": { debian: ["fonts-atkinson-hyperlegible"], fedora: ["atkinson-hyperlegible-fonts"] },
  "Noto Serif": { debian: ["fonts-noto-core"], fedora: ["google-noto-serif-fonts"], suse: ["noto-serif-fonts"] },
  "Comic Neue": { debian: ["fonts-comic-neue"], fedora: ["comic-neue-fonts"], suse: ["comic-neue-fonts"] },
  "Recursive": { debian: ["fonts-recursive"] },
};
const PROBE = { debian: "apt-cache show {pkg} >/dev/null 2>&1", fedora: "dnf -q info {pkg} >/dev/null 2>&1", suse: "zypper --no-refresh -q info {pkg} 2>/dev/null | grep -q '^Name'" };
function fontInstallCmd(f) {
  if (!PLAT.family || PLAT.family === "arch") {
    if (!f.pkg || (f.aur && !PLAT.pkg.install_aur)) return "";
    return pkgCmd(f.aur ? PLAT.pkg.install_aur : PLAT.pkg.install, f.pkg, true) + " && fc-cache -f";
  }
  const cands = FONT_PKGS[f.family]?.[PLAT.family], probe = PROBE[PLAT.family];
  if (!cands?.length || !probe || !PLAT.pkg.install) return "";
  return `for p in ${cands.join(" ")}; do if ${pkgCmd(probe, '"$p"', true)}; then ${pkgCmd(PLAT.pkg.install, '"$p"', true)} && fc-cache -f; exit $?; fi; done; echo "This font isn't in ${PLAT.repoName || "your system"}'s software sources."; exit 1`;
}
let FAMILIES = null;
const SYSTEM_FONT = 'system-ui, -apple-system, "Segoe UI", "Noto Sans", sans-serif';
const fontStack = fam => fam ? `"${fam.replace(/"/g, "")}", ${SYSTEM_FONT}` : SYSTEM_FONT;
// the real installed family name for a curated font (fontconfig names can vary a little)
const installedAs = f => !f.family ? "" : FAMILIES?.find(x => x.toLowerCase() === f.family.toLowerCase()) || FAMILIES?.find(x => x.toLowerCase().startsWith(f.family.toLowerCase())) || null;
function applyFont() {
  document.documentElement.style.setProperty("--font", fontStack(SETTINGS.font));
  document.body.style.zoom = SETTINGS.fontScale && SETTINGS.fontScale !== 1 ? SETTINGS.fontScale : "";
}
async function loadFonts(force) {
  if (!FAMILIES || force) FAMILIES = await api("/api/fonts").catch(() => []);
  $("#fontList").innerHTML = FAMILIES.map(f => `<option value="${esc(f)}">`).join("");
  renderFonts();
}
function renderFonts() {
  const g = $("#fontGrid"); if (!g) return;
  const sample = "The quick brown fox jumps · 0123 $ ls -la";
  g.innerHTML = FONTS.map((f, i) => {
    const fam = installedAs(f), have = fam !== null, on = (SETTINGS.font || "") === (fam ?? f.family);
    return `<div class="fontcard ${on ? "on" : ""} ${have ? "" : "missing"}">
      <div class="fn" style="font-family:${esc(fontStack(fam ?? f.family))}">${esc(f.name || f.family)}<span class="chip plain">${f.tag}</span></div>
      <div class="fs" style="font-family:${esc(fontStack(fam ?? f.family))}">${esc(sample)}</div>
      <div class="fv">${esc(f.vibe)}</div>
      <div class="fa">${on ? `<span class="chip good">In use</span>` : have ? `<button class="btn sm primary" data-usefont="${esc(fam)}">Use</button>` : (fontInstallCmd(f) ? `<button class="btn sm" data-installfont="${i}">${ic("download")}Install</button>${f.aur && ARCHY ? `<span class="chip warn plain">AUR</span>` : ""}` : `<span class="chip plain" title="Download it from the web, then use Add a font file">Not packaged here</span>`)}</div></div>`;
  }).join("");
  const cur = SETTINGS.font || "";
  $("#fontCurrent").textContent = cur ? cur : "System default";
  $("#fontPreview").style.fontFamily = fontStack($("#fontPick").value.trim() || cur);
  $$("#fontScale button").forEach(b => b.classList.toggle("on", +b.dataset.v === +(SETTINGS.fontScale || 1)));
}
function useFont(fam) { setPref("font", fam || ""); applyFont(); renderFonts(); toast("ok", `Font: ${fam || "System default"}`); }

/* ---------- DASHBOARD SETTINGS ---------- */
// sections of the Dashboard settings page, also the chips in the jump bar at the top
const SET_SECS = [["look", "Appearance"], ["layout", "Layout"], ["font", "Font"], ["home", "Home"], ["sidebar", "Sidebar"], ["startup", "Startup"],
  ["behavior", "Behavior"], ["assistant", "Assistant"], ["safety", "Safety"], ["you", "You"], ["help", "Help & data"]];
// a row of section chips that stays at the top while the page scrolls (Dashboard settings, Developer)
const JUMPS = { settings: SET_SECS };
const jumpBar = page => `<nav class="setjump" data-jump-page="${page}">${JUMPS[page].map(([id, t]) => `<button data-set-jump="${page}-${id}">${t}</button>`).join("")}</nav>`;
const jsec = (page, id, right = "", title = JUMPS[page].find(x => x[0] === id)[1]) => `<h2 class="sec jump" id="${page}-${id}">${title}${right ? `<span class="right">${right}</span>` : ""}</h2>`;
const ssec = id => jsec("settings", id);
PAGES.settings = () => pageHead("settings", "Make this app work the way you like.") +
  jumpBar("settings") +
  ssec("look") + group(
    custom("sun", "amber", "Theme", "This app only. Your desktop has its own setting", segHtml("appTheme", [["light", "Light", "sun"], ["auto", "System", "auto"], ["dark", "Dark", "moon"], ["retro", "Retro", "terminal"]], theme), { kw: "dark light mode theme" }),
    custom("droplet", "pink", "Accent color", "Icons, buttons, highlights and graphs. None keeps the colorful icons", `<div class="swatches">${APP_ACCENTS.map(c => `<button class="swatch" style="--sc:${c || "transparent"}" data-app-accent="${c}" title="${c || "None"}">${ic("check")}</button>`).join("")}<label class="swatch custom" id="accentCustom" title="Custom color…">${ic("check")}<input type="color" id="accentPick" aria-label="Custom accent color"></label></div>`, { kw: "accent color theme icons tint none custom" }),
    custom("image", "blue", "Background tint", "Mixes the accent into the background. Needs an accent color", prefSeg("bgTint", [["off", "Off"], ["subtle", "Subtle"], ["strong", "Strong"], ["bold", "Bold"]]), { kw: "background color tint accent wash", cls: "bgtint" }),
    custom("sparkles", "violet", "Background style", "", prefSeg("bgStyle", [["plain", "Plain"], ["glow", "Glow"], ["gradient", "Gradient"]]), { kw: "background gradient glow wallpaper" }),
    prefTog("trueBlack", "moon", "slate", "Pure black in dark mode", "Good for OLED screens"),
    prefTog("contrast", "eye", "slate", "High contrast", "Stronger borders and darker text")) +
  ssec("layout") + group(
    custom("grid", "teal", "Cards", "", prefSeg("cardStyle", [["outlined", "Outlined"], ["flat", "Flat"], ["raised", "Raised"]]), { kw: "cards shadow border style" }),
    custom("palette", "pink", "Icons", "", prefSeg("iconStyle", [["filled", "Filled"], ["soft", "Soft"], ["plain", "Plain"]]), { kw: "icon tile style" }),
    custom("box", "violet", "Corners", "", prefSeg("corners", [["square", "Square"], ["round", "Rounded"], ["extra", "Extra round"]])),
    custom("layers", "indigo", "Spacing", "Compact fits more on screen", prefSeg("density", [["comfortable", "Comfortable"], ["compact", "Compact"]]), { kw: "density compact layout" }),
    custom("width", "cyan", "Page width", "On big screens", prefSeg("pageWidth", [["narrow", "Narrow"], ["normal", "Normal"], ["full", "Full"]]), { kw: "width wide content" }),
    custom("terminal", "slate", "Output panel size", "", prefSeg("drawerHeight", [["small", "Small"], ["medium", "Medium"], ["large", "Large"]])),
    prefTog("reduceMotion", "pause", "slate", "Reduce motion", "Turns off animations")) +
  ssec("font") + `<div class="group" id="fontSection">
    ${rowWrap(reg({ title: "Font", desc: "Change the font of the whole app", icon: "type", color: "indigo", kw: "font typeface text terminal hack" }), "type", "indigo", "Font", `Now using: <b id="fontCurrent">System default</b>`, segHtml("fontScale", [["0.9", "Small"], ["1", "Normal"], ["1.1", "Large"], ["1.25", "Larger"]], "1"))}
    <div class="fontgrid" id="fontGrid"></div>
    <div class="fontprev" id="fontPreview">The quick brown fox jumps over the lazy dog · 0123456789</div>
    ${rowWrap(reg({ title: "Any font on this computer", desc: "Custom font", icon: "search", color: "blue", kw: "custom font installed" }), "search", "blue", "Other installed font", "", `<input type="text" id="fontPick" list="fontList" placeholder="e.g. Noto Sans Mono" style="width:240px"><datalist id="fontList"></datalist><button class="btn" id="fontPickUse">Use</button>`)}
    ${rowWrap(reg({ title: "Add a font file", desc: "Install a .ttf or .otf font you downloaded", icon: "upload", color: "green", kw: "custom font file ttf otf" }), "upload", "green", "Add a font file", ".ttf, .otf or .woff2. Works in every app", `<button class="btn" id="fontAddFile">${ic("folder")}Choose file…</button>`)}
  </div>` +
  ssec("home") + `<div class="group"><div class="row" style="border:0">${tile("grid", "blue")}<div class="txt"><b>Quick setting tiles</b></div></div><div class="tilepick" id="tilepick">${QS.map(([id, t, i]) => `<button data-tilepick="${id}">${ic(i)}${t}</button>`).join("")}</div>` +
    `<div class="row" id="${reg({ title: "Show on Home", desc: "Sliders, suggestions, live graphs, tip of the day, quick actions, power buttons", icon: "eye", color: "violet", kw: "home sections volume brightness sliders suggestions live graphs tip quick actions power buttons" })}">${tile("eye", "violet")}<div class="txt"><b>Show on Home</b></div></div><div class="tilepick">${[["showSliders", "sliders", "Volume & brightness"], ["showSuggest", "bulb", "Suggestions"], ["showLive", "activity", "Live graphs"], ["showTip", "bulb", "Tip of the day"], ["showActions", "zap", "Quick actions"], ["showPower", "power", "Power buttons"]].map(([k, i, t]) => `<button data-home-show="${k}">${ic(i)}${t}</button>`).join("")}</div>` +
    custom("refresh", "cyan", "Live update speed", "Faster uses a little more CPU", `<div class="seg" id="refreshSeg">${[[1, "Fast"], [2, "Normal"], [5, "Slow"]].map(([v, l]) => `<button data-refresh="${v}">${l}</button>`).join("")}</div>`) +
    custom("activity", "green", "Graph length", "", prefSeg("graphLen", [["60", "1 min"], ["120", "2 min"], ["300", "5 min"]])) + `</div>` +
  ssec("sidebar") + group(prefTog("sideCompact", "panel", "blue", "Icons only", "More room for pages")) +
    `<div class="group" style="margin-top:10px"><div class="row" style="border:0">${tile("list", "blue")}<div class="txt"><b>Pages in the sidebar</b><small>Hidden pages are still in Ctrl+K search</small></div></div><div class="tilepick" id="navpick">${Object.entries(PAGEINFO).filter(([k]) => !["home", "settings", "about"].includes(k)).map(([k, p]) => `<button data-navpick="${k}">${ic(p.i)}${p.t}</button>`).join("")}</div></div>` +
  ssec("startup") + group(
    custom("home", "indigo", "Open on", "", `<select data-pref="startPage"><option value="home">Home</option><option value="last">Last page I used</option>${Object.entries(PAGEINFO).filter(([k]) => k !== "home").map(([k, v]) => `<option value="${k}">${esc(v.t)}</option>`).join("")}</select>`),
    prefTog("maximized", "scale", "blue", "Open maximized"),
    tog("app_login", "rocket", "green", "Open when I log in"),
    tog("app_taskbar", "pin", "violet", "Pin to taskbar"),
    tog("app_desktop", "monitor", "blue", "Desktop shortcut")) +
  ssec("behavior") + group(
    prefTog("toasts", "bell", "blue", "Pop-up after each change", "Shows the command that ran. Errors always show"),
    prefTog("autoOpen", "terminal", "slate", "Open the Output panel when running something"),
    prefTog("autoCloseDrawer", "terminal", "slate", "Close it again after success"),
    prefTog("notifyDone", "bell", "amber", "Notify me when a long task finishes", "When you're in another window"),
    prefTog("soundDone", "music", "pink", "Play a sound too"),
    custom("download", "green", "Check for updates", "Only checks, never installs", prefSeg("updateCheck", [["never", "Never"], ["daily", "Daily"], ["6h", "Every 6 h"]]), { kw: "updates automatic badge" })) +
  ssec("assistant") + `<div class="group" id="aiBox">${skeleton(2)}</div>` + `<div style="height:10px"></div>` + group(
    custom("list", "violet", "Answer length", "", prefSeg("assistStyle", [["short", "Short"], ["medium", "Normal"], ["detailed", "Explain more"]])),
    custom("gauge", "orange", "Thinking", "Smart is slower but better for tricky problems", prefSeg("assistEffort", [["low", "Fast"], ["medium", "Mid"], ["high", "Smart"]])),
    prefTog("autoRunSafe", "eye", "green", "Run “just looks” steps automatically", "Anything that changes your system always waits for you"),
    prefTog("rememberChats", "brain", "pink", "Remember things between chats", "Kept on this computer. Manage in Assistant → History & memory"),
    prefTog("aiComplete", "sparkles", "blue", "AI suggestions while typing", "Uses a little AI credit"),
    prefTog("showCost", "info", "slate", "Show time and cost of each answer"),
    custom("list", "teal", "Personalized suggestions", `<span id="suggestInfo">…</span>`, `<button class="btn" id="regenSuggest">${ic("plus")}Make more</button>`, { kw: "autocomplete suggestions ai" })) +
  ssec("safety") + group(
    prefTog("warnHarm", "alert", "red", "Warn me before anything harmful", "Explains anything that could delete data, break the system or weaken security"),
    custom("unlock", "orange", "Remember my admin password", "Only in this app. Closing it forgets the password",
      `<div class="seg" id="adminSeg">${[[0, "Every time"], [300, "5 min"], [900, "15 min"], [-1, "Until I close"]].map(([v, l]) => `<button data-admin-remember="${v}">${l}</button>`).join("")}</div>`, { kw: "password sudo pkexec admin remember" })) +
  ssec("you") + group(
    custom("user", "green", "What should I call you?", "", `<input type="text" data-pref="name" placeholder="${esc(ME || "your name")}" style="width:200px">`, { kw: "name greeting" }),
    custom("thermo", "red", "Temperature", "", prefSeg("tempUnit", [["C", "°C"], ["F", "°F"]]), { kw: "celsius fahrenheit units" }),
    prefTog("clock24", "clock", "orange", "24-hour clock")) +
  ssec("help") + group(
    custom("info", "blue", "Version", `Linux Dashboard ${esc(APP_VERSION)} <span class="devhint" id="devHint"></span>`, `<button class="chip accent plain vertap" data-vertap title="Version">${esc(APP_VERSION)}</button>`, { kw: "version build" }),
    custom("bug", "red", "Send a ticket", "Something broken in the dashboard, or an idea? Tell the owner", `<button class="btn" data-nav="support">${ic("bug")}Ticket</button>`, { kw: "bug report ticket feedback problem help support" }),
    custom("play", "violet", "Welcome tour", "Or press F1 any time", `<button class="btn" data-start-tour>${ic("play")}Start</button>`, { kw: "tour intro help guide welcome tutorial" }),
    custom("chip", "blue", "Tailored to this computer", `<span id="tailorInfo">…</span>`, `<button class="btn" id="retailor">${ic("refresh")}Check again</button>`, { kw: "specs hardware scan tailor profile" }),
    custom("keyboard", "slate", "Keyboard shortcuts", "Ctrl+K search · Ctrl+\` output · F1 tour · Ctrl+Q quit", `<button class="btn" data-nav="about">See all</button>`, { kw: "shortcuts keys" }),
    custom("download", "green", "Back up my settings", "Settings, saved commands and memory, to Downloads", `<button class="btn" id="exportBackup">${ic("download")}Export</button>`, { kw: "backup export" }),
    custom("folder", "amber", "Settings folder", "~/.config/linux-dashboard", `<button class="btn" data-launch-path="" id="openCfg">${ic("folder")}Open</button>`),
    custom("trash", "slate", "Clear history", "Terminal commands you typed, or the Output panel's activity log", `<button class="btn" id="clearHist">Terminal</button><button class="btn" id="clearLog">Activity</button>`),
    custom("restart", "red", "Reset dashboard settings", "Chats and saved commands are kept", `<button class="btn danger" id="resetPrefs">${ic("restart")}Reset</button>`));
let adminSent = null;
const APP_ACCENTS = ["", "#3f6ff5", "#7c3aed", "#db2777", "#e11d48", "#ea580c", "#d97706", "#16a34a", "#0d9488", "#0891b2", "#475569"];
// White or near-black text, whichever reads better on the accent
function inkFor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); if (!m) return "#ffffff";
  const [r, g, b] = [0, 2, 4].map(i => { const c = parseInt(m[1].slice(i, i + 2), 16) / 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
  return .2126 * r + .7152 * g + .0722 * b > .4 ? "#111318" : "#ffffff";
}
function setAccentVars(c) {
  const root = document.documentElement, b = document.body;
  if (c) { root.style.setProperty("--accent", c); root.style.setProperty("--accent-weak", `color-mix(in srgb, ${c} 16%, var(--panel0))`); root.style.setProperty("--accent-ink", inkFor(c)); }
  else ["--accent", "--accent-weak", "--accent-ink"].forEach(p => root.style.removeProperty(p));
  // no accent: the original colorful look; an accent: every icon color becomes it (see style.css)
  b.classList.toggle("accented", !!c);
}
function applyLook() {
  const root = document.documentElement, b = document.body;
  setAccentVars(SETTINGS.appAccent);
  b.classList.toggle("compact", SETTINGS.density === "compact");
  b.classList.toggle("square", SETTINGS.corners === "square");
  b.classList.toggle("roundxl", SETTINGS.corners === "extra");
  const pick = (prefix, v) => [...b.classList].forEach(k => k.startsWith(prefix) && k !== prefix + v && b.classList.remove(k)) || b.classList.add(prefix + v);
  pick("tint-", SETTINGS.bgTint || "off"); pick("bg-", SETTINGS.bgStyle || "plain"); pick("cards-", SETTINGS.cardStyle || "outlined");
  pick("tiles-", SETTINGS.iconStyle || "filled"); pick("width-", SETTINGS.pageWidth || "normal");
  b.classList.toggle("trueblack", !!SETTINGS.trueBlack);
  $(".row.bgtint")?.classList.toggle("dim", !SETTINGS.appAccent);
  b.classList.toggle("nomotion", !!SETTINGS.reduceMotion);
  b.classList.toggle("sidecompact", !!SETTINGS.sideCompact);
  b.classList.toggle("contrast", !!SETTINGS.contrast);
  const hidden = new Set(SETTINGS.hiddenPages || []);
  renderSide(); setSideWidth(SETTINGS.sideWidth || (SETTINGS.sideCompact ? 72 : 248));
  $$("#navpick [data-navpick]").forEach(x => x.classList.toggle("on", !hidden.has(x.dataset.navpick)));
  if (sparks && sparks._len !== SETTINGS.graphLen) sparks = null;  // rebuilt with the new length
  root.style.setProperty("--drawer-h", { small: "30vh", medium: "44vh", large: "66vh" }[SETTINGS.drawerHeight] || "44vh");
  $$("[data-pref-seg]").forEach(sg => $$("button", sg).forEach(x => x.classList.toggle("on", x.dataset.v === String(SETTINGS[sg.dataset.prefSeg]))));
  $$("[data-app-accent]").forEach(x => x.classList.toggle("on", x.dataset.appAccent === (SETTINGS.appAccent || "")));
  const custom = SETTINGS.appAccent && !APP_ACCENTS.includes(SETTINGS.appAccent);
  $("#accentCustom")?.classList.toggle("on", !!custom);
  $("#accentCustom")?.style.setProperty("--sc", custom ? SETTINGS.appAccent : "");
  if ($("#accentPick") && SETTINGS.appAccent) $("#accentPick").value = SETTINGS.appAccent;
}
function applySettings() {
  SETTINGS.autoExplain = true;
  if (typeof applyDev === "function") applyDev();  // results are always explained now
  applyFont(); applyLook();
  $$("[data-admin-remember]").forEach(b => b.classList.toggle("on", +b.dataset.adminRemember === +SETTINGS.adminRemember));
  if (adminSent !== SETTINGS.adminRemember) { adminSent = SETTINGS.adminRemember; api("/api/admin/config", { idle: SETTINGS.adminRemember }).then(s => { ADMIN_STATE = s; renderAdminChip(); }).catch(() => {}); }
  QS.forEach(([id]) => $("#qs-" + id)?.classList.toggle("hidden", !SETTINGS.tiles.includes(id)));
  $$("#tilepick [data-tilepick]").forEach(b => b.classList.toggle("on", SETTINGS.tiles.includes(b.dataset.tilepick)));
  $("#home-sliders").classList.toggle("hidden", !SETTINGS.showSliders);
  $("#suggest").classList.toggle("hidden", !SETTINGS.showSuggest);
  $(".homegrid").classList.toggle("hidden", !SETTINGS.showSliders && !SETTINGS.showSuggest);
  $(".homegrid").style.gridTemplateColumns = SETTINGS.showSliders && SETTINGS.showSuggest ? "" : "1fr";
  $("#home-live").classList.toggle("hidden", !SETTINGS.showLive);
  $("#home-actions").classList.toggle("hidden", !SETTINGS.showActions);
  $("#home-power").classList.toggle("hidden", !SETTINGS.showPower);
  $("#home-tip").classList.toggle("hidden", !SETTINGS.showTip);
  $$("[data-pill]").forEach(b => b.classList.toggle("on", !!SETTINGS[b.dataset.pill]));
  renderAsOpts();
  $$("[data-pref]").forEach(el => { const v = SETTINGS[el.dataset.pref]; if (el.type === "checkbox") el.checked = !!v; else el.value = v; });
  $$("#refreshSeg button").forEach(b => b.classList.toggle("on", +b.dataset.refresh === +SETTINGS.refresh));
  $$("[data-home-show]").forEach(b => b.classList.toggle("on", !!SETTINGS[b.dataset.homeShow]));
  $$("#appTheme button").forEach(b => b.classList.toggle("on", b.dataset.v === theme));
}
function setPref(key, value) { SETTINGS[key] = value; saveSettings(); applySettings(); if (key === "refresh" && CUR === "home") loaders.home(); }
// light up the jump-bar chip of the section being read
function trackSetJump() {
  const secs = JUMPS[CUR], bar = $(`.setjump[data-jump-page="${CUR}"]`); if (!secs || !bar) return;
  const m = $("main"), top = m.getBoundingClientRect().top + 70;
  let cur = secs[0][0];
  for (const [id] of secs) { const h = $(`#${CUR}-${id}`); if (h && h.getBoundingClientRect().top <= top) cur = id; }
  if (m.scrollTop + m.clientHeight >= m.scrollHeight - 4) cur = secs.at(-1)[0];
  bar.classList.toggle("stuck", m.scrollTop > 60);
  $$("button", bar).forEach(b => b.classList.toggle("on", b.dataset.setJump === `${CUR}-${cur}`));
}
$("main").addEventListener("scroll", () => requestAnimationFrame(trackSetJump), { passive: true });
loaders.settings = () => { trackSetJump(); refreshAI().then(renderAIBox); applySettings(); loadCtl(); loadFonts(); renderTailorInfo(); if (!aiSuggest) api("/api/suggestions").then(r => { aiSuggest = r; renderSuggestInfo(); }).catch(() => {}); else renderSuggestInfo(); };

/* ---------- DEVELOPER (unlocked by tapping the version 10 times) ---------- */
let verTaps = 0, verTapAt = 0;
function tapVersion() {
  if (SETTINGS.devMode) return toast("info", "No need, you're already a developer");
  const now = Date.now(); if (now - verTapAt > 2500) verTaps = 0; verTapAt = now; verTaps++;
  const left = 10 - verTaps;
  $$(".vertap").forEach(b => { b.classList.remove("tapped"); void b.offsetWidth; b.classList.add("tapped"); });
  if (left <= 0) {
    SETTINGS.devMode = true; saveSettings(); verTaps = 0; renderSide();
    toast("ok", "You're now a developer!", "The Developer page is in the sidebar, under Tools.");
    return setTimeout(() => { location.hash = "dev"; }, 600);
  }
  if (verTaps >= 3) { const h = $("#devHint"); if (h) h.textContent = `· ${left} more`; $$("#toasts .toast.devtap").forEach(t => t.remove());
    toast("info", `You're ${left} tap${left === 1 ? "" : "s"} away from being a developer`); $("#toasts .toast:last-child")?.classList.add("devtap"); }
}
JUMPS.dev = [["overview", "Overview"], ["toggles", "Toggles"], ["actions", "Actions"], ["inspect", "Inspect"], ["logs", "Logs"]];
const devAct = ([id, i, c, t, d]) => `<button class="act" id="${id}" style="--tc:var(--c-${c})">${tile(i, c)}<div><b>${t}</b><small>${d}</small></div></button>`;
PAGES.dev = () => `<div class="phead">${tile("code", "slate")}<div><h1>Developer</h1><p>For testing. Nothing here changes your computer.</p></div><div class="right"><button class="btn danger" id="devOff">${ic("x")}Turn off developer mode</button></div></div>` +
  jumpBar("dev") +
  jsec("dev", "overview", `<button class="btn sm ghost" id="devRefresh">${ic("refresh")}Refresh</button>`) +
    `<div class="group"><div class="devgrid" id="devInfo"></div></div>` +
    `<div class="group" style="margin-top:10px"><div class="devgrid" id="devFiles"></div></div>` +
  jsec("dev", "toggles") + `<div class="grid2">` +
    `<div>${group(
      prefTog("devFps", "gauge", "green", "Performance overlay", "FPS, page, elements, calls per minute"),
      prefTog("devOutlines", "grid", "orange", "Layout outlines", "A box around every element"),
      prefTog("devGrid", "grid", "cyan", "Alignment grid", "8-pixel grid over the page"),
      prefTog("devShowIds", "hash", "pink", "Show control names", "Internal name on each control"),
      prefTog("devSlowmo", "pause", "violet", "Slow-motion animations", "5× slower"))}</div>` +
    `<div>${group(
      prefTog("devApiLog", "list", "blue", "Log server calls", "With timings, under Logs"),
      prefTog("devRawAnswers", "code", "pink", "Raw assistant answers", "The JSON under each message"),
      prefTog("devConfirmAll", "alert", "red", "Confirm every command", "Not just risky ones"),
      custom("clock", "amber", "Slow connection", "", prefSeg("devSlowNet", [["0", "Off"], ["500", "0.5 s"], ["2000", "2 s"]])))}</div>` +
  `</div>` +
  jsec("dev", "actions") +
    `<h3 class="subsec">Try it</h3><div class="actions">${[
      ["devTour", "play", "violet", "Welcome tour", "As a first-time user sees it"],
      ["devTailor", "chip", "blue", "First-start check", "Scan the hardware again"],
      ["devAlerts", "bell", "orange", "Test alerts", "On a few pages, for 1 minute"],
      ["devBadge", "download", "green", "Fake update badge", "7 updates waiting"],
      ["devToasts", "info", "cyan", "Sample notices", "One of each kind"],
      ["devSpeed", "gauge", "green", "Page speed test", "Time every page's draw"],
    ].map(devAct).join("")}</div><div id="devSpeedOut"></div>` +
    `<h3 class="subsec">App</h3><div class="actions">${[
      ["devReload", "refresh", "slate", "Reload window", "Ctrl+R"],
      ["devCss", "palette", "pink", "Reload styles", "Apply style.css only"],
      ["devRestart", "restart", "red", "Restart the app", "Needs the desktop app"],
      ["devDiag", "download", "blue", "Export diagnostics", "To Downloads, no chats or notes"],
    ].map(devAct).join("")}</div>` +
  jsec("dev", "inspect") + `<div class="grid2">
    <div class="group"><div class="row" style="min-height:48px">${tile("layers", "blue", "soft")}<div class="txt"><b>Data</b></div><div class="ctl"><select id="devData">${["Settings", "Controls", "Hardware profile", "Alerts", "Updates", "Search index", "Jobs", "Activity log", "Chat"].map(x => `<option>${x}</option>`).join("")}</select></div></div><pre class="devjson" id="devDataOut"></pre></div>
    <div class="group"><div class="pad"><div class="field"><input type="text" id="devPath" class="mono" value="/api/stats" list="devPaths"><datalist id="devPaths">${["/api/stats", "/api/controls", "/api/diskinfo", "/api/sensors", "/api/audio", "/api/displays", "/api/wifi", "/api/profile", "/api/about", "/api/dev/info", "/api/admin/status", "/api/vms", "/api/isos", "/api/vm/templates", "/api/memory", "/api/chats", "/api/suggestions", "/api/fonts"].map(p => `<option value="${p}">`).join("")}</datalist><button class="btn primary" id="devGet">GET</button></div></div><pre class="devjson" id="devGetOut">Pick an endpoint and press GET.</pre></div>
  </div><div class="grid2" style="margin-top:10px">
    <div class="group"><div class="pad"><div class="field"><input type="text" id="devRiskCmd" class="mono" placeholder="e.g. rm -rf ~/Downloads/old" value="${esc(PLAT.pkg.remove ? pkgCmd(PLAT.pkg.remove, "firefox", true) : "rm -rf ~/Downloads/old")}"><button class="btn primary" id="devRisk">${ic("shield")}Check</button></div><small style="color:var(--muted)">Command safety checker</small><div id="devRiskOut" style="margin-top:10px"></div></div></div>
  </div>` +
  jsec("dev", "logs") + `<div class="grid2">
    <div class="group"><div class="row" style="min-height:48px">${tile("bug", "red", "soft")}<div class="txt"><b>Errors</b></div><div class="ctl"><button class="btn sm ghost" id="devErrRefresh">${ic("refresh")}Refresh</button></div></div><div class="scroll" style="max-height:320px" id="devErrors"></div></div>
    <div class="group"><div class="row" style="min-height:48px">${tile("list", "blue", "soft")}<div class="txt"><b>Server calls</b></div><div class="ctl"><button class="btn sm ghost" id="devClearLog">${ic("trash")}Clear</button></div></div><div class="scroll" style="max-height:320px" id="devLog"></div></div>
  </div>`;
function devData() {
  const which = $("#devData")?.value, src = { "Settings": SETTINGS, "Controls": CTL, "Hardware profile": PROFILE, "Alerts": ALERTS, "Updates": UPDATES,
    "Search index": { count: SEARCH.length, sample: SEARCH.slice(0, 25).map(s => `${s.page}: ${s.title}`) }, "Jobs": jobs.map(j => ({ name: j.name, state: j.state || "running", code: j.code, cmd: j.cmd })),
    "Activity log": activity.slice(-40), "Chat": { id: CHAT_ID, messages: CHAT.length, last: CHAT.slice(-3) } }[which];
  $("#devDataOut").textContent = JSON.stringify(src ?? null, null, 2);
}
function renderDevLog() {
  const el = $("#devLog"); if (!el) return;
  el.innerHTML = !SETTINGS.devApiLog ? empty("list", "Turn on “Log server calls” above") : DEVLOG.length ? `<table class="tbl"><thead><tr><th>Time</th><th>Call</th><th class="num">ms</th><th class="num">Status</th></tr></thead><tbody>${DEVLOG.slice().reverse().map(d => `<tr><td class="desc">${d.at}</td><td class="mono" style="font-size:12px">${d.method} ${esc(d.path)}</td><td class="num">${d.ms}</td><td class="num">${d.status}</td></tr>`).join("")}</tbody></table>` : empty("list", "No calls yet");
}
function renderDevErrors(serverErrs = []) {
  const el = $("#devErrors"); if (!el) return;
  const rows = [...JSERRORS.slice().reverse().map(e => ({ ...e, side: "Page" })), ...serverErrs.map(e => ({ at: e.at, msg: e.where, where: "", side: "Server", trace: e.trace }))];
  el.innerHTML = rows.length ? rows.map(e => `<div class="row" style="min-height:40px;align-items:flex-start">${tile(e.side === "Page" ? "code" : "server", "red", "soft")}<div class="txt"><b style="font-weight:500">${esc(e.msg)}</b><small>${e.side} · ${e.at}${e.where ? " · " + esc(e.where) : ""}</small>${e.trace ? `<details class="devraw"><summary>Details</summary><pre>${esc(e.trace)}</pre></details>` : ""}</div></div>`).join("")
    : `<div class="row">${tile("checkcircle", "green", "soft")}<div class="txt"><b>No errors</b><small>Neither the page nor the server has reported a problem</small></div></div>`;
}
loaders.dev = async () => {
  applySettings(); devData(); renderDevLog(); trackSetJump();
  api("/api/dev/errors").then(renderDevErrors).catch(() => renderDevErrors());
  const d = await api("/api/dev/info").catch(() => null); if (!d) return;
  const cell = (k, v) => `<div><small>${k}</small><b class="mono">${esc(String(v))}</b></div>`;
  $("#devInfo").innerHTML = cell("Version", d.version) + cell("Process ID", d.pid) + cell("Port", d.port) + cell("Running for", dur(d.uptime)) + cell("Threads", d.threads) +
    cell("App memory", bytes(d.rss_app)) + cell("Page memory (WebKit)", bytes(d.rss_web)) + cell("Tasks running", d.jobs) + cell("Admin unlocked", d.admin.active ? `yes, ${d.admin.left ?? "∞"}s left` : "no") +
    cell("Python", d.python) + `<div style="grid-column:1/-1"><small>PATH (what the app runs programs with)</small><b class="mono" style="font-size:11.5px;word-break:break-all">${esc(d.env_path)}</b></div>`;
  $("#devFiles").innerHTML = Object.entries(d.files).map(([f, n]) => cell(f, bytes(n))).join("") + Object.entries(d.config).map(([f, n]) => cell("~/.config/…/" + f, bytes(n))).join("");
};
// performance overlay
let fpsEl = null, fpsFrames = 0, fpsLast = performance.now();
function devOverlayTick() {
  if (!SETTINGS.devMode || !SETTINGS.devFps) { fpsEl?.remove(); fpsEl = null; return; }
  if (!fpsEl) { fpsEl = document.createElement("div"); fpsEl.id = "devFps"; document.body.append(fpsEl); }
  fpsFrames++;
  const now = performance.now();
  if (now - fpsLast > 500) {
    const fps = Math.round(fpsFrames * 1000 / (now - fpsLast)); fpsFrames = 0; fpsLast = now;
    const calls = DEVLOG.filter(d => Date.now() - Date.parse(new Date().toDateString() + " " + d.at) < 60e3).length;
    fpsEl.innerHTML = `<b style="color:${fps >= 50 ? "#3ccf7f" : fps >= 30 ? "#eba93e" : "#f26a6a"}">${fps} fps</b> · ${CUR} · ${document.getElementsByTagName("*").length} elements${SETTINGS.devApiLog ? ` · ${calls} calls/min` : ""}`;
  }
  requestAnimationFrame(devOverlayTick);
}
function devSlowmoTick() {
  const on = SETTINGS.devMode && SETTINGS.devSlowmo;
  document.getAnimations().forEach(a => { a.playbackRate = on ? 0.2 : 1; });
  if (on) requestAnimationFrame(devSlowmoTick); else devSlowmoTick.running = false;
}
function applyDev() {
  const dev = !!SETTINGS.devMode;
  document.body.classList.toggle("devoutlines", dev && !!SETTINGS.devOutlines);
  document.body.classList.toggle("devgridon", dev && !!SETTINGS.devGrid);
  document.body.classList.toggle("devids", dev && !!SETTINGS.devShowIds);
  if (dev && SETTINGS.devShowIds) $$("[data-ctl], [data-act], [data-pref], [data-set]").forEach(el => {
    const host = el.closest(".row, .qt, .act, .seg") || el; host.dataset.devid = el.dataset.ctl || el.dataset.act || el.dataset.pref || el.dataset.set; });
  if (dev && SETTINGS.devSlowmo && !devSlowmoTick.running) { devSlowmoTick.running = true; requestAnimationFrame(devSlowmoTick); }
  if (!(dev && SETTINGS.devSlowmo)) document.getAnimations().forEach(a => { a.playbackRate = 1; });
  if (SETTINGS.devMode && SETTINGS.devFps && !fpsEl) requestAnimationFrame(devOverlayTick);
  const want = !!(TOOLS.unlocked && SETTINGS.devInspector);
  if (applyDev.inspector !== want && window.webkit?.messageHandlers?.dev) { window.webkit.messageHandlers.dev.postMessage(JSON.stringify({ action: "inspector", on: want })); applyDev.inspector = want; }
}

/* ---------- ABOUT ---------- */
const FEATURES = [
  ["sliders", "blue", "Settings without the terminal", "Display, sound, Wi-Fi, panel, power, fans and more, all with switches and sliders"],
  ["package", "violet", "Apps & updates", `Search, install and update from ${SOURCES_TEXT} in one place`],
  ["sparkles", "violet", "An assistant that does it for you", "Ask in your own words. It explains each step, runs it, and tells you what it found"],
  ["shield", "red", "Safety first", "Plain-English warnings before anything that could harm your data, system or hardware"],
  ["fan", "cyan", "Fans & hardware", "Live temperatures, plus fan curves, force stop and overdrive on Macs"],
  ["activity", "green", "See what's going on", "Live CPU, memory, network and temperature, plus running programs and logs"],
  ["wrench", "orange", "Guided fixes & tips", "Step-by-step fixes for common problems and 40+ tips to learn Linux"],
  ["terminal", "slate", "Learn as you go", "Every button shows the real command it ran, so the terminal slowly makes sense"],
];
const SHORTCUTS = [["F1", "", "Show the welcome tour"], ["Ctrl", "K", "Search everything"], ["Ctrl", "`", "Show or hide the Output panel"], ["Ctrl", "R", "Reload the window"], ["Ctrl", "Q", "Quit"], ["Esc", "", "Close a dialog or the Output panel"], ["Tab", "", "Use the gray suggestion while typing"], ["Enter", "", "Send a message or run a command"], ["Shift", "Enter", "New line in the assistant"]];
const CHANGES = [
  "Linux Dashboard 1.0 official release",
  "Expanded fan control: non-T2 Intel Macs and T2 Macs, force stop mode, and overdrive",
  "One-file standalone installer and native packages for Ubuntu/Debian (.deb), Arch (.pkg.tar.zst), Fedora (.rpm), and openSUSE (.rpm)",
  "Home, 8 settings pages, 7 system pages, the Toolbox and the Terminal",
  "The assistant: plans, explains and runs tasks; remembers past chats",
  "Remembered admin password (5 minutes) and safety warnings before anything risky",
  "Live hardware sensors, live graphs, and guided fixes",
];
PAGES.about = () => `
  <div class="about-hero card"><img src="/web/app-icon.svg" alt="" class="about-logo"><div>
    <h1>Linux Dashboard</h1>
    <div class="about-tags"><button class="chip accent plain vertap" data-vertap>Version ${esc(APP_VERSION)}</button><span class="chip warn plain">Early preview</span><span class="chip plain">Running on ${esc(PLAT.distro || "Linux")} · ${esc(PLAT.desktopName || "")}</span><span id="updateTag"></span></div>
    <p>Everything you'd normally do in a terminal, with buttons, switches and plain-English explanations, plus a helper that does the typing for you. Built for people who find Linux confusing, so it's never a mystery what your computer is doing.</p>
    <div id="updateBanner" style="margin-top:12px"></div>
  </div></div>
  ${sec("What it does")}<div class="actions">${FEATURES.map(([i, c, t, d]) => `<div class="act" style="--tc:var(--c-${c});cursor:default">${tile(i, c)}<div><b>${t}</b><small>${d}</small></div></div>`).join("")}</div>
  <div class="grid2" style="margin-top:14px">
    <div>${sec("This computer")}<div class="group" id="aboutPc"></div></div>
    <div>${sec("Under the hood")}<div class="group" id="aboutTech"></div></div>
  </div>
  ${sec("Your data")}<div class="group" id="aboutData"></div>
  <div class="grid2" style="margin-top:14px">
    <div>${sec("Keyboard shortcuts")}<div class="group">${SHORTCUTS.map(([a, b, d]) => `<div class="row" style="min-height:44px"><div class="txt"><b style="font-weight:500">${d}</b></div><div class="ctl"><kbd>${a}</kbd>${b ? ` + <kbd>${b}</kbd>` : ""}</div></div>`).join("")}</div></div>
    <div>${sec(`What's new in ${esc(APP_VERSION)}`)}<div class="group"><div class="pad"><ul class="about-list">${CHANGES.map(c => `<li>${c}</li>`).join("")}</ul></div></div>
      ${sec("Thanks to")}<div class="group"><div class="pad about-thanks">The Linux distributions and their communities · KDE Plasma & GNOME · Flathub · the t2linux project (kernel & t2fanrd) · GTK & WebKitGTK · Hack font by Source Foundry · PipeWire · NetworkManager · Claude by Anthropic</div></div></div>
  </div>
  <div style="text-align:center;margin-top:22px"><button class="btn" id="replayTour">${ic("play")}Show the welcome tour again</button></div>
  <p class="about-foot">Linux Dashboard ${esc(APP_VERSION)} · Coded by Claude</p>`;
loaders.about = async () => {
  const a = await api("/api/about").catch(() => null); if (!a) return;
  const row = (i, c, k, v) => `<div class="row" style="min-height:46px">${tile(i, c, "soft")}<div class="txt"><small>${k}</small><b style="font-weight:550">${esc(v ?? "–")}</b></div></div>`;
  const P = PROFILE.model ? PROFILE : await api("/api/profile").catch(() => ({}));
  const specs = P.model ? row("monitor", "blue", "Model", modelName(P)) + row("cpu", "indigo", "Processor", `${P.cpu.replace(/\(R\)|\(TM\)|CPU/g, "").replace(/\s+/g, " ").trim()} · ${P.threads} threads`) +
    row("memory", "violet", "Memory", P.ram_gb + " GB") + row("gpu", "red", "Graphics", (P.gpus || []).map(g => g.replace(/^.*\[(.+?)\]\s*$/, "$1")).join(", ") || "–") +
    row("wifi", P.wifi ? "green" : "orange", "Wi-Fi", P.wifi ? "Working" : P.wifi_hw?.length ? "Card found, not working yet" : "No Wi-Fi card") : "";
  $("#aboutPc").innerHTML = specs + row("chip", "slate", "System", a.os) + row("cpu", "blue", "Kernel", a.kernel) + row("monitor", "indigo", "Desktop", a.desktop) + row("package", "violet", "Software from", `${a.manager}${PLAT.aur ? " + AUR" : ""}${PLAT.flatpak ? " + Flatpak" : ""}${PLAT.snap ? " + Snap" : ""}`) + row("hash", "slate", "Computer name", a.hostname) + row("clock", "orange", "On for", dur(a.uptime));
  $("#aboutTech").innerHTML = row("info", "blue", "App version", a.version) + row("code" in ICONS ? "code" : "terminal", "green", "Python", a.python) + row("window", "violet", "GTK / WebKitGTK", `${a.gtk || "?"} / ${a.webkit || "?"}`) + row("sparkles", "violet", "Assistant AI", a.ai || "Not connected") + row("file", "slate", "Size", `${a.lines.toLocaleString()} lines of code`);
  const c = a.counts;
  $("#aboutData").innerHTML = `<div class="row"><div class="txt"><b>Everything stays on this computer</b><small>${c.chats} saved chat${c.chats === 1 ? "" : "s"} · ${c.memory} thing${c.memory === 1 ? "" : "s"} the assistant remembers · ${c.favorites} saved command${c.favorites === 1 ? "" : "s"} · ${c.suggestions} personal suggestions</small></div>
    <div class="ctl"><button class="btn" data-launch-path="${esc(a.config_dir)}">${ic("folder")}Settings folder</button><button class="btn" data-launch-path="${esc(a.app_dir)}">${ic("folder")}App folder</button><button class="btn" data-nav="settings">${ic("cog")}Settings</button></div></div>`;

  // In-app self update check
  const u = await api("/api/app/update_check").catch(() => null);
  const ban = $("#updateBanner"), tag = $("#updateTag");
  if (u && ban) {
    if (u.has_update) {
      if (tag) tag.innerHTML = `<span class="chip good">Update available: v${esc(u.latest)}</span>`;
      ban.innerHTML = `<div class="callout good" style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0">
        <div><b>Linux Dashboard ${esc(u.latest)} is ready!</b><br><small style="color:var(--muted)">Current version: ${esc(u.current)}</small></div>
        <div style="display:flex;gap:8px"><a class="btn sm" href="${esc(u.release_url || '#')}" target="_blank">${ic("external")}Release notes</a>
        <button class="btn sm primary" id="applyUpdateBtn">${ic("download")}Update now</button></div></div>`;
      const upBtn = $("#applyUpdateBtn");
      if (upBtn) {
        upBtn.onclick = async () => {
          upBtn.disabled = true;
          upBtn.textContent = "Updating…";
          toast("info", "Downloading and applying update in background…");
          const res = await api("/api/app/update_apply", { method: "POST", body: { url: u.installer_url } }).catch(e => ({ error: e.message }));
          if (res?.ok) {
            toast("ok", "Update started! The dashboard will reload once complete.");
          } else {
            toast("bad", res?.error || "Failed to start update.");
            upBtn.disabled = false;
            upBtn.textContent = "Update now";
          }
        };
      }
    } else {
      if (tag) tag.innerHTML = `<span class="chip plain">Up to date</span>`;
      ban.innerHTML = "";
    }
  }
};

/* ---------- PROBLEM REPORTS: anyone can send one about the dashboard, and read the replies ---------- */
const tkTime = ts => { const d = new Date(String(ts).replace(" ", "T")); if (isNaN(d)) return ts || ""; const s = (Date.now() - d) / 1000;
  return s < 60 ? "just now" : s < 3600 ? Math.round(s / 60) + " min ago" : s < 86400 ? Math.round(s / 3600) + " h ago" : s < 7 * 86400 ? Math.round(s / 86400) + " d ago" : d.toLocaleDateString(); };
const TK_KIND = { bug: ["bug", "Problem"], idea: ["bulb", "Idea"], question: ["info", "Question"] };
const tkStatus = (st, forOwner) => ({ open: ["warn", forOwner ? "Needs reply" : "Sent"], answered: ["good", "Answered"], waiting: ["accent", forOwner ? "Waiting on them" : "Needs your reply"], closed: ["plain", "Closed"] })[st] || ["plain", st];
const tkThread = (msgs, forOwner) => `<div class="tk-thread">${msgs.map(m => { const mine = forOwner ? m.by === "owner" : m.by === "user";
  return `<div class="tk-msg ${mine ? "mine" : ""}"><div class="tk-who">${m.by === "owner" ? (forOwner ? "You" : "Owner") : (forOwner ? "Them" : "You")} · ${esc(tkTime(m.at))}</div><div class="tk-text">${esc(m.text)}</div></div>`; }).join("")}</div>`;
let PREVPAGE = "home";

PAGES.support = () => pageHead("support", "Something wrong with the dashboard, or an idea? Tell the person who looks after it.") +
  `<div id="tkQueued"></div>` +
  sec("New ticket") + `<div class="group"><div class="pad tk-form">
    <div class="tk-formrow"><div class="seg" id="tkKind">${[["bug", "Something's broken", "bug"], ["idea", "Idea", "bulb"], ["question", "Question", "info"]].map(([v, l, i]) => `<button data-v="${v}" class="${v === "bug" ? "on" : ""}">${ic(i)}${l}</button>`).join("")}</div>
      <div class="seg" id="tkSev" title="How much it gets in your way">${[["low", "Minor"], ["normal", "Normal"], ["high", "Blocks me"]].map(([v, l]) => `<button data-v="${v}" class="${v === "normal" ? "on" : ""}">${l}</button>`).join("")}</div></div>
    <input type="text" id="tkTitle" maxlength="120" placeholder="Short title, e.g. “Wi-Fi page doesn't load”">
    <textarea id="tkText" rows="5" maxlength="5000" placeholder="What happened, and what did you expect? Steps to make it happen again help a lot."></textarea>
    <div class="tk-formfoot"><label class="tk-check"><input type="checkbox" id="tkDiag" checked><span>Attach app details <small>version, page, desktop and recent errors. No chats or passwords</small></span></label><button class="btn primary" id="tkSendNew">${ic("upload")}Send ticket</button></div>
  </div></div>` +
  sec("System crash reporter", `<button class="btn sm ghost" id="crashesRefresh">${ic("refresh")}Scan</button>`) +
  `<div class="group" id="crashesList"><div class="pad"><small style="color:var(--muted)">Scanning for system crashes and coredumps…</small></div></div>` +
  sec("My tickets", `<button class="btn sm ghost" id="tkMineRefresh">${ic("refresh")}Refresh</button>`) + `<div id="tkMine">${skeleton(2)}</div>`;

let MY_TK = null, tkOpen = new Set();
async function checkMyTickets(announce = true) {
  const r = await api("/api/tickets/mine", {}).catch(() => null); if (!r || r.error) return;
  const before = TK_UNREAD; MY_TK = r; TK_UNREAD = r.unread;
  if (announce && TK_UNREAD > before) { toast("info", "You have a reply to your ticket", "App → Ticket"); api("/api/notify", { title: "Linux Dashboard", body: "You have a reply to your ticket" }).catch(() => {}); }
  renderNavBadges(); if (CUR === "support") renderMyTickets();
}
function renderMyTickets() {
  const el = $("#tkMine"); if (!el || !MY_TK) return;
  $("#tkQueued").innerHTML = MY_TK.inbox || !MY_TK.tickets.length ? "" : note("Your tickets are saved on this computer and will be delivered once the owner turns on the shared inbox.");
  el.innerHTML = MY_TK.tickets.length ? MY_TK.tickets.map(t => { const [cls, lbl] = tkStatus(t.status, false), [ki] = TK_KIND[t.kind] || TK_KIND.bug;
    return `<details class="group tk-mine" data-tkm="${t.id}" ${tkOpen.has(t.id) ? "open" : ""}><summary>${tile(ki, "red", "soft")}<div class="txt"><b>${t.unread ? `<span class="tk-dot on"></span>` : ""}${esc(t.title)}</b><small>${esc(tkTime(t.updated))} · ${t.messages.length} message${t.messages.length === 1 ? "" : "s"}</small></div><span class="chip ${cls}">${lbl}</span>${ic("chevdown")}</summary>
      <div class="pad">${tkThread(t.messages, false)}
        <div class="tk-replybox"><textarea rows="2" data-tkm-text="${t.id}" placeholder="${t.status === "closed" ? "Write to reopen it…" : "Add more details or answer the owner…"}"></textarea>
        <div class="tk-actions"><button class="btn sm primary" data-tkm-send="${t.id}">${ic("upload")}Send</button>${t.status === "closed" ? `<button class="btn sm" data-tkm-close="${t.id}" data-v="0">${ic("restart")}Reopen</button>` : `<button class="btn sm" data-tkm-close="${t.id}" data-v="1">${ic("check")}It's solved</button>`}</div></div></div></details>`; }).join("")
    : `<div class="group">${empty("checkcircle", "You haven't sent any tickets")}</div>`;
}
async function renderCrashes() {
  const el = $("#crashesList");
  if (!el) return;
  const list = await api("/api/crashes").catch(() => []);
  if (!list?.length) {
    el.innerHTML = `<div class="pad" style="color:var(--muted)">${ic("checkcircle")} No recent crashes recorded by systemd-coredump. Your system is stable!</div>`;
    return;
  }
  el.innerHTML = list.map(c => `
    <div class="row" style="align-items:center">
      ${tile("bug", "red", "soft")}
      <div class="txt">
        <b>${esc(c.name)} (Signal ${c.sig})</b>
        <small>${esc(c.time)} · PID ${c.pid} · ${c.size_mb ? c.size_mb + ' MB dump' : 'Crash entry'}</small>
      </div>
      <div class="ctl">
        <button class="btn sm" data-crash-details="${c.pid}">${ic("terminal")}View trace</button>
      </div>
    </div>
  `).join("");

  $$("#crashesList [data-crash-details]").forEach(btn => {
    btn.onclick = async () => {
      const pid = btn.dataset.crashDetails;
      const res = await api("/api/crash/info?pid=" + pid).catch(() => ({ info: "Failed to load trace." }));
      await modal({
        title: `Crash report for PID ${pid}`,
        text: res.info || "No additional trace available.",
        okText: "Close",
        icon: "bug",
        color: "red"
      });
    };
  });
}
loaders.support = () => { renderMyTickets(); checkMyTickets(false); renderCrashes(); const crBtn = $("#crashesRefresh"); if (crBtn) crBtn.onclick = renderCrashes; };
function tkDiag() {
  return { version: APP_VERSION, page: PREVPAGE, desktop: PLAT.desktopName || "", distro: PLAT.distro || "", window: [innerWidth, innerHeight], theme, accent: SETTINGS.appAccent || "",
    jsErrors: JSERRORS.slice(-10).map(e => ({ at: e.at, msg: String(e.msg).slice(0, 300), where: e.where })), ua: navigator.userAgent };
}

document.addEventListener("click", async e => {
  const t = e.target;
  // reporter side
  const kb = t.closest("#tkKind button, #tkSev button"); if (kb) { $$("button", kb.parentElement).forEach(b => b.classList.toggle("on", b === kb)); return; }
  if (t.closest("#tkSendNew")) {
    const title = $("#tkTitle").value.trim(), text = $("#tkText").value.trim();
    if (!title || !text) return toast("fail", "Add a title and say what happened");
    const r = await api("/api/tickets/new", { title, text, kind: $("#tkKind .on")?.dataset.v, severity: $("#tkSev .on")?.dataset.v, page: PREVPAGE, diag: $("#tkDiag").checked ? tkDiag() : null }).catch(e => ({ error: e.message }));
    if (r.error) return toast("fail", "Couldn't send it", r.error);
    $("#tkTitle").value = $("#tkText").value = ""; tkOpen.add(r.id);
    toast("ok", r.queued ? "Ticket saved" : "Ticket sent", r.queued ? "It'll be delivered when the owner turns on the inbox" : "You'll see the reply here, and get a notice");
    return checkMyTickets(false);
  }
  if (t.closest("#tkMineRefresh")) return checkMyTickets(false);
  const ms = t.closest("[data-tkm-send]"); if (ms) { const id = ms.dataset.tkmSend, ta = $(`[data-tkm-text="${id}"]`), text = ta.value.trim(); if (!text) return ta.focus();
    const r = await api("/api/tickets/reply", { id, text }); if (r.error) return toast("fail", r.error); ta.value = ""; tkOpen.add(id); return checkMyTickets(false); }
  const mc = t.closest("[data-tkm-close]"); if (mc) { const r = await api("/api/tickets/reply", { id: mc.dataset.tkmClose, text: "", close: mc.dataset.v === "1" }); if (r.error) return toast("fail", r.error); toast("ok", mc.dataset.v === "1" ? "Marked as solved" : "Reopened"); return checkMyTickets(false); }
});
document.addEventListener("toggle", e => { const d = e.target.closest?.("[data-tkm]"); if (!d || e.target !== d) return; const id = d.dataset.tkm;
  if (d.open) { tkOpen.add(id); const t = MY_TK?.tickets.find(x => x.id === id); if (t?.unread) { t.unread = false; TK_UNREAD = Math.max(0, TK_UNREAD - 1); renderNavBadges(); d.querySelector(".tk-dot")?.remove(); api("/api/tickets/read", { id }).catch(() => {}); } }
  else tkOpen.delete(id); }, true);
setTimeout(() => checkMyTickets(true), 4000); setInterval(() => checkMyTickets(true), 5 * 60e3);  // tell people when the owner replied


/* ================= build all pages ================= */
window.EXTRAS?.();  // extras.js: wraps a few pages before they are built
$("#main").innerHTML = Object.keys(PAGEINFO).map(id => { BUILDING = id; return `<section class="page" id="page-${id}">${PAGES[id]()}</section>`; }).join("");
NAV.forEach(([, items]) => items.forEach(([id, t, i, c]) => SEARCH.push({ page: id, title: t, desc: "Page", icon: i, color: c, isPage: true })));
SEARCH.push({ page: "about", title: "Take the welcome tour", desc: "A quick walk through where everything is (F1)", icon: "play", color: "violet", tour: true, kw: "tour intro help guide tutorial welcome how to use" });
appMode = seg("appMode", v => { $("#appQuery").placeholder = v === "search" ? "Search e.g. vlc, gimp, discord…" : "Filter installed apps…"; $("#appGo").innerHTML = ic(v === "search" ? "search" : "filter") + (v === "search" ? "Search" : "Filter"); searchApps(); });
procSort = seg("procSort", loadProcs);
asTab = v => { $$("#asTabs button").forEach(b => b.classList.toggle("on", b.dataset.v === v)); ["chat", "history", "guides", "tips"].forEach(k => $("#as-" + k).classList.toggle("hidden", k !== v)); if (v === "tips") renderTips(); if (v === "history") renderHistory(); if (v === "chat") { renderChat(); Ghost.start(); } };
seg("asTabs", asTab);
$("#chatSearch").addEventListener("input", debounce(renderHistory, 200));
$("#devData").addEventListener("change", devData);
$("#fontPick").addEventListener("input", e => { $("#fontPreview").style.fontFamily = fontStack(e.target.value.trim() || SETTINGS.font); });
$("#chat").addEventListener("toggle", e => { const k = e.target.dataset?.k; if (!k) return; const [mi, si] = k.split(":").map(Number); const s = CHAT[mi]?.steps?.[si]; if (s && s.status !== "running") { s.open = e.target.open; saveChat(); } }, true);
$("#asInput").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#asSend").click(); }
  if (e.key === "Tab" && !e.shiftKey && (Complete.accept() || Ghost.accept())) e.preventDefault();
  if (e.key === "ArrowRight" && Complete.active() && e.target.selectionStart === e.target.value.length) { e.preventDefault(); Complete.accept(); }
  if (e.key === "Escape" && Complete.active()) { e.stopPropagation(); Complete.dismiss(); }
});
$("#asInput").addEventListener("scroll", e => { $("#asGhost").scrollTop = e.target.scrollTop; });
["keyup", "click", "focus", "blur"].forEach(ev => $("#asInput").addEventListener(ev, e => { if (e.target.value && !["Tab", "Enter"].includes(e.key)) Complete.update(); }));
$("#asInput").addEventListener("input", e => {
  e.target.style.height = "auto"; e.target.style.height = Math.min(160, e.target.scrollHeight) + "px";
  if (e.target.value) { Ghost.stop(); Complete.update(); } else { Complete.clear(); Ghost.start(2500); }
});
document.addEventListener("visibilitychange", () => { if (!document.hidden && CUR === "assistant") Ghost.start(); });
renderHomeTip();
Eggs.dates();
if (CHAT.length) {  // move a chat from before history existed into the history, then start fresh
  api("/api/chat/save", { id: CHAT_ID, title: chatTitle(), messages: CHAT }).catch(() => {});
  CHAT = []; CHAT_ID = newChatId(); try { localStorage.removeItem("chat"); } catch {}
}
svcScope = seg("svcScope", loadSvcs); svcShow = seg("svcShow", renderSvcs);

/* ================= wiring (event delegation) ================= */
document.addEventListener("click", async e => {
  const t = e.target;
  if (t.closest("#retailor")) { toast("info", "Checking your computer again…"); return tailorDashboard(false); }
  if (t.closest("#regenSuggest")) { if (aiSuggestBusy) return; return loadAISuggestions(true); }
  const fm = t.closest("[data-fanmode]"); if (fm) { const k = fm.dataset.fanmode; if (FAN?.mode === k) return;
    if (k === "overdrive") { const d = $("#odBox"); d.open = true; FAN.odOpen = true; return d.scrollIntoView({ block: "center", behavior: "smooth" }); }
    $$(".fanmode").forEach(b => b.classList.toggle("busy", b === fm));
    await setCtl("fanmode:" + k, true, { label: "Fan mode: " + FAN_MODES.find(m => m[0] === k)[1] }); return loadFan(); }
  if (t.closest("#odStart")) { const rpm = +$("#odRpm").value;
    if (FAN.mode !== "overdrive" && !(await modal({ title: `Run the fans at ${rpm} rpm?`, text: "They'll be loud and stay at this speed until you pick another fan mode, even after restarting the computer.", okText: "Start overdrive", icon: "rocket", color: "orange" }))) return;
    await setCtl("fanoverdrive", rpm, { label: `Fan overdrive ${rpm} rpm`, confirmed: true }); return loadFan(); }
  if (t.closest("#odTest")) {
    if (!(await modal({ title: "Find your fans' real limit?", text: "Takes about a minute. The fans will spin up step by step and get very loud, then go back to how they were.", okText: "Start test", icon: "gauge", color: "orange" }))) return;
    const { cmd } = await api("/api/fan/limitcmd");
    return run(cmd, "Fan limit test", { confirmed: true, after: j => {
      const m = j.text.match(/LIMIT=(\d+)/); if (!m || +m[1] <= 0) return loadFan();
      const lim = +m[1], top = Math.max(...FAN.fans.map(f => f.max));
      setPref("fanLimit", lim);
      toast("ok", lim > top + 50 ? `Your fans reach ${lim} rpm (${Math.round(lim / top * 100)}% of normal)` : `Your fans top out at ${lim} rpm. Apple's controller won't let them go faster`);
      loadFan(); } }); }
  if (t.closest("#fcApply")) { const v = { low: +$("#fcLow").value, high: +$("#fcHigh").value, curve: $("#fcCurve .on").dataset.v };
    await setCtl("fancustom", v, { label: `Fan curve ${v.low}°C → ${v.high}°C` }); return loadFan(); }
  const ps = t.closest("[data-pref-seg] button"); if (ps) { const key = ps.parentElement.dataset.prefSeg; setPref(key, ps.dataset.v); if (key === "tempUnit") { loadStats?.(); if (CUR === "sensors") loaders.sensors(); } return; }
  if (EDITING && t.closest("#navlist a")) e.preventDefault();
  if (t.closest("#navEditBtn")) { EDITING = !EDITING; renderSide(); setSideWidth(SETTINGS.sideWidth || 248, false); return; }
  if (t.closest("#navDone")) { EDITING = false; renderSide(); setSideWidth(SETTINGS.sideWidth || 248, false); return toast("ok", "Sidebar saved"); }
  if (t.closest("#navReset")) { if (!(await modal({ title: "Reset the sidebar?", text: "Puts every section and page back where they started, and shows hidden pages again.", okText: "Reset", icon: "restart" }))) return; SETTINGS.navLayout = null; SETTINGS.hiddenPages = []; saveSettings(); return applySettings(); }
  if (t.closest("#navAddSec")) { const l = navLayout(); l.push({ id: "s" + Date.now().toString(36), name: "New section", items: [] }); saveLayout(l); renderSide(); const inp = $$("#navlist .navsec-name").at(-1); inp.focus(); inp.select(); return; }
  const sd = t.closest("[data-secdel]"); if (sd) { saveLayout(navLayout().filter(s => s.id !== sd.dataset.secdel)); return renderSide(); }
  const nh = t.closest("[data-navhide]"); if (nh) { const k = nh.dataset.navhide, h = new Set(SETTINGS.hiddenPages || []); h.has(k) ? h.delete(k) : h.add(k); SETTINGS.hiddenPages = [...h]; saveSettings(); renderSide(); return; }
  if (t.closest("[data-vertap]")) return tapVersion();
  if (t.closest("#devOff")) { SETTINGS.devMode = false; ["devInspector", "devFps", "devOutlines", "devApiLog", "devRawAnswers", "devConfirmAll", "devSlowmo", "devGrid", "devShowIds"].forEach(k => SETTINGS[k] = false); SETTINGS.devSlowNet = "0"; SETTINGS.devFailRate = "0"; SETTINGS.devModel = ""; saveSettings(); applySettings(); location.hash = "settings"; return toast("ok", "Developer mode is off", "Tap the version 10 times to turn it back on"); }
  if (t.closest("#devRefresh")) return loaders.dev();
  if (t.closest("#devTour")) return startTour();
  if (t.closest("#devTailor")) return tailorDashboard(true);
  if (t.closest("#devAlerts")) {
    const fake = [["devtest1", "services", "bad", "xcircle", "red", "Test: a service failed"], ["devtest2", "storage", "warn", "disk", "orange", "Test: disk getting full"], ["devtest3", "network", "info", "wifi", "blue", "Test: a tip about Wi-Fi"]];
    const real = computeAlerts;
    computeAlerts = () => [...real(), ...fake.map(([id, page, level, icon, color, title]) => ({ id, page, level, icon, color, title, desc: "Developer test alert, goes away in a minute", btn: "" }))];
    refreshAlerts(); setTimeout(() => { computeAlerts = real; refreshAlerts(); }, 60e3); return toast("ok", "Test alerts added for a minute", "Look at Services, Storage and Network");
  }
  if (t.closest("#devBadge")) { UPDATES = { total: 7, repo: 5, aur: 1, flatpak: 1, checked: "now (fake)" }; renderUpdateBadge(); refreshAlerts(); return toast("ok", "Fake: 7 updates waiting"); }
  if (t.closest("#devToasts")) { toast("ok", "This is a success notice", "with a command underneath"); toast("info", "This is an info notice"); return toast("fail", "This is an error notice", "it stays a little longer"); }
  if (t.closest("#devReload")) return location.reload();
  if (t.closest("#devRestart")) { if (!window.webkit?.messageHandlers?.dev) return toast("fail", "Only works in the desktop app"); toast("info", "Restarting…"); return window.webkit.messageHandlers.dev.postMessage(JSON.stringify({ action: "restart" })); }
  if (t.closest("#devGet")) { const p = $("#devPath").value.trim(); $("#devGetOut").textContent = "…"; const t0 = performance.now(); try { const r = await api(p); $("#devGetOut").textContent = `// ${Math.round(performance.now() - t0)} ms\n` + JSON.stringify(r, null, 2).slice(0, 60000); } catch (err) { $("#devGetOut").textContent = String(err); } return; }
  if (t.closest("#devClearLog")) { DEVLOG.length = 0; return renderDevLog(); }
  if (t.closest("#devCss")) { const l = $('link[rel="stylesheet"]'); l.href = "/web/style.css?v=" + Date.now(); return toast("ok", "Styles reloaded"); }
  if (t.closest("#devDiag")) { const r = await api("/api/dev/diagnostics", { client: { page: CUR, size: [innerWidth, innerHeight], jsErrors: JSERRORS.slice(-20), ua: navigator.userAgent } }); return toast("ok", "Diagnostics saved", r.path); }
  if (t.closest("#devErrRefresh")) return api("/api/dev/errors").then(renderDevErrors);
  if (t.closest("#devRisk")) {
    const cmd = $("#devRiskCmd").value; const r = await api("/api/risk", { cmd });
    const lvl = { none: ["good", "Harmless: runs without asking"], caution: ["warn", "Caution: asks first"], danger: ["bad", "Dangerous: asks first, red warning"] }[r.level] || ["plain", r.level];
    return $("#devRiskOut").innerHTML = `<span class="chip ${lvl[0]}">${lvl[1]}</span>${r.admin ? ` <span class="chip warn">needs admin</span>` : ""}${r.warnings.length ? `<div class="warnlist" style="margin-top:10px">${r.warnings.map(w => { const [label, icon, color] = HARM[w.kind] || HARM.system; return `<div class="warnitem">${tile(icon, color, "soft")}<div><b>${label}</b><span>${esc(w.text)}</span></div></div>`; }).join("")}</div>` : `<p style="color:var(--muted);margin:8px 0 0;font-size:13px">No warnings for this command.</p>`}`;
  }
  if (t.closest("#devSpeed")) {
    const back = CUR, res = [], pages = Object.keys(PAGEINFO).filter(p => p !== "dev" && !PAGEINFO[p].secret);
    toast("info", "Timing every page…", "The screen will flick through them");
    for (const p of pages) { const t0 = performance.now(); show(p); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); res.push([p, performance.now() - t0, document.querySelectorAll(`#page-${p} *`).length]); }
    show(back); await new Promise(r => setTimeout(r, 50));
    res.sort((a, b) => b[1] - a[1]); const max = res[0][1];
    return $("#devSpeedOut").innerHTML = sec(`${ic("gauge")} Page speed`) + `<div class="group">${res.map(([p, ms, n]) => `<div class="sensor"><span class="lbl">${esc(PAGEINFO[p].t)}</span><div class="meter ${ms > 120 ? "bad" : ms > 50 ? "warn" : ""}" style="--mc:var(--c-green)"><i style="width:${ms / max * 100}%"></i></div><span class="v">${ms.toFixed(0)} ms</span><span class="v" style="width:110px;color:var(--muted)">${n.toLocaleString()} elements</span></div>`).join("")}</div>`;
  }
  const aq = t.closest("[data-askq]"); if (aq) return askAbout(aq.dataset.askq);
  const dm = t.closest("[data-dismiss]"); if (dm) { SETTINGS.dismissedAlerts = { ...(SETTINGS.dismissedAlerts || {}), [dm.dataset.dismiss]: Date.now() + 864e5 }; saveSettings(); ALERTS = computeAlerts(); renderNavBadges(); renderPageAlerts(CUR); renderSuggestions(); return; }
  const np = t.closest("[data-navpick]"); if (np) { const k = np.dataset.navpick, h = new Set(SETTINGS.hiddenPages || []); h.has(k) ? h.delete(k) : h.add(k); return setPref("hiddenPages", [...h]); }
  const aa = t.closest("[data-app-accent]"); if (aa) return setPref("appAccent", aa.dataset.appAccent);
  const hs = t.closest("[data-home-show]"); if (hs) return setPref(hs.dataset.homeShow, !SETTINGS[hs.dataset.homeShow]);
  const sj = t.closest("[data-set-jump]"); if (sj) return $("#" + sj.dataset.setJump)?.scrollIntoView({ behavior: SETTINGS.reduceMotion ? "auto" : "smooth", block: "start" });
  if (t.closest("#exportBackup")) { const r = await api("/api/export", {}); logActivity("Export backup", "→ " + r.path, true); return toast("ok", "Backup saved", r.path); }
  if (t.closest("#clearHist")) { hist = []; try { localStorage.removeItem("hist"); } catch {} return toast("ok", "Terminal history cleared"); }
  if (t.closest("#clearLog")) { activity.length = 0; renderLog(); return toast("ok", "Activity log cleared"); }
  const ar = t.closest("[data-admin-remember]"); if (ar) { setPref("adminRemember", +ar.dataset.adminRemember); return toast("info", +ar.dataset.adminRemember === 0 ? "Admin actions will ask for your password every time" : "Your admin password will be remembered for " + ar.textContent.toLowerCase()); }
  if (t.closest("#adminLock")) { await api("/api/admin/lock", {}); ADMIN_STATE = { active: false }; renderAdminChip(); return toast("ok", "Locked", "Admin actions will ask for your password again"); }
  const uf = t.closest("[data-usefont]"); if (uf) return useFont(uf.dataset.usefont);
  const inf = t.closest("[data-installfont]"); if (inf) { const f = FONTS[+inf.dataset.installfont];
    const cmd = fontInstallCmd(f); if (!cmd) return toast("fail", "Not available here", `${f.family} isn't packaged for ${PLAT.repoName || "this system"}. You can download it and use “Add a font file”.`);
    return run(cmd, "Install " + (f.name || f.family), { after: async j => { if (j.code !== 0) return; await loadFonts(true); const fam = installedAs(f); if (fam) useFont(fam); } }); }
  if (t.closest("#fontPickUse")) { const v = $("#fontPick").value.trim(); if (!v) return; const fam = FAMILIES.find(x => x.toLowerCase() === v.toLowerCase()); if (!fam) return toast("fail", "That font isn't installed", "Pick one from the list as you type"); return useFont(fam); }
  if (t.closest("#fontAddFile")) {
    if (window.webkit?.messageHandlers?.pick) return window.webkit.messageHandlers.pick.postMessage("font");
    const p = await modal({ title: "Add a font file", text: "Full path to the .ttf or .otf file:", input: { placeholder: HOME + "/Downloads/MyFont.ttf" }, okText: "Add", icon: "type", color: "indigo" });
    if (p) addFontFile(p.replace(/^~/, HOME)); return; }
  const fsb = t.closest("#fontScale button"); if (fsb) { setPref("fontScale", +fsb.dataset.v); applyFont(); return renderFonts(); }
  const ao = t.closest("[data-asopen]"); if (ao) { const box = ao.parentElement, was = box.classList.contains("open"); $$("[data-asopt]").forEach(b => b.classList.remove("open")); box.classList.toggle("open", !was); return renderAsOpts(); }
  const apm = t.closest('[data-aspick="aiModel"]'); if (apm) { $$("[data-asopt]").forEach(b => b.classList.remove("open")); return setAIModel(apm.dataset.v); }
  const ap = t.closest("[data-aspick]"); if (ap) { $$("[data-asopt]").forEach(b => b.classList.remove("open")); setPref(ap.dataset.aspick, ap.dataset.v); return; }
  if (!t.closest("[data-asopt]") && $(".asopt.open")) { $$("[data-asopt]").forEach(b => b.classList.remove("open")); renderAsOpts(); }
  const pl = t.closest("[data-pill]"); if (pl) { setPref(pl.dataset.pill, !SETTINGS[pl.dataset.pill]); return toast("info", `${pl.textContent.trim()} ${SETTINGS[pl.dataset.pill] ? "on" : "off"}`); }
  if (t.closest("details.check summary [data-copy], details.sres summary [data-copy]")) e.preventDefault();
  const sg = t.closest("[data-suggest]"); if (sg) return sendUser(sg.dataset.suggest);
  if (t.closest("#moreIdeas")) { const c = $("#ideaChips"); c.style.opacity = 0; setTimeout(() => { c.innerHTML = ideaChips(); c.style.opacity = 1; }, 150); return; }
  if (t.closest("[data-tab-guides]")) return asTab("guides");
  const gd = t.closest("[data-guide]"); if (gd) return startGuide(gd.dataset.guide);
  const tt = t.closest("[data-trytip]"); if (tt) return tryTip(+tt.dataset.trytip);
  const tc2 = t.closest("[data-tipcat]"); if (tc2) { tipFilter = tc2.dataset.tipcat; return renderTips(); }
  if (t.closest("#tipNext")) { tipIdx = (tipIdx + 1) % TIPS.length; return renderHomeTip(); }
  if (t.closest("[data-alltips]")) { location.hash = "assistant"; return asTab("tips"); }
  const sr = t.closest("[data-srun]"); if (sr) { const [mi, si] = sr.dataset.srun.split(":").map(Number); await runStep(mi, si); return advance(mi); }
  const sk = t.closest("[data-sskip]"); if (sk) { const [mi, si] = sk.dataset.sskip.split(":").map(Number); CHAT[mi].steps[si].status = "skipped"; saveChat(); return advance(mi); }
  const ss = t.closest("[data-sstop]"); if (ss) { const [mi, si] = ss.dataset.sstop.split(":").map(Number); return api("/api/stop", { id: CHAT[mi].steps[si].jobId }); }
  const ex = t.closest("[data-explain]"); if (ex) return sendResults(+ex.dataset.explain, true);
  const cp = t.closest("[data-copy]"); if (cp) { navigator.clipboard.writeText(cp.dataset.copy); return toast("ok", "Command copied"); }
  if (t.closest("#as-chat.ai-off .composer")) return goAISetup();
  if (t.closest("#asSend")) { const v = $("#asInput").value; $("#asInput").value = ""; $("#asInput").style.height = ""; Complete.clear(); Ghost.start(6000); return sendUser(v); }
  if (t.closest("#chatClear")) { asTab("chat"); return newChat(); }
  const oc = t.closest("[data-open-chat]"); if (oc) { await openChat(oc.dataset.openChat); return asTab("chat"); }
  const dc = t.closest("[data-del-chat]"); if (dc) { const c = CHATS.find(x => x.id === dc.dataset.delChat); if (!(await modal({ title: "Delete this chat?", text: c?.title || "", okText: "Delete", danger: true, icon: "trash" }))) return; await api("/api/chat/delete", { id: dc.dataset.delChat }); if (dc.dataset.delChat === CHAT_ID) { CHAT = []; CHAT_ID = newChatId(); renderChat(); } return renderHistory(); }
  if (t.closest("#chatDeleteAll")) { if (!(await modal({ title: "Delete all past chats?", text: "Removes every saved conversation. What the assistant remembers is kept unless you forget it below.", okText: "Delete all", danger: true, icon: "trash" }))) return; await api("/api/chat/delete", { id: "*" }); CHAT = []; CHAT_ID = newChatId(); renderChat(); return renderHistory(); }
  const fg = t.closest("[data-forget]"); if (fg) { const mem = await api("/api/memory"); mem.splice(+fg.dataset.forget, 1); await api("/api/memory", { items: mem }); toast("ok", "Forgotten"); return renderHistory(); }
  if (t.closest("#forgetAll")) { if (!(await modal({ title: "Forget everything?", text: "The assistant will start fresh, without any notes from earlier chats. Your saved chats aren't deleted.", okText: "Forget everything", danger: true, icon: "brain" }))) return; await api("/api/memory", { items: [] }); return renderHistory(); }
  if (t.closest("[data-goto-memory]")) return asTab("history");
  if (t.closest("#outAsk") && curJob) return askAbout(`This command failed (exit code ${curJob.code}):\n\`${curJob.cmd}\`\n\nOutput:\n${cleanText(curJob.text).slice(-1500)}\n\nWhat went wrong, and how do I fix it?`);
  if (t.closest("#cmdExplain")) { const c = $("#cmd").value.trim(); if (!c) return toast("info", "Type a command first"); return askAbout(`Explain this command piece by piece. Don't run anything unless it's useful: \`${c}\``); }
  const tp = t.closest("[data-tilepick]"); if (tp) { const id = tp.dataset.tilepick; return setPref("tiles", SETTINGS.tiles.includes(id) ? SETTINGS.tiles.filter(x => x !== id) : QS.map(q => q[0]).filter(x => x === id || SETTINGS.tiles.includes(x))); }
  const rf = t.closest("[data-refresh]"); if (rf) return setPref("refresh", +rf.dataset.refresh);
  const at = t.closest("#appTheme button"); if (at) { theme = at.dataset.v; try { localStorage.setItem("theme", theme); } catch {} applyTheme(); return applySettings(); }
  if (t.closest("#resetPrefs")) { if (!(await modal({ title: "Reset dashboard settings?", text: "Puts tiles, home sections and behavior back to how they started. Your saved commands are kept.", okText: "Reset", danger: true, icon: "restart" }))) return; SETTINGS = { ...DEFAULTS }; saveSettings(); applySettings(); return toast("ok", "Settings reset"); }
  const qt = t.closest(".qt[data-ctl]"); if (qt) return setCtl(qt.dataset.ctl, !CTL[qt.dataset.ctl]);
  const a = t.closest("[data-act]"); if (a) return runAction(a.dataset.act);
  const nav = t.closest("[data-nav]"); if (nav) { location.hash = nav.dataset.nav; return; }
  const st = t.closest("[data-set]"); if (st) { const v = JSON.parse(st.dataset.v); await setCtl(st.dataset.set, v); if (CUR === "home") loadSuggestions(); if (CUR === "sound") markDevices(); return; }
  const tc = t.closest("[data-toggle-ctl]"); if (tc) return setCtl(tc.dataset.toggleCtl, !CTL[tc.dataset.toggleCtl], { quiet: true });
  const acc = t.closest("[data-accent]"); if (acc) { await setCtl("accent", acc.dataset.accent, { label: "Accent color" }); $$(".swatch").forEach(s => s.classList.toggle("on", s === acc)); return; }
  const wall = t.closest("[data-wall]"); if (wall) { $$(".wall").forEach(w => w.classList.toggle("picked", w === wall)); return setCtl("wallpaper", wall.dataset.wall, { label: "Wallpaper" }); }
  const qtb = t.closest("[data-qtool]"); if (qtb) return runQtool(qtb.dataset.qtool);
  const la = t.closest("[data-launch]"); if (la) { launch(la.dataset.launch); return toast("info", "Opening…", la.dataset.launch); }
  const lp = t.closest("[data-launch-path]"); if (lp) { launch(`xdg-open ${shq(lp.dataset.launchPath)}`); return toast("info", "Opening folder", lp.dataset.launchPath); }
  const cm = t.closest("[data-cmd]"); if (cm) return run(cm.dataset.cmd, cm.dataset.name, { after: () => loaders[CUR]?.() });
  // apps
  const rows = $("#appTable")._rows;
  if (t.closest("[data-in]")) { const p = rows[t.closest("[data-in]").dataset.in]; const cmd = installCmd(p);
    if (p.source === "aur" && !(await modal({ title: "Install from the AUR?", text: "AUR packages are made by the community, not checked by Arch. Fine for popular packages; be careful with obscure ones.", cmd, okText: "Install", icon: "package", color: "orange" }))) return;
    return run(cmd, "Install " + p.name, { confirmed: p.source === "aur", after: j => { if (j.code === 0) { p.installed = true; installedCache = null; renderApps(); toast("ok", p.name + " installed"); } } }); }
  if (t.closest("[data-rm]")) { const p = rows[t.closest("[data-rm]").dataset.rm]; const cmd = removeCmd(p);
    if (!(await modal({ title: `Remove ${p.label || p.name}?`, text: "Uninstalls the app and anything it pulled in that nothing else needs.", cmd, okText: "Remove", danger: true, icon: "trash" }))) return;
    return run(cmd, "Remove " + p.name, { confirmed: true, after: j => { if (j.code === 0) { installedCache = null; if (appMode() === "installed") appRows.splice(appRows.indexOf(p), 1); else p.installed = false; renderApps(); } } }); }
  const pop = t.closest("[data-pop]"); if (pop) { if (appMode() !== "search") $('#appMode [data-v="search"]').click(); $("#appQuery").value = pop.dataset.pop; return searchApps(); }
  // processes
  const kb = t.closest("[data-kill], [data-kill9]");
  if (kb) { const pid = kb.dataset.kill || kb.dataset.kill9, force = !!kb.dataset.kill9, mine = kb.dataset.u === ME;
    const cmd = `${mine ? "" : "pkexec "}kill ${force ? "-9 " : ""}${pid}`;
    if (!(await modal({ title: `${force ? "Force quit" : "End"} ${kb.dataset.n}?`, text: mine ? "Unsaved work in this program will be lost." : "This belongs to the system or another user. Stopping it may cause problems.", cmd, okText: force ? "Force quit" : "End", danger: true, icon: "xcircle" }))) return;
    return run(cmd, "kill " + kb.dataset.n, { confirmed: true, after: () => setTimeout(loadProcs, 500) }); }
  // services
  const sa = t.closest("[data-sa]");
  if (sa) { const unit = sa.parentElement.dataset.u, act = sa.dataset.sa, user = svcScope() === "user";
    if (act === "logs") return run(`journalctl ${user ? "--user " : ""}-u ${shq(unit)} -n 150 --no-pager`, "logs " + unit);
    const cmd = user ? `systemctl --user ${act} ${shq(unit)}` : `pkexec systemctl ${act} ${shq(unit)}`;
    if ((act === "stop" || act === "disable") && !(await modal({ title: `${act[0].toUpperCase() + act.slice(1)} ${unit}?`, text: "Stopping system services you don't recognise can break things (e.g. stopping sddm logs you out).", cmd, okText: act, danger: true, icon: "cog" }))) return;
    return run(cmd + ` && systemctl ${user ? "--user " : ""}status ${shq(unit)} --no-pager | head -12`, act + " " + unit, { confirmed: act === "stop" || act === "disable", after: loadSvcs }); }
  // wifi
  const nets = $("#wifiList")?._nets;
  if (t.closest("[data-wd]")) return run(`nmcli connection down id ${shq(nets[t.closest("[data-wd]").dataset.wd].ssid)}`, "Disconnect Wi-Fi", { after: loaders.network });
  if (t.closest("[data-wpass]")) return run(`nmcli -s -g 802-11-wireless-security.psk connection show id ${shq(nets[t.closest("[data-wpass]").dataset.wpass].ssid)}`, "Wi-Fi password");
  if (t.closest("[data-wc]")) { const n = nets[t.closest("[data-wc]").dataset.wc]; let cmd = `nmcli device wifi connect ${shq(n.ssid)}`;
    if (n.security) { const pw = await modal({ title: "Connect to " + n.ssid, text: "Enter the Wi-Fi password (leave empty if this computer already knows it).", input: { type: "password", placeholder: "Password" }, okText: "Connect", icon: "wifi" }); if (pw === null) return; if (pw) cmd += ` password ${shq(pw)}`; }
    const j = await run(cmd, "Wi-Fi " + n.ssid, { after: loaders.network }); j.cmd = j.cmd.replace(/ password '.*'$/, " password '••••'"); return renderOut(); }
  if (t.closest("#wifiRescan")) return run(`nmcli device wifi rescan; sleep 3; nmcli device wifi list`, "Wi-Fi scan", { after: loaders.network });
  // vms
  const vm = t.closest("[data-vm]");
  if (vm) { const act = vm.dataset.vm, n = vm.dataset.n;
    if (act === "destroy" && !(await modal({ title: `Force off ${n}?`, text: "Like pulling the power cord. Unsaved work in the VM is lost.", okText: "Force off", danger: true, icon: "power" }))) return;
    return run(`virsh -c qemu:///system ${act} ${shq(n)}`, `${act} ${n}`, { confirmed: act === "destroy", after: j => {
      setTimeout(loaders.vms, 1500);
      if (act === "start" && j.code === 0) { launch(`virt-manager --connect qemu:///system --show-domain-console ${shq(n)}`); toast("info", `Opening ${n}…`, "The window shows the virtual machine's screen"); }
    } }); }
  if (t.closest("#vmNew")) return openVmCreate();
  if (t.closest("#vmCancel")) { $("#vmCreate").classList.add("hidden"); VMNEW = null; return; }
  const iso = t.closest("[data-iso]"); if (iso && !iso.disabled) return pickIso(+iso.dataset.iso);
  if (t.closest("#vmRefreshIsos")) return openVmCreate();
  if (t.closest("#vmCreateGo")) return createVm();
  const vt = t.closest("[data-vmtab]"); if (vt && VMNEW) { VMNEW.tab = vt.dataset.vmtab; return renderVmCreate(); }
  const tplCard = t.closest("[data-tpl]"); if (tplCard && VMNEW && !tplCard.classList.contains("busy")) return useTemplate(tplCard.dataset.tpl);
  if (t.closest("#vmPickIso")) {
    if (window.webkit?.messageHandlers?.pick) return window.webkit.messageHandlers.pick.postMessage("iso");
    const p = await modal({ title: "Use an installer file", text: "Full path to the .iso file:", input: { placeholder: HOME + "/Downloads/installer.iso" }, okText: "Use it", icon: "box", color: "teal" });
    if (p) window.__pickedIso(p.replace(/^~/, HOME)); return; }
  const gu = t.closest("[data-geturl]"); if (gu) { toast("info", "Opening the download page in your browser", "When it's downloaded, press Refresh list"); return launch(`xdg-open ${shq(gu.dataset.geturl)}`); }
  const vl = t.closest("[data-vmlogin]"); if (vl) return showVmLogin(vl.dataset.vmlogin);
  const vd = t.closest("[data-vmdel]"); if (vd) { const n = vd.dataset.vmdel;
    if (!(await modal({ title: `Delete ${n}?`, text: "This removes the virtual machine and its virtual disk permanently, including everything installed inside it. Your installer (.iso) file is kept.", okText: "Delete it", danger: true, icon: "trash" }))) return;
    const r = await api("/api/vm/deletecmd", { name: n }); if (r.error) return toast("fail", "Couldn't delete it", r.error);
    return run(r.cmd, "Delete " + n, { confirmed: true, after: () => loaders.vms() }); }
  const vo = t.closest("[data-vm-open]"); if (vo) { toast("info", "Opening " + vo.dataset.vmOpen + "…"); return launch(`virt-manager --connect qemu:///system --show-domain-console ${shq(vo.dataset.vmOpen)}`); }
  // per-app mute
  const sm = t.closest("[data-stream-mute]"); if (sm) { await setCtl("streammute:" + sm.dataset.streamMute, !sm.dataset.m, { quiet: true, label: "App mute" }); return loaders.sound(); }
  // terminal
  const lc = t.closest("[data-learn]"); if (lc) { $("#cmd").value = lc.dataset.learn; return $("#cmd").focus(); }
  if (t.closest("[data-frun]")) { const f = favs[t.closest("[data-frun]").dataset.frun]; return run(f.cmd, f.name); }
  if (t.closest("[data-fdel]")) { const i = t.closest("[data-fdel]").dataset.fdel; if (!(await modal({ title: `Delete "${favs[i].name}"?`, okText: "Delete", danger: true, icon: "trash" }))) return; favs.splice(i, 1); api("/api/favorites", { favorites: favs }); return renderFavs(); }
  const fv = t.closest("[data-fav]"); if (fv) { $("#cmd").value = favs[fv.dataset.fav].cmd; return $("#cmd").focus(); }
});
const sendPreview = debounce((id, v) => setCtl(id, +v, { silent: true }), 60);
const sendSlider = debounce((id, v) => setCtl(id, +v, { quiet: true }), 140);
document.addEventListener("input", e => {
  const el = e.target;
  if (el.id === "accentPick") { setAccentVars(el.value); $("#accentCustom").style.setProperty("--sc", el.value); }  // live preview while picking
  if (el.type === "range" && el.dataset.ctl) { paintRange(el); if (!el.dataset.admin) sendSlider(el.dataset.ctl, el.value); if (el.dataset.preview) sendPreview(el.dataset.preview, el.value); }
  if (el.type === "range" && el.dataset.stream) { el.style.setProperty("--p", el.value / 1.5 + "%"); el.nextElementSibling.textContent = el.value + "%"; streamVol(el.dataset.stream, el.value); }
});
const streamVol = debounce((id, v) => setCtl("stream:" + id, +v, { quiet: true, label: "App volume" }), 120);
document.addEventListener("change", e => {
  const el = e.target;
  if (el.id === "accentPick") return setPref("appAccent", el.value.toLowerCase());
  if (el.type === "range" && el.dataset.ctl && el.dataset.admin) setCtl(el.dataset.ctl, +el.value);
  if (el.type === "checkbox" && el.dataset.ctl) setCtl(el.dataset.ctl, el.checked);
  if (el.tagName === "SELECT" && el.dataset.ctl) setCtl(el.dataset.ctl, el.value);
  if (el.dataset.pref === "sideCompact") SETTINGS.sideWidth = el.checked ? 72 : 248;
  if (el.dataset.pref) return setPref(el.dataset.pref, el.type === "checkbox" ? el.checked : el.value);
  if (el.dataset.defapp) setCtl("defapp:" + el.dataset.defapp, el.value, { label: "Default app" });
  if (el.dataset.autostart) setCtl("autostart:" + el.dataset.autostart, el.checked, { label: "Startup app" });
  if (el.dataset.btdev) setCtl("btdev:" + el.dataset.btdev, el.checked, { label: "Bluetooth device" }).then(() => setTimeout(loaders.network, 800));
});
// page-specific inputs
$("#appGo").onclick = searchApps;
$("#appQuery").onkeydown = e => { if (e.key === "Enter") searchApps(); };
$("#appQuery").oninput = () => { if (appMode() === "installed") renderApps(); };
$("#procFilter").oninput = renderProcs; $("#procAuto").onchange = loadProcs;
$("#svcFilter").oninput = renderSvcs;
$("#streamsRefresh").onclick = () => loaders.sound();
$("#tzApply").onclick = () => { const v = $("#tzInput").value.trim(); if (TZ && !TZ.includes(v)) return toast("fail", "Unknown time zone", "Pick one from the list, e.g. America/New_York"); setCtl("timezone", v); };
$("#hostApply").onclick = () => { const v = $("#hostInput").value.trim(); if (!/^[a-zA-Z0-9-]{1,63}$/.test(v)) return toast("fail", "Use only letters, numbers and dashes"); setCtl("hostname", v); };
$("#findGo").onclick = () => { const n = $("#findName").value.trim(); if (!n) return toast("info", "Type part of a file name"); const w = $("#findIn").value.trim() || "~"; run(`find ${w.startsWith("~") ? w.replace(/^~/, '"$HOME"') : shq(w)} -iname ${shq("*" + n + "*")} -not -path '*/.*' 2>/dev/null | head -200`, "find " + n); };
$("#findName").onkeydown = e => { if (e.key === "Enter") $("#findGo").click(); };
$("#folders").innerHTML = [["home", "Home", ""], ["download", "Downloads", "Downloads"], ["file", "Documents", "Documents"], ["image", "Pictures", "Pictures"], ["monitor", "Desktop", "Desktop"], ["cog", "Settings files", ".config"], ["disk", "Whole computer", "/"]]
  .map(([i, n, p]) => `<button class="btn" data-launch-path="${p.startsWith("/") ? p : (HOME === "~" ? "" : HOME) + "/" + p}" data-rel="${p}">${ic(i)}${n}</button>`).join("");
$("#logGo").onclick = () => { const u = $("#logUnit").value.trim(); if (u) run(`journalctl -u ${shq(u)} -n 200 --no-pager || journalctl --user -u ${shq(u)} -n 200 --no-pager`, "logs " + u); };
$("#logUnit").onkeydown = e => { if (e.key === "Enter") $("#logGo").click(); };
$("#cmdRun").onclick = termRun;
$("#cmd").onkeydown = e => {
  if (e.key === "Enter") termRun();
  else if (e.key === "ArrowUp" && hi < hist.length - 1) { $("#cmd").value = hist[++hi]; e.preventDefault(); }
  else if (e.key === "ArrowDown") { hi = Math.max(-1, hi - 1); $("#cmd").value = hi < 0 ? "" : hist[hi]; e.preventDefault(); }
};
$("#cmdKonsole").onclick = () => { const c = $("#cmd").value.trim(), dir = ($("#cwd").value.trim() || "~").replace(/^~/, HOME); launch(c ? termRunCmd(c, dir) : termOpen(dir)); toast("info", `Opening ${PLAT.terminal.name}…`); };
$("#cmdSave").onclick = async () => {
  const c = $("#cmd").value.trim() || hist[0]; if (!c) return toast("info", "Type a command first");
  const name = await modal({ title: "Save command", text: "Give it a name you'll recognise:", cmd: c, input: { placeholder: "e.g. Back up my documents" }, okText: "Save", icon: "star", color: "amber" });
  if (!name) return; favs.push({ name, cmd: c }); await api("/api/favorites", { favorites: favs }); renderFavs(); toast("ok", "Saved");
};
// wallpaper from file: native picker when running as the desktop app
if ($("#pickWall")) $("#pickWall").onclick = async () => {
  if (window.webkit?.messageHandlers?.pick) { window.webkit.messageHandlers.pick.postMessage("image"); return; }
  const p = await modal({ title: "Use an image as wallpaper", text: "Full path to the image file:", input: { placeholder: HOME + "/Pictures/photo.jpg" }, okText: "Apply", icon: "image", color: "teal" });
  if (p) setCtl("wallpaper", p.replace(/^~/, HOME), { label: "Wallpaper" });
};
async function addFontFile(path) {
  const r = await api("/api/fonts/add", { path });
  if (r.error) return toast("fail", "Couldn't add that font", r.error);
  logActivity("Add font " + r.family, r.cmd, true);
  await loadFonts(true); useFont(r.family);
}
window.__picked = (kind, path) => {
  if (kind === "image" && path) setCtl("wallpaper", path, { label: "Wallpaper" });
  if (kind === "font" && path) addFontFile(path);
  if (kind === "iso" && path) window.__pickedIso(path);
};

/* ================= which AI answers the assistant ================= */
let AI = null, AIFORM = null;  // AIFORM: what's being filled in (provider, model, base_url, models[])
async function refreshAI() { AI = await api("/api/ai/status").catch(() => AI); return AI; }
// no AI connected: the chat box is locked, and trying to use it leads to the AI choice
const aiReady = () => !AI || AI.configured;
const asPlaceholder = () => aiReady() ? "What do you want to do? e.g. “install VLC” or “why is my Wi-Fi slow?”" : "Connect an AI to start chatting. Click here to choose one";
function goAISetup() {
  toast("info", "Connect an AI first", "Pick which AI the assistant should use, then come back to chat");
  if (location.hash.slice(1) === "settings") show("settings"); else location.hash = "settings";
  setTimeout(() => { const b = $("#aiBox"); if (!b) return; b.scrollIntoView({ block: "center", behavior: SETTINGS.reduceMotion ? "auto" : "smooth" }); b.classList.remove("flash"); void b.offsetWidth; b.classList.add("flash"); $("#aiKey")?.focus({ preventScroll: true }); }, 450);
}
function renderAINotice() {
  const off = !!AI && !AI.configured, chat = $("#as-chat"), inp = $("#asInput");
  chat?.classList.toggle("ai-off", off);
  if (inp) { inp.readOnly = off; if (off) { inp.value = ""; Ghost.stop(); } inp.placeholder = asPlaceholder(); }
  if ($("#asSend")) $("#asSend").disabled = off;
  const el = $("#aiNotice"); if (!el || !AI) return;
  el.innerHTML = AI.configured ? "" : `<div class="card pad ainotice">${tile("sparkles", "violet")}<div><b>Connect an AI to use the assistant</b><small>Use Claude with an Anthropic API key, or a key from OpenAI, Google Gemini, OpenRouter and others, or a free local model with Ollama. Guided fixes and tips work without one.</small></div><button class="btn primary" data-ai-setup>${ic("key")}Set up</button></div>`;
}
function renderAIBox() {
  const box = $("#aiBox"); if (!box || !AI) return;
  if (!AIFORM) AIFORM = { provider: AI.provider || "anthropic", model: AI.model || "", base_url: AI.base_url || "", models: [] };
  const P = AI.providers, f = AIFORM, pv = P[f.provider], saved = AI.keys?.[f.provider], current = AI.configured && AI.provider === f.provider;
  const needSdk = f.provider === "anthropic" && !AI.sdk;
  box.innerHTML = `<div class="row">${tile("brain", AI.configured ? "violet" : "slate", AI.configured ? "" : "soft")}<div class="txt"><b>AI for the assistant</b><small>${AI.configured ? `Using <span style="font-weight:600;color:var(--text)">${esc(AI.label)}</span>${AI.key ? " · key " + esc(AI.key) : ""}` : "Not connected yet. Pick a provider below"}</small></div></div>
    <div class="pad aiform">
      ${current && AI.tiers?.length ? `<div class="aitiers"><span>Model</span><div class="seg">${AI.tiers.map(t => `<button class="${t.model === AI.model ? "on" : ""}" data-aitier="${esc(t.model)}" title="${esc(t.desc + " · " + t.model)}">${ic(t.icon)}${esc(t.label)}</button>`).join("")}</div><small>${esc(AI.tiers.find(t => t.model === AI.model)?.desc || "Custom model: " + AI.model)}${AI.effort ? " · Thinking level (Fast / Mid / Smart) applies" : " · This model has no thinking levels"}</small></div>` : ""}
      <div class="aiprovs">${Object.entries(P).map(([id, x]) => `<button class="aiprov ${id === f.provider ? "on" : ""}" data-aiprov="${id}"><b>${esc(x.name)}${AI.provider === id && AI.configured ? ` ${ic("check")}` : ""}</b><small>${esc(x.by)}</small></button>`).join("")}</div>
      ${AI.configured && !current ? `<div class="note">${ic("info")}<div>The assistant is using <b>${esc(aiNow())}</b>. Press <b>Connect</b> to switch to ${esc(pv.name)}; if that doesn't work, it keeps using ${esc(aiNow())}.</div></div>` : ""}
      ${needSdk ? `<div class="note">${ic("download")}<div>Claude needs Anthropic's official Python library. It installs into the dashboard's own folder (no password, nothing system-wide). <button class="btn sm primary" id="aiSdk">${ic("download")}Install Claude support</button></div></div>` : ""}
      ${pv.custom || f.provider === "ollama" ? `<label class="aifield"><span>Server address</span><input type="text" id="aiBase" class="mono" placeholder="${esc(pv.base || "http://localhost:8080/v1")}" value="${esc(f.base_url)}"></label>` : ""}
      ${pv.nokey ? "" : `<label class="aifield"><span>API key</span><input type="password" id="aiKey" autocomplete="off" spellcheck="false" placeholder="${saved ? "Saved. Leave empty to keep it" : esc(pv.hint ? "Paste your key, e.g. " + pv.hint : "Paste your key")}">${pv.keys ? `<button class="btn" data-launch="xdg-open ${esc(pv.keys)}">${ic("external")}${f.provider === "anthropic" ? "Sign in & get a key" : "Get a key"}</button>` : ""}</label>`}
      <label class="aifield"><span>Model</span><input type="text" id="aiModel" class="mono" list="aiModelList" placeholder="${f.provider === "anthropic" ? "claude-opus-5-5" : "Load the list, or type a model name"}" value="${esc(f.model)}"><datalist id="aiModelList">${f.models.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join("")}</datalist><button class="btn" id="aiLoad" ${needSdk ? "disabled" : ""}>${ic("refresh")}Load list</button></label>
      <div class="aiacts"><button class="btn primary" id="aiSave" ${needSdk ? "disabled" : ""}>${ic("check")}${current ? "Save & test" : "Connect"}</button>${saved || (current && pv.nokey) ? `<button class="btn ghost danger" id="aiForget">${ic("trash")}${pv.nokey ? "Disconnect" : "Remove key"}</button>` : ""}<span class="aimsg" id="aiMsg"></span></div>
      <p class="aipriv">${ic("lock")} Your key stays on this computer, in the system keyring. What you ask the assistant, and facts about this computer, go to the provider you pick. ${f.provider === "ollama" ? "With Ollama everything stays on this computer." : ""}</p>
    </div>`;
}
function aiReadForm() {
  if (!AIFORM) return;
  AIFORM.model = $("#aiModel")?.value.trim() ?? AIFORM.model;
  AIFORM.base_url = $("#aiBase")?.value.trim() ?? AIFORM.base_url;
}
const aiMsg = (kind, text) => { const m = $("#aiMsg"); if (m) { m.className = "aimsg " + kind; m.innerHTML = text; } };
async function aiLoadModels() {
  aiReadForm(); aiMsg("", "Loading models…");
  const r = await api("/api/ai/models", { provider: AIFORM.provider, key: $("#aiKey")?.value.trim() || "", base_url: AIFORM.base_url }).catch(e => ({ error: e.message }));
  if (r.error) return aiMsg("bad", esc(r.error));
  AIFORM.models = r.models; if (!AIFORM.model && r.models.length) AIFORM.model = r.models[0].id;
  renderAIBox(); aiMsg("good", `${r.models.length} models available. Pick one, or keep the suggestion.`);
}
async function aiSave() {
  aiReadForm();
  const key = $("#aiKey")?.value.trim() || "";
  if (!AIFORM.model) {
    const provDefaults = { anthropic: "claude-opus-5-5", gemini: "gemini-3.7-flash", openai: "gpt-4o", groq: "llama-3.3-70b-versatile", mistral: "mistral-large-latest", xai: "grok-2", deepseek: "deepseek-chat" };
    if (provDefaults[AIFORM.provider]) AIFORM.model = provDefaults[AIFORM.provider];
  }
  if (!AIFORM.model) { await aiLoadModels(); if (!AIFORM.model) return; }
  $("#aiSave").disabled = true; aiMsg("", `${ic("refresh")} Checking it works…`);
  const r = await api("/api/ai/save", { provider: AIFORM.provider, key, model: AIFORM.model, base_url: AIFORM.base_url }).catch(e => ({ error: e.message }));
  if ($("#aiSave")) $("#aiSave").disabled = false;
  if (r.error) { await refreshAI(); renderAsOpts(); return aiMsg("bad", esc(r.error) + (AI?.configured && AI.provider !== AIFORM.provider ? ` Still using ${esc(aiNow())}.` : "")); }
  AI = r.status; AIFORM = null; renderAIBox(); renderAINotice(); renderAsOpts();
  aiMsg("good", `${ic("checkcircle")} Connected: ${esc(r.model)} answered in ${r.seconds}s.${r.where === "file" ? " (No keyring found, so the key is in a file only you can read.)" : ""}`);
  toast("ok", `Assistant now uses ${aiNow()}`, AI.model);
}
async function setAIModel(model) {
  if (!model || model === AI?.model) return renderAsOpts();
  const r = await api("/api/ai/model", { model }).catch(e => ({ error: e.message }));
  if (r.error) return toast("fail", "Couldn't switch model", r.error);
  AI = r; AIFORM = null; renderAsOpts(); renderAIBox();
  const t = AI.tiers?.find(x => x.model === model);
  toast("ok", `Now using ${aiNow()}`, model);
}
async function aiForget() {
  const pv = AI.providers[AIFORM.provider];
  if (!(await modal({ title: pv.nokey ? `Disconnect ${pv.name}?` : `Remove your ${pv.name} key?`, text: "The assistant stops working until you connect an AI again.", okText: "Remove", danger: true, icon: "key" }))) return;
  AI = await api("/api/ai/forget", { provider: AIFORM.provider }); AIFORM = null; renderAIBox(); renderAINotice(); toast("ok", "Removed");
}
document.addEventListener("click", async e => {
  const t = e.target;
  if (t.closest("[data-ai-setup]")) return goAISetup();
  const pb = t.closest("[data-aiprov]"); if (pb) { aiReadForm(); const id = pb.dataset.aiprov; AIFORM = { provider: id, model: AI.provider === id ? AI.model : "", base_url: AI.provider === id ? AI.base_url : "", models: [] }; renderAIBox(); return; }
  const tb = t.closest("[data-aitier]"); if (tb) return setAIModel(tb.dataset.aitier);
  if (t.closest("#aiLoad")) return aiLoadModels();
  if (t.closest("#aiSave")) return aiSave();
  if (t.closest("#aiForget")) return aiForget();
  if (t.closest("#aiSdk")) { aiReadForm(); return run(AI.sdkCmd, "Install Claude support", { confirmed: true, after: async j => { if (j.code === 0) { await refreshAI(); renderAIBox(); toast("ok", "Claude support installed"); } } }); }
});
document.addEventListener("keydown", e => { if (e.key === "Enter" && ["aiKey", "aiModel", "aiBase"].includes(e.target.id)) { e.preventDefault(); aiSave(); } });
refreshAI();

/* ================= tailor the dashboard to this computer (first start, or "Check again") ================= */
let PROFILE = {};
const MODEL_NAMES = { "iMacPro1,1": "iMac Pro (2017)", "iMac20,1": "iMac (2020)", "iMac20,2": "iMac (2020)", "MacBookPro16,1": "MacBook Pro 16″ (2019)",
  "MacBookPro15,1": "MacBook Pro 15″ (2018)", "MacBookAir9,1": "MacBook Air (2020)", "Macmini8,1": "Mac mini (2018)", "MacPro7,1": "Mac Pro (2019)" };
const modelName = p => p.model ? (MODEL_NAMES[p.model] || `${p.vendor && !p.model.includes(p.vendor.split(" ")[0]) ? p.vendor.replace(/ Inc\.?| Corporation| Co\., Ltd\.?/g, "") + " " : ""}${p.model}`) : "this computer";
async function tailorDashboard(firstRun) {
  if (tailorDashboard.busy) return; tailorDashboard.busy = true;
  try { await tailorRun(firstRun); } finally { tailorDashboard.busy = false; }
}
async function tailorRun(firstRun) {
  if (firstRun) toast("info", "Getting to know your computer…", "Checking the hardware so the dashboard fits it. This runs in the background.");
  const p = await api("/api/profile/scan", {}).catch(() => null); if (!p) return;
  PROFILE = p;
  const changes = [], tiles = [...(SETTINGS.tiles || DEFAULTS.tiles)], hidden = new Set(SETTINGS.hiddenPages || []);
  const dropTile = (id, why) => { const i = tiles.indexOf(id); if (i >= 0) { tiles.splice(i, 1); changes.push(why); } };
  if (!p.wifi && !p.wifi_hw?.length) dropTile("wifi", "Hid the Wi-Fi tile: there's no Wi-Fi card");
  if (!p.bluetooth) dropTile("bluetooth", "Hid the Bluetooth tile: there's no Bluetooth");
  if (!p.wifi && !p.wifi_hw?.length && !p.bluetooth) dropTile("airplane", "Hid Airplane mode: no wireless radios to switch off");
  if (!p.governor) dropTile("performance", "Hid Performance mode: this CPU doesn't offer it");
  if (!p.virt && !hidden.has("vms")) { hidden.add("vms"); changes.push("Hid Virtual Machines: no VM software installed"); }
  if (!p.pointers?.length && !hidden.has("mouse")) { hidden.add("mouse"); changes.push("Hid Mouse & Touchpad: no mouse found"); }
  // what it found that matters
  const found = [`${modelName(p)} · ${p.cpu?.replace(/\(R\)|\(TM\)|CPU|@.*$/g, "").replace(/\s+/g, " ").trim()} · ${p.ram_gb} GB memory`];
  if (p.gpus?.length) found.push("Graphics: " + p.gpus.map(g => g.replace(/^.*\[(.+?)\]\s*$/, "$1").replace(/Advanced Micro Devices, Inc\. |\(rev .*\)/g, "")).join(", "));
  if (p.fans) found.push("Mac fan control is available (Sensors & Fans)");
  if (p.wifi_hw?.length && !p.wifi) found.push("Your Wi-Fi card is there but not working yet (see Network)");
  if (p.battery) found.push("Battery found");
  SETTINGS.tiles = tiles; SETTINGS.hiddenPages = [...hidden];
  SETTINGS.tailored = { date: p.scanned, changes, found };
  saveSettings(); applySettings(); refreshAlerts(true); renderTailorInfo();
  if (!aiSuggest?.phrases?.length) loadAISuggestions();  // personal suggestions for the assistant, made in the background
  toast("ok", `Tailored for your ${modelName(p)}`, [...found.slice(0, 2), ...changes].join(" · "));
}
function renderTailorInfo() {
  const el = $("#tailorInfo"); if (!el) return;
  const t = SETTINGS.tailored;
  el.innerHTML = t ? `Checked ${esc(t.date)}${t.changes.length ? ` · ${t.changes.length} change${t.changes.length > 1 ? "s" : ""}: ${esc(t.changes.join("; "))}` : " · nothing needed changing"}` : "Not checked yet";
}

/* ================= slider value bubble ================= */
const sliderTip = document.createElement("div"); sliderTip.id = "sliderTip"; document.body.append(sliderTip);
function showSliderTip(el) {
  const r = el.getBoundingClientRect(), p = (el.value - el.min) / (el.max - el.min);
  const fmt = FMT[el.dataset.ctl] || (v => v + (el.dataset.unit || ""));
  sliderTip.textContent = el.id === "fcLow" || el.id === "fcHigh" ? fmtTemp(+el.value) : el.id === "odRpm" ? el.value + " rpm" : fmt(el.value);
  sliderTip.style.left = r.left + 9 + p * (r.width - 18) + "px"; sliderTip.style.top = r.top - 8 + "px";
  sliderTip.classList.add("show");
}
document.addEventListener("input", e => { if (e.target.type === "range") showSliderTip(e.target); });
["change", "pointerup", "blur"].forEach(ev => document.addEventListener(ev, e => { if (e.target.type === "range" || ev === "pointerup") sliderTip.classList.remove("show"); }, true));

/* ================= welcome tour (first launch, or from About) ================= */
const TOUR = [
  { sel: ".brand", icon: "logo", title: "Welcome to Linux Dashboard", text: "Everything you'd normally do in a terminal, with buttons and plain English. This quick tour shows you around. It takes about a minute." },
  { sel: ".qs", page: "home", icon: "sliders", title: "Quick settings", text: "Wi-Fi, Bluetooth, dark mode, night light and more, one click each. Below are sliders for volume and brightness, and live graphs of how your computer is doing." },
  { sel: "#suggest", page: "home", icon: "bulb", title: "Suggestions", text: "If something needs attention, like a full disk or a failed service, it shows up here with a button to fix it, plus a badge on that page in the sidebar." },
  { sel: "#openPalette", icon: "search", title: "Search everything", text: "Press Ctrl+K and type what you're after, like “wifi”, “fan” or “wallpaper”. Or type a question and it goes straight to the assistant." },
  { sel: '#navlist a[data-page="assistant"]', icon: "sparkles", title: "Ask the assistant", text: "Describe what you want in your own words. It explains each step, runs it for you, and tells you what it found. Its page also has guided fixes for common problems and over 40 tips." },
  { sel: '#navlist a[data-page="apps"]', icon: "package", title: "Apps & updates", text: `Search for apps from ${SOURCES_TEXT}, install them with one click, and keep everything up to date.` },
  { sel: "#drawer header", icon: "shield", title: "See what's happening, safely", text: "Every change shows up here with the exact command that did it. Before anything risky the dashboard explains what could go wrong and asks first, and admin rights need your password only once every few minutes." },
  { sel: "#navEditBtn", icon: "pencil", title: "Make it yours", text: "Rearrange the sidebar with the pencil, drag its edge to resize it, and change fonts, colours and more in Dashboard settings. Want this tour again? Press F1 any time. Enjoy!" },
];
let tourStep = -1;
function startTour() { tourStep = 0; if (!$("#tour")) document.body.insertAdjacentHTML("beforeend", `<div id="tour"><div class="tour-ring"></div><div class="tour-card"></div></div>`); $("#tour").classList.add("open"); renderTour(); }
function endTour() { const t = $("#tour"); if (!t) return; t.classList.remove("open"); tourStep = -1; if (!SETTINGS.seenTour) { SETTINGS.seenTour = true; saveSettings(); } }
function renderTour() {
  const st = TOUR[tourStep];
  if (st.page && CUR !== st.page) { location.hash = st.page; return setTimeout(renderTour, 450); }  // show the step on its page
  const el = $(st.sel), ring = $("#tour .tour-ring"), card = $("#tour .tour-card");
  const r = el ? el.getBoundingClientRect() : { left: innerWidth / 2 - 100, top: innerHeight / 2 - 30, width: 200, height: 60 };
  Object.assign(ring.style, { left: r.left - 6 + "px", top: r.top - 6 + "px", width: r.width + 12 + "px", height: r.height + 12 + "px" });
  card.innerHTML = `<div class="tour-top">${st.icon === "logo" ? `<img src="/web/app-icon.svg" alt="">` : tile(st.icon, "violet")}<div class="tour-step">${tourStep + 1} of ${TOUR.length}</div></div><h3>${st.title}</h3><p>${st.text}</p>
    <div class="tour-dots">${TOUR.map((_, i) => `<i class="${i === tourStep ? "on" : i < tourStep ? "done" : ""}"></i>`).join("")}</div>
    <div class="tour-btns"><button class="btn ghost sm" data-tour="skip">Skip tour</button><span style="flex:1"></span>${tourStep ? `<button class="btn sm" data-tour="back">Back</button>` : ""}<button class="btn primary sm" data-tour="next">${tourStep === TOUR.length - 1 ? "Done" : "Next"}</button></div>`;
  const cw = 320, below = r.top + r.height + 16 + 190 < innerHeight;
  let left = Math.min(Math.max(12, r.left + r.width + 18), innerWidth - cw - 12);
  if (r.left + r.width + 18 + cw > innerWidth) left = Math.max(12, r.left + r.width / 2 - cw / 2);
  const top = r.left + r.width + 18 + cw <= innerWidth ? Math.min(Math.max(12, r.top), innerHeight - 200) : below ? r.top + r.height + 16 : Math.max(12, r.top - 200);
  Object.assign(card.style, { left: left + "px", top: top + "px" });
  card.classList.remove("pop"); void card.offsetWidth; card.classList.add("pop");
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-tour]"); if (b) { const a = b.dataset.tour; if (a === "skip") return endTour(); tourStep += a === "next" ? 1 : -1; if (tourStep >= TOUR.length) return endTour(); return renderTour(); }
  if (e.target.closest("#replayTour, [data-start-tour]")) startTour();
});
window.addEventListener("resize", () => { if (tourStep >= 0) renderTour(); });
document.addEventListener("keydown", e => {
  if (tourStep < 0) return;
  if (e.key === "Escape") { e.stopImmediatePropagation(); endTour(); }
  if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); $('[data-tour="next"]')?.click(); }
  if (e.key === "ArrowLeft") $('[data-tour="back"]')?.click();
}, true);

/* ================= command palette ================= */
let pSel = 0, pItems = [];
$("#pIcon").innerHTML = ic("search");
function openPalette() { clearTimeout($("#palette")._ct); $("#palette").classList.remove("closing"); $("#palette").classList.add("open"); $("#pInput").value = ""; renderPalette(); setTimeout(() => $("#pInput").focus(), 20); }
function closePalette() { closeOverlay($("#palette")); }
function renderPalette() {
  const raw = $("#pInput").value.trim(), q = raw.toLowerCase(), words = q.split(/\s+/).filter(Boolean);
  const score = s => { const t = s.title.toLowerCase(), hay = (t + " " + (s.desc || "") + " " + (s.kw || "") + " " + PAGEINFO[s.page]?.t).toLowerCase(); if (!words.every(w => hay.includes(w))) return -1; return (t === q ? 5 : 0) + (t.startsWith(q) ? 3 : 0) + (t.includes(q) ? 2 : 0) + (words.every(w => t.includes(w)) ? 1 : 0) + (s.isPage ? 1 : 0); };
  const seen = new Set();
  let list = SEARCH.filter(s => (s.page !== "dev" || SETTINGS.devMode) && !PAGEINFO[s.page]?.secret).map(s => [score(s), s]).filter(([sc]) => sc >= 0).sort((a, b) => b[0] - a[0]).map(([, s]) => s)
    .filter(s => { const k = s.title + s.page; if (seen.has(k)) return false; seen.add(k); return true; });
  if (!q) list = list.filter(s => s.isPage);  // nothing typed: just the pages, like a clean launcher
  list = list.slice(0, q ? 24 : 30);
  const groups = [["Pages", list.filter(s => s.isPage)], ["Actions", list.filter(s => !s.isPage && s.act)], ["Settings", list.filter(s => !s.isPage && !s.act)]];
  pItems = []; let html = "";
  const mark = t => { const e = esc(t); if (!words.length) return e; return e.replace(new RegExp("(" + words.map(w => esc(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "ig"), "<mark>$1</mark>"); };
  const item = (s, i) => `<div class="it ${i === pSel ? "sel" : ""}" data-pi="${i}">${tile(s.icon, s.color, "soft")}<div class="tx"><b>${s.ask ? esc(s.title) : mark(s.title)}</b>${s.desc && q ? `<small>${esc(s.desc)}</small>` : ""}</div>${s.isPage || s.ask ? "" : `<span class="where">${esc(PAGEINFO[s.page]?.t || "")}</span>`}<span class="go">${ic("chevright")}</span></div>`;
  for (const [name, items] of groups) { if (!items.length) continue; html += `<div class="grp">${name}</div>`; for (const s of items) { html += item(s, pItems.length); pItems.push(s); } }
  if (q) { const ask = { title: `Ask the assistant: “${raw}”`, desc: "It explains the steps and runs them for you", icon: "sparkles", color: "violet", ask: raw, page: "assistant" }; html += `<div class="grp">Not finding it?</div>` + item(ask, pItems.length); pItems.push(ask); }
  pSel = Math.min(pSel, Math.max(0, pItems.length - 1));
  $("#pRes").innerHTML = q && pItems.length === 1 ? `<div class="empty">${ic("search")}<div>No settings match “${esc(raw)}”</div></div>` + html : html;
  $("#pRes").querySelectorAll(".it").forEach(el => el.classList.toggle("sel", +el.dataset.pi === pSel));
}
function choosePalette(i) {
  const s = pItems[i]; if (!s) return; closePalette();
  if (s.ask) return askAbout(s.ask);
  if (s.tour) return startTour();
  if (s.guide) return startGuide(s.guide);
  if (s.act && s.page === "home") return runAction(s.act);
  if (location.hash.slice(1) !== s.page) { history.replaceState(null, "", "#" + s.page); }
  show(s.page, s.isPage ? null : s.anchor);
}
$("#openPalette").onclick = openPalette;
$("#pInput").oninput = () => { pSel = 0; renderPalette(); };
$("#pInput").onkeydown = e => {
  if (e.key === "ArrowDown") { pSel = Math.min(pItems.length - 1, pSel + 1); renderPalette(); e.preventDefault(); $(".it.sel")?.scrollIntoView({ block: "nearest" }); }
  if (e.key === "ArrowUp") { pSel = Math.max(0, pSel - 1); renderPalette(); e.preventDefault(); $(".it.sel")?.scrollIntoView({ block: "nearest" }); }
  if (e.key === "Enter" && Eggs.match(e.target.value)) { closePalette(); return Eggs.try(e.target.value); }
  if (e.key === "Enter") choosePalette(pSel);
};
$("#pRes").onclick = e => { const it = e.target.closest("[data-pi]"); if (it) choosePalette(+it.dataset.pi); };
$("#palette").onclick = e => { if (e.target.id === "palette") closePalette(); };
$("#modal").onclick = e => { if (e.target.id === "modal") modal.cancel?.(); };
document.addEventListener("keydown", e => {
  if (e.key === "F1") { e.preventDefault(); if (tourStep < 0) startTour(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("#palette").classList.contains("open") ? closePalette() : openPalette(); }
  if (e.ctrlKey && e.key === "`") { e.preventDefault(); drawerOpen(!$("#drawer").classList.contains("open")); }
  if (e.key === "Escape") { if ($("#palette").classList.contains("open")) closePalette(); else if ($("#modal").classList.contains("open")) modal.cancel?.(); else drawerOpen(false); }
});

document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.dataset?.qt) { e.preventDefault(); runQtool(e.target.dataset.qt); } });

/* ================= boot ================= */
renderTabs();
setInterval(tickClock, 1000); tickClock();
api("/api/stats").then(s => { ME = s.user; $("#whoami").textContent = s.user + "@" + s.hostname; });
api("/api/home").then(h => { HOME = h.home; $("#openCfg").dataset.launchPath = HOME + "/.config/linux-dashboard"; $$("#folders [data-rel]").forEach(b => { const p = b.dataset.rel; b.dataset.launchPath = p.startsWith("/") ? p : HOME + "/" + p; }); });
api("/api/profile").then(p => { PROFILE = p || {}; }).catch(() => {});
loadCtl().then(() => { refreshAlerts(true); setTimeout(() => { if (!SETTINGS.tailored) tailorDashboard(true); }, 2500); if (CUR === "home") loadSuggestions(); if (CUR === "sensors") loaders.sensors(); });
api("/api/settings").then(st => {
  SETTINGS = { ...DEFAULTS, ...st };
  applySettings();
  const start = SETTINGS.startPage === "last" ? SETTINGS.lastPage : SETTINGS.startPage;
  show(location.hash.slice(1) || start || "home");
  if (!SETTINGS.seenTour) setTimeout(startTour, 900);
}).catch(() => show(location.hash.slice(1) || "home"));
setInterval(() => { if (!document.hidden && ["home", "sound", "display", "network", "power"].includes(CUR)) loadCtl(); }, 8000);
