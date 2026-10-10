/* Extras: quick fixes, firewall rules, battery history + alerts, clipboard history, backups, profiles.
   Loaded before app.js; app.js calls window.EXTRAS() right before it builds the pages. */
window.EXTRAS = () => {
  const dq = s => '"' + String(s).replace(/(["\\`$])/g, "\\$1") + '"';  // double-quote for the shell
  const row = (icon, color, title, desc, ctl = "", id = "") => `<div class="row"${id ? ` id="${id}"` : ""}>${tile(icon, color, "soft")}<div class="txt"><b>${title}</b>${desc ? `<small>${desc}</small>` : ""}</div><div class="ctl">${ctl}</div></div>`;
  const fmtDur = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h} h ${m} min` : `${m} min`; };

  /* ---------- quick fixes (Home) ---------- */
  Object.assign(A, {
    dropCaches: { t: "Free up memory", d: "Clear the RAM cache. Safe, nothing is lost", i: "memory", c: "cyan", admin: true, cmd: `free -h | head -2; sync; pkexec sh -c 'echo 3 > /proc/sys/vm/drop_caches'; echo; free -h | head -2` },
    restartWifi: { t: "Restart Wi-Fi", d: "Turn the radio off and on again", i: "wifi", c: "blue", cmd: `nmcli radio wifi off; sleep 1; nmcli radio wifi on; sleep 4; nmcli -t -f ACTIVE,SSID dev wifi | grep '^yes' || echo "Reconnecting…"` },
    restartBt: { t: "Restart Bluetooth", d: "Fixes devices that won't connect", i: "bluetooth", c: "indigo", admin: true, cmd: `pkexec systemctl restart bluetooth && echo "Bluetooth restarted."` },
    flushDns: { t: "Flush DNS cache", d: "Fixes sites that won't load after a network change", i: "globe", c: "teal", admin: true, cmd: `pkexec resolvectl flush-caches && echo "DNS cache cleared."` },
  });
  const homePage = PAGES.home;
  PAGES.home = () => homePage() + sec("Quick fixes") + acts(["restartAudio", "restartWifi", "restartBt", "dropCaches", "flushDns", "restartPlasma"]);

  /* ---------- firewall rules (Network) ---------- */
  const netPage = PAGES.network;
  PAGES.network = () => {
    const a = reg({ title: "Firewall rules", desc: "Allow or block ports and services (UFW)", icon: "shield", color: "red", kw: "ufw port allow deny block" });
    return netPage() + sec("Firewall rules", `<button class="btn sm ghost" id="fwRefresh">${ic("refresh")}Load rules</button>`) +
      `<div class="field" id="${a}"><select id="fwAction"><option value="allow">Allow</option><option value="deny">Block</option></select><input type="text" id="fwRule" placeholder="Port or service, e.g. 22/tcp, 8080, ssh"><button class="btn primary" id="fwAdd">${ic("plus")}Add rule</button></div>` +
      `<div class="group" id="fwList" style="margin-top:12px">${empty("shield", "Press “Load rules” to see them. This asks for your password.")}</div>`;
  };
  const FW_RE = /^\[\s*(\d+)\]\s+(.+?)\s{2,}(ALLOW|DENY|REJECT|LIMIT)(?: (IN|OUT|FWD))?\s+(.+)$/;
  async function loadFw() {
    const j = await run("pkexec ufw status numbered", "Firewall rules", { confirmed: true });
    const el = $("#fwList"); if (!el || !j || j.cancelled) return;
    const active = /Status:\s*active/i.test(j.text), rules = j.text.split("\n").map(l => l.match(FW_RE)).filter(Boolean);
    const head = row("shield", active ? "green" : "orange", active ? "Firewall is on" : "Firewall is off", active ? `${rules.length} rule${rules.length === 1 ? "" : "s"}. Anything not allowed is blocked.` : "Rules are saved but not enforced. Turn it on above, under Sharing & Security.");
    el.innerHTML = head + rules.map(m => row(m[3] === "ALLOW" ? "checkcircle" : "xcircle", m[3] === "ALLOW" ? "green" : "red", esc(m[2]), `${esc(m[3].toLowerCase())}${m[4] ? " " + m[4].toLowerCase() : ""} · from ${esc(m[5].trim())}`, `<button class="btn sm danger" data-fwdel="${m[1]}">Delete</button>`)).join("");
  }
  async function addFw() {
    const rule = $("#fwRule").value.trim(), act = $("#fwAction").value;
    if (!/^[A-Za-z0-9_.:\/-]{1,40}$/.test(rule)) return toast("fail", "That doesn't look like a port or service", "Try 22/tcp, 8080 or ssh");
    const j = await run(`pkexec ufw ${act === "deny" ? "deny" : "allow"} ${shq(rule)}`, `Firewall: ${act} ${rule}`, { confirmed: true });
    if (j?.code === 0) { $("#fwRule").value = ""; loadFw(); }
  }

  /* ---------- battery history + alerts (Power) ---------- */
  const powerPage = PAGES.power;
  PAGES.power = () => powerPage() + `<div id="batHist"></div>`;
  const powerLoader = loaders.power;
  loaders.power = async () => { await powerLoader(); loadBatHist(); };
  let batRange = "24";
  const alertCfg = () => ({ on: true, levels: [20, 10], full: 0, ...(SETTINGS.batAlerts || {}) });
  function batChart(samples, hours) {
    const W = 640, H = 200, L = 34, R = 8, T = 8, B = 22, now = Date.now() / 1000, t0 = now - hours * 3600;
    const x = t => L + (t - t0) / (now - t0) * (W - L - R), y = p => T + (100 - p) / 100 * (H - T - B);
    let grid = "";
    [0, 25, 50, 75, 100].forEach(p => grid += `<line x1="${L}" x2="${W - R}" y1="${y(p)}" y2="${y(p)}" stroke="var(--line, rgba(128,128,128,.25))" stroke-width="1"/><text x="${L - 6}" y="${y(p) + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${p}</text>`);
    const lab = t => { const d = new Date(t * 1000); return hours > 48 ? d.toLocaleDateString([], { month: "short", day: "numeric" }) : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };
    const axis = [0, .25, .5, .75, 1].map(f => { const t = t0 + f * (now - t0); return `<text x="${x(t)}" y="${H - 5}" text-anchor="${f === 0 ? "start" : f === 1 ? "end" : "middle"}" font-size="10" fill="var(--muted)">${lab(t)}</text>`; }).join("");
    // split into runs: a new run when the state changes between charging and not, or after a gap
    const runs = []; let cur = null;
    samples.forEach(s => { const chg = s[3] === "C" || s[3] === "F"; if (!cur || cur.chg !== chg || s[0] - cur.last > 600) { cur = { chg, pts: [], last: s[0] }; runs.push(cur); } cur.pts.push(s); cur.last = s[0]; });
    const paths = runs.map(r => {
      const d = r.pts.map((s, i) => `${i ? "L" : "M"}${x(s[0]).toFixed(1)},${y(s[1]).toFixed(1)}`).join("");
      const col = r.chg ? "var(--c-green)" : "var(--c-blue)";
      const area = r.pts.length > 1 ? `<path d="${d}L${x(r.pts.at(-1)[0]).toFixed(1)},${y(0)}L${x(r.pts[0][0]).toFixed(1)},${y(0)}Z" fill="${col}" opacity=".12"/>` : "";
      return area + `<path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    }).join("");
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">${grid}${axis}${paths}</svg>`;
  }
  function batStats(samples) {
    if (samples.length < 2) return "";
    let dischargeS = 0, chargeS = 0, wSum = 0, wN = 0, drop = 0;
    for (let i = 1; i < samples.length; i++) {
      const dt = samples[i][0] - samples[i - 1][0]; if (dt > 600) continue;
      if (samples[i][3] === "D") { dischargeS += dt; drop += samples[i - 1][1] - samples[i][1]; if (samples[i][2] > 0) { wSum += samples[i][2]; wN++; } }
      else if (samples[i][3] === "C") chargeS += dt;
    }
    const ps = samples.map(s => s[1]), rate = dischargeS > 600 ? drop / (dischargeS / 3600) : null;
    const chip = (l, v) => `<span class="chip plain">${l}: ${v}</span>`;
    return `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">${chip("Lowest", Math.min(...ps).toFixed(1) + "%")}${chip("Highest", Math.max(...ps).toFixed(1) + "%")}${chip("On battery", fmtDur(dischargeS))}${chip("Charging", fmtDur(chargeS))}${wN ? chip("Avg draw", (wSum / wN).toFixed(1) + " W") : ""}${rate && rate > 0 ? chip("Drain", rate.toFixed(1) + "%/h") : ""}${rate && rate > 0 ? chip("Full to empty", fmtDur(100 / rate * 3600)) : ""}</div>`;
  }
  async function drawBatChart() {
    const box = $("#batChart"); if (!box) return;
    const r = await api("/api/battery/history?hours=" + batRange).catch(() => ({ samples: [] }));
    const s = r.samples || [];
    box.innerHTML = s.length < 2 ? empty("battery", "Collecting data… the dashboard logs a point every minute while it's running.") : batChart(s, +batRange) + batStats(s);
  }
  async function loadBatHist() {
    const host = $("#batHist"); if (!host) return;
    const b = await api("/api/battery").catch(() => null);
    if (!b?.present) { host.innerHTML = ""; return; }
    const c = alertCfg(), lv = [...c.levels, 10].slice(0, 2);
    const opt = (vals, cur, fmt) => vals.map(v => `<option value="${v}" ${+v === +cur ? "selected" : ""}>${fmt(v)}</option>`).join("");
    const a1 = reg({ title: "Battery history", desc: "Charge level over time, drain rate and time on battery", icon: "battery", color: "green", kw: "graph chart" });
    const a2 = reg({ title: "Battery alerts", desc: "Get notified when the charge gets low", icon: "bell", color: "amber", kw: "low battery notification" });
    host.innerHTML = sec("Battery history", segHtml("batRange", [["6", "6 h"], ["24", "24 h"], ["168", "7 days"]], batRange)) +
      `<div class="card pad" id="${a1}"><div id="batChart"></div></div>` +
      sec("Battery alerts") + `<div class="group" id="${a2}">` +
      row("bell", "amber", "Low-battery alerts", "Show a desktop notification when the charge drops to these levels", `<label class="sw"><input type="checkbox" id="baOn" ${c.on ? "checked" : ""}><span></span></label>`) +
      row("alert", "red", "Warn me at", "First and second warning level", `<select id="baL1">${opt([50, 40, 30, 25, 20, 15], lv[0], v => v + "%")}</select> <select id="baL2">${opt([20, 15, 10, 7, 5, 3], lv[1], v => v + "%")}</select>`) +
      row("zap", "green", "Tell me when it's charged", "Notify when charging reaches this level, so you can unplug (this battery can't stop charging by itself)", `<select id="baFull">${opt([0, 80, 90, 100], c.full, v => +v ? v + "%" : "Off")}</select>`) +
      row("play", "blue", "Send a test notification", "", `<button class="btn" id="baTest">Test</button>`) + `</div>`;
    seg("batRange", v => { batRange = v; drawBatChart(); });
    const save = () => { const l1 = +$("#baL1").value, l2 = +$("#baL2").value; SETTINGS.batAlerts = { on: $("#baOn").checked, levels: [...new Set([l1, l2])].sort((x, y) => y - x), full: +$("#baFull").value }; saveSettings(); };
    ["#baOn", "#baL1", "#baL2", "#baFull"].forEach(s => $(s).onchange = save);
    $("#baTest").onclick = () => { api("/api/notify", { title: "Battery low", body: "This is a test. Plug in soon." }).catch(() => {}); toast("ok", "Test notification sent"); };
    drawBatChart();
  }

  /* ---------- clipboard history (Toolbox, KDE Klipper) ---------- */
  let CLIPS = [];
  const looksSecret = t => !/\s/.test(t) && t.length >= 24 && /[A-Za-z]/.test(t) && /[0-9_\-.]/.test(t);
  const toolsPage = PAGES.tools;
  PAGES.tools = () => {
    const a = reg({ title: "Clipboard history", desc: "Things you copied recently, click to copy again", icon: "copy", color: "violet", kw: "paste clipper klipper" });
    return toolsPage() + sec("Clipboard history", `<button class="btn sm ghost" id="clipRefresh">${ic("refresh")}Refresh</button><button class="btn sm ghost danger" id="clipClear">${ic("trash")}Clear</button>`) +
      `<div class="group" id="${a}"><div class="scroll" id="clipList" style="max-height:340px"></div></div>`;
  };
  const toolsLoader = loaders.tools;
  loaders.tools = () => { toolsLoader?.(); loadClip(); };
  async function loadClip() {
    const el = $("#clipList"); if (!el) return;
    const r = await api("/api/clipboard").catch(() => ({ supported: false, items: [] }));
    CLIPS = r.items || [];
    if (!r.supported) { el.innerHTML = empty("copy", "Clipboard history needs KDE's Klipper, which wasn't found."); return; }
    el.innerHTML = CLIPS.length ? CLIPS.map((t, i) => {
      const sec_ = looksSecret(t);
      return `<div class="row">${tile(sec_ ? "lock" : "copy", sec_ ? "amber" : "violet", "soft")}<div class="txt"><b class="mono" style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;max-width:520px" data-clipt="${i}">${sec_ ? "••••••••••••••••" : esc(t.slice(0, 160))}</b>${sec_ ? "<small>Looks like a key or token, hidden</small>" : ""}</div><div class="ctl">${sec_ ? `<button class="btn sm ghost" data-clipshow="${i}">Show</button>` : ""}<button class="btn sm" data-clipcopy="${i}">Copy</button></div></div>`;
    }).join("") : empty("copy", "Nothing copied yet.");
  }

  /* ---------- backups (Timeshift + files) ---------- */
  let SNAPS = [], BTOOLS = { timeshift: true };
  const FOLDERS = [["Documents", "Documents"], ["Pictures", "Pictures"], ["Music", "Music"], ["Videos", "Videos"], ["Downloads", "Downloads"], ["Desktop", "Desktop"], ["Settings & dotfiles", ".config"]];
  const TAGS = { O: "On demand", D: "Daily", W: "Weekly", M: "Monthly", H: "Hourly", B: "Boot" };
  PAGES.backups = () => {
    const a1 = reg({ title: "System snapshots", desc: "Take and manage Timeshift snapshots", icon: "history", color: "green", kw: "timeshift restore backup" });
    const a2 = reg({ title: "Back up my files", desc: "Copy your folders to a drive or another folder", icon: "folder", color: "blue", kw: "rsync copy documents" });
    return pageHead("backups", "Save a snapshot of your system, and copy your files somewhere safe, so you can undo mistakes.") +
      `<div id="bkNote"></div>` +
      sec("System snapshots", `<button class="btn sm ghost" id="bkRefresh">${ic("refresh")}Refresh</button><button class="btn sm ghost" data-launch="timeshift-launcher">${ic("external")}Open Timeshift</button>`) +
      `<div class="field" id="${a1}"><input type="text" id="bkComment" placeholder="Name this snapshot (optional), e.g. before kernel update"><button class="btn primary" id="bkCreate">${ic("plus")}Create snapshot</button></div>` +
      `<div class="group" id="bkList" style="margin-top:12px">${empty("history", "Press Refresh to list your snapshots. This asks for your password.")}</div>` +
      note("Snapshots protect <b>system files and settings</b> (like Windows System Restore), not your documents. To restore one, use <b>Open Timeshift</b>. It's safest to restore from there, and it restarts your computer. Use the section below for your own files.") +
      sec("Back up my files") +
      `<div class="card pad" id="${a2}"><div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:12px">${FOLDERS.map(([l, p]) => `<label style="display:flex;gap:7px;align-items:center"><input type="checkbox" data-bkf="${p}" ${["Documents", "Pictures", "Desktop"].includes(p) ? "checked" : ""}>${l}</label>`).join("")}</div>` +
      `<div class="field"><input type="text" id="bkDest" list="bkDrives" placeholder="Where to? e.g. /media/jarvis/MyDrive/Backup" value="${esc(SETTINGS.backupDest || "")}"><datalist id="bkDrives"></datalist><button class="btn primary" id="bkRun">${ic("download")}Back up now</button></div>` +
      `<small style="color:var(--muted)">Only new and changed files are copied, and nothing is ever deleted from the destination. Plug in a drive first for a real backup.</small></div>`;
  };
  loaders.backups = async () => {
    BTOOLS = await api("/api/backup/tools").catch(() => ({ timeshift: true }));
    $("#bkNote").innerHTML = BTOOLS.timeshift ? "" : `<div class="note">${ic("alert")}<div><b>Timeshift isn't installed.</b> It's the tool that takes system snapshots. <button class="btn sm primary" id="bkInstall">${ic("download")}Install Timeshift</button></div></div>`;
    const d = await api("/api/drives").catch(() => []);
    $("#bkDrives").innerHTML = d.filter(x => x.mount && x.removable).map(x => `<option value="${esc(x.mount)}/Backup">${esc(x.name)}</option>`).join("");
  };
  async function loadSnaps() {
    const j = await run("pkexec timeshift --list", "Timeshift snapshots", { confirmed: true });
    const el = $("#bkList"); if (!el || !j || j.cancelled) return;
    SNAPS = j.text.split("\n").map(l => l.match(/^\d+\s+>?\s*(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})\s*(.*)$/)).filter(Boolean).map(m => {
      let rest = m[2].trim(), tags = ""; const t = rest.match(/^([ODWMHB]+)\b\s*(.*)$/); if (t) { tags = t[1]; rest = t[2]; }
      return { name: m[1], tags, desc: rest };
    });
    const free = j.text.match(/(\d+ snapshots?, .*?free)/i)?.[1];
    el.innerHTML = SNAPS.length ? (free ? row("disk", "slate", esc(free), "") : "") + SNAPS.slice().reverse().map(s => row("history", "green", s.name.replace("_", "  ").replace(/-(\d\d)-(\d\d)$/, ":$1:$2"), `${s.tags ? [...s.tags].map(c => TAGS[c] || c).join(", ") : ""}${s.desc ? (s.tags ? " · " : "") + esc(s.desc) : ""}`, `<button class="btn sm" data-bkrestore="${s.name}">Restore…</button><button class="btn sm danger" data-bkdel="${s.name}">Delete</button>`)).join("")
      : empty("history", /not configured|No snapshots|no snapshot/i.test(j.text) || j.code === 0 ? "No snapshots yet. Create your first one above. If it asks to set up, use Open Timeshift once." : "Couldn't read the snapshots. Open Timeshift to set it up.");
  }

  /* ---------- profiles ---------- */
  const PKEYS = ["brightness", "volume", "screenoff", "autosleep", "autolock", "dnd", "nightlight", "awake", "dark", "performance", "bluetooth"];
  const PLABEL = { brightness: "Brightness", volume: "Volume", screenoff: "Screen off", autosleep: "Sleep after", autolock: "Lock after", dnd: "Do not disturb", nightlight: "Night light", awake: "Keep awake", dark: "Dark mode", performance: "Performance mode", bluetooth: "Bluetooth" };
  const PRESETS = [
    { name: "Power saver", icon: "battery", color: "green", desc: "Dim screen, sleep sooner, Bluetooth off", values: { performance: false, brightness: 35, screenoff: 120, autosleep: 600, bluetooth: false, awake: false } },
    { name: "Balanced", icon: "gauge", color: "blue", desc: "Everyday settings", values: { performance: false, brightness: 70, screenoff: 600, autosleep: 1800, awake: false, dnd: false } },
    { name: "Performance", icon: "zap", color: "orange", desc: "Full speed and a bright screen (uses more power)", values: { performance: true, brightness: 100, screenoff: 1800, autosleep: 7200 } },
    { name: "Presentation", icon: "monitor", color: "violet", desc: "No notifications, screen stays on", values: { dnd: true, awake: true, screenoff: 0, autosleep: 0, autolock: 0, nightlight: false } },
    { name: "Night reading", icon: "moon", color: "indigo", desc: "Dark mode, warm light, dim screen, quiet", values: { dark: true, nightlight: true, brightness: 25, volume: 20 } },
  ];
  const fmtVal = (k, v) => typeof v === "boolean" ? (v ? "on" : "off") : (["screenoff", "autosleep", "autolock"].includes(k) ? (v ? Math.round(v / 60) + " min" : "never") : v + "%");
  PAGES.profiles = () => {
    const a = reg({ title: "Profiles", desc: "Switch a whole set of settings in one click", icon: "layers", color: "violet", kw: "preset mode power saver presentation" });
    return pageHead("profiles", "Switch a whole set of settings in one click, like Power saver or Presentation.") +
      `<div id="${a}">` + sec("Ready-made") + `<div class="grid3" id="prePresets"></div>` + sec("My profiles") +
      `<div class="field"><input type="text" id="prName" placeholder="Name your current settings, e.g. Work"><button class="btn primary" id="prSave">${ic("plus")}Save current settings</button></div>` +
      `<div class="group" id="prMine" style="margin-top:12px"></div></div>` +
      note("A profile sets brightness, volume, screen-off and sleep timers, Do not disturb, Night light, Keep awake, dark mode, performance mode and Bluetooth. Wi-Fi is left alone so you never lose your connection.");
  };
  function renderProfiles() {
    const act = SETTINGS.activeProfile, card = (p, i, mine) => `<div class="card pad" style="display:flex;flex-direction:column;gap:10px"><div style="display:flex;gap:12px;align-items:center">${tile(p.icon || "layers", p.color || "violet")}<div style="min-width:0"><b>${esc(p.name)}</b>${act === p.name ? ` <span class="chip good">active</span>` : ""}<div style="color:var(--muted);font-size:12.5px">${esc(p.desc || "")}</div></div></div><div style="display:flex;gap:6px;flex-wrap:wrap">${Object.entries(p.values).filter(([k]) => hasCtl(k)).map(([k, v]) => `<span class="chip plain">${PLABEL[k] || k}: ${fmtVal(k, v)}</span>`).join("")}</div><div><button class="btn primary sm" data-prapply="${mine ? "m" : "p"}${i}">Apply</button></div></div>`;
    $("#prePresets").innerHTML = PRESETS.map((p, i) => card(p, i, false)).join("");
    const mine = SETTINGS.profiles || [];
    $("#prMine").innerHTML = mine.length ? mine.map((p, i) => row("layers", "violet", esc(p.name) + (act === p.name ? ` <span class="chip good">active</span>` : ""), Object.entries(p.values).map(([k, v]) => `${PLABEL[k] || k} ${fmtVal(k, v)}`).join(" · "), `<button class="btn sm primary" data-prapply="m${i}">Apply</button><button class="btn sm danger" data-prdel="${i}">Delete</button>`)).join("") : empty("layers", "Nothing saved yet. Set things the way you like, then save them above.");
  }
  loaders.profiles = async () => { await loadCtl().catch(() => {}); renderProfiles(); };
  async function applyProfile(p) {
    await loadCtl().catch(() => {});
    let n = 0, bad = 0;
    for (const [id, v] of Object.entries(p.values)) {
      if (!hasCtl(id) || CTL[id] === undefined || CTL[id] === null || CTL[id] === v) continue;
      const r = await setCtl(id, v, { quiet: true, confirmed: true, label: `${p.name}: ${PLABEL[id] || id}` });
      r?.ok === false ? bad++ : n++;
    }
    SETTINGS.activeProfile = p.name; saveSettings(); renderProfiles();
    toast(bad ? "fail" : "ok", `${p.name} applied`, `${n} setting${n === 1 ? "" : "s"} changed${bad ? `, ${bad} couldn't be changed` : ""}`);
  }

  /* ---------- clicks ---------- */
  document.addEventListener("click", async e => {
    const t = e.target, hit = s => t.closest(s);
    if (hit("#fwRefresh")) return loadFw();
    if (hit("#fwAdd")) return addFw();
    const fd = hit("[data-fwdel]"); if (fd) { const j = await run(`pkexec ufw --force delete ${+fd.dataset.fwdel}`, "Delete firewall rule", { confirmed: false }); if (j?.code === 0) loadFw(); return; }
    if (hit("#clipRefresh")) return loadClip();
    if (hit("#clipClear")) { await api("/api/clipboard/clear", {}).catch(() => {}); toast("ok", "Clipboard history cleared"); return loadClip(); }
    const cc = hit("[data-clipcopy]"); if (cc) { const r = await api("/api/clipboard/set", { text: CLIPS[+cc.dataset.clipcopy] }).catch(() => ({})); return toast(r.ok ? "ok" : "fail", r.ok ? "Copied" : "Couldn't copy"); }
    const cs = hit("[data-clipshow]"); if (cs) { const i = +cs.dataset.clipshow, b = $(`[data-clipt="${i}"]`), on = cs.textContent === "Show"; b.textContent = on ? CLIPS[i].slice(0, 160) : "••••••••••••••••"; cs.textContent = on ? "Hide" : "Show"; return; }
    if (hit("#bkRefresh")) return loadSnaps();
    if (hit("#bkInstall")) { await run(pkgCmd(PLAT.pkg.install, "timeshift"), "Install Timeshift", { after: () => loaders.backups() }); return; }
    if (hit("#bkCreate")) {
      const c = $("#bkComment").value.trim().replace(/["'`$\\]/g, "");
      const j = await run(`pkexec timeshift --create --comments ${shq(c || "Dashboard snapshot")} --tags O`, "Create snapshot", { confirmed: true });
      if (j?.code === 0) { $("#bkComment").value = ""; loadSnaps(); } return;
    }
    const br = hit("[data-bkrestore]"); if (br) { const ok = await modal({ title: "Restore this snapshot?", text: `Restoring ${br.dataset.bkrestore} replaces system files and settings and restarts the computer. Your documents are not touched. The Timeshift window opens so you can pick it and confirm there.`, okText: "Open Timeshift", icon: "history", color: "orange" }); if (ok) { launch("timeshift-launcher"); } return; }
    const bd = hit("[data-bkdel]"); if (bd) { const ok = await modal({ title: "Delete this snapshot?", text: `${bd.dataset.bkdel} will be removed permanently. This can't be undone.`, okText: "Delete", danger: true }); if (ok) { const j = await run(`pkexec timeshift --delete --snapshot ${shq(bd.dataset.bkdel)} --yes`, "Delete snapshot", { confirmed: true }); if (j?.code === 0) loadSnaps(); } return; }
    if (hit("#bkRun")) {
      const dest = $("#bkDest").value.trim(), picks = $$("[data-bkf]:checked").map(x => x.dataset.bkf);
      if (!dest) return toast("fail", "Choose where to save the backup", "Type a folder, or plug in a drive and pick it");
      if (!picks.length) return toast("fail", "Pick at least one folder to back up");
      SETTINGS.backupDest = dest; saveSettings();
      const destArg = dest.startsWith("~/") ? `"$HOME"${dq(dest.slice(1))}` : dq(dest);
      const srcs = picks.map(p => `"$HOME"${dq("/" + p)}`).join(" ");
      await run(`mkdir -p ${destArg} && rsync -ah --info=progress2,stats1 ${srcs} ${destArg}/ && echo && echo "Backup finished."`, "Back up my files", { confirmed: true });
      return;
    }
    const pa = hit("[data-prapply]"); if (pa) { const k = pa.dataset.prapply; return applyProfile(k[0] === "p" ? PRESETS[+k.slice(1)] : SETTINGS.profiles[+k.slice(1)]); }
    const pd = hit("[data-prdel]"); if (pd) { SETTINGS.profiles.splice(+pd.dataset.prdel, 1); saveSettings(); return renderProfiles(); }
    if (hit("#prSave")) {
      const name = $("#prName").value.trim().slice(0, 40); if (!name) return toast("fail", "Give the profile a name");
      const values = {}; PKEYS.forEach(k => { if (hasCtl(k) && CTL[k] !== undefined && CTL[k] !== null) values[k] = CTL[k]; });
      const list = (SETTINGS.profiles || []).filter(p => p.name !== name); list.push({ name, values });
      SETTINGS.profiles = list; SETTINGS.activeProfile = name; saveSettings(); $("#prName").value = ""; renderProfiles();
      return toast("ok", `Saved “${name}”`, `${Object.keys(values).length} settings`);
    }
  });
};
