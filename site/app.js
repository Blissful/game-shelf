"use strict";
/* Game Shelf: a cosy virtual board game shelf, fed by data/games.json (synced from BoardGameGeek). */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isNum = (v) => typeof v === "number" && isFinite(v);
const hash = (s) => { let h = 7; for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) >>> 0; return h; };

let DATA = { games: [] };
let games = [];
const byId = new Map();
const prefs = loadPrefs();
const filters = { players: 0, bestOnly: false, time: 0, wmin: 0, wmax: 0, styles: new Set(), themes: new Set(), lang: 0, hideExp: false };
let query = "";

/* ------------------------------------------------------------ prefs */
function loadPrefs() {
  const d = { view: "covers", arrange: "family", sort: "name", status: "own", zoom: 1, night: false, torch: false, lively: false };
  try { return Object.assign(d, JSON.parse(localStorage.getItem("shelf-prefs") || "{}")); } catch { return d; }
}
function savePrefs() { try { localStorage.setItem("shelf-prefs", JSON.stringify(prefs)); } catch {} }

/* ------------------------------------------------------------ helpers */
const range = (a, b, u = "") => (!isNum(a) && !isNum(b)) ? null : (!isNum(b) || a === b) ? `${a ?? b}${u}` : !isNum(a) ? `${b}${u}` : `${a}–${b}${u}`;
const weightLabel = (w) => !isNum(w) || w <= 0 ? "—" : w < 1.8 ? "Light" : w < 2.5 ? "Medium-light" : w < 3.2 ? "Medium" : w < 3.8 ? "Medium-heavy" : "Heavy";
const LANG = ["", "No text needed", "Some text", "Moderate text", "Lots of text", "Unplayable in another language"];
const STATUS_LABEL = { own: "Owned", preordered: "Pre-ordered", wishlist: "Wishlist", prevowned: "Previously owned", fortrade: "For trade", want: "Wants", wanttoplay: "Wants to play", wanttobuy: "Wants to buy" };
function friendsAvg(g) { const f = (g.friends || []).filter((x) => isNum(x.rating)); return f.length ? f.reduce((s, x) => s + x.rating, 0) / f.length : null; }
function daysSince(d) { if (!d) return null; const t = Date.parse(d); return isNaN(t) ? null : Math.floor((Date.now() - t) / 864e5); }
function ago(d) {
  const n = daysSince(d); if (n == null) return null;
  if (n < 1) return "today"; if (n < 2) return "yesterday"; if (n < 14) return `${n} days ago`;
  if (n < 60) return `${Math.round(n / 7)} weeks ago`; if (n < 365) return `${Math.round(n / 30)} months ago`;
  const y = n / 365; return y < 1.5 ? "a year ago" : `${Math.round(y)} years ago`;
}
function toast(msg, ms = 2600) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms); }
function imgSrc(g) { return g.image ? g.image : null; }
function textColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); if (!m) return "#fff";
  const n = parseInt(m[1], 16), r = n >> 16, gg = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * gg + 0.114 * b) > 150 ? "#1a1410" : "#fdf8ef";
}
function genCover(g, cls = "") { return `<div class="cover gen ${cls}" style="--h:${hash(g.name) % 360}"><b>${esc(g.name)}</b></div>`; }

/* ------------------------------------------------------------ status filter */
function statusOk(g) {
  const st = g.status || [];
  switch (prefs.status) {
    case "own": return st.includes("own");
    case "own+": return st.includes("own") || st.includes("preordered");
    case "rated": return !st.includes("own") && (isNum(g.myRating) || g.review);
    case "wishlist": return st.includes("wishlist") || st.includes("wanttobuy");
    case "prev": return st.includes("prevowned");
    default: return true;
  }
}

/* ------------------------------------------------------------ filtering */
function matches(g) {
  if (query) {
    const hay = [g.name, ...(g.designers || []), ...(g.themes || []), ...(g.styles || []), ...(g.categories || []), ...(g.mechanics || [])].join(" ").toLowerCase();
    if (!query.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  if (filters.hideExp && g.type !== "base") return false;
  if (filters.players) {
    const p = filters.players;
    if (filters.bestOnly) { if (!(g.bestPlayers || []).some((n) => (p >= 6 ? n >= 6 : n === p))) return false; }
    else { const max = g.maxPlayers ?? g.minPlayers; if (!isNum(g.minPlayers) || g.minPlayers > p || (p >= 6 ? max < 6 : max < p)) return false; }
  }
  if (filters.time) { const t = g.minTime ?? g.maxTime; if (!isNum(t) || t > filters.time) return false; }
  if (filters.wmin && !(g.weight >= filters.wmin)) return false;
  if (filters.wmax && !(g.weight > 0 && g.weight < filters.wmax)) return false;
  if (filters.styles.size && !(g.styles || []).some((s) => filters.styles.has(s))) return false;
  if (filters.themes.size && !(g.themes || []).some((s) => filters.themes.has(s))) return false;
  if (filters.lang && !(isNum(g.lang) && g.lang <= filters.lang)) return false;
  return true;
}
function filtersActive() { return !!(filters.players || filters.time || filters.wmin || filters.wmax || filters.styles.size || filters.themes.size || filters.lang || filters.hideExp); }

/* ------------------------------------------------------------ sorting & grouping */
const nm = (g) => g.name.toLowerCase();
function cmp(a, b) {
  const desc = (f) => { const x = f(a), y = f(b); if (x === y) return nm(a).localeCompare(nm(b)); if (x == null) return 1; if (y == null) return -1; return y - x; };
  const asc = (f) => { const x = f(a), y = f(b); if (x === y) return nm(a).localeCompare(nm(b)); if (x == null) return 1; if (y == null) return -1; return x - y; };
  switch (prefs.sort) {
    case "recent": return desc((g) => g.lastPlayed ? Date.parse(g.lastPlayed) : null);
    case "plays": return desc((g) => g.numPlays || null);
    case "my": return desc((g) => g.myRating ?? null);
    case "friends": return desc((g) => friendsAvg(g));
    case "bgg": return desc((g) => g.bggRating ?? null);
    case "rank": return asc((g) => g.bggRank ?? null);
    case "newest": return desc((g) => g.year ?? null);
    case "heavy": return desc((g) => g.weight || null);
    case "players": return desc((g) => g.maxPlayers ?? null);
    case "long": return desc((g) => g.maxTime ?? null);
    default: return nm(a).localeCompare(nm(b));
  }
}
function baseOf(g) { for (const id of g.baseIds || []) { const b = byId.get(id); if (b) return b; } return null; }
const LETTERS = [["A–C", /^[a-c]/], ["D–G", /^[d-g]/], ["H–L", /^[h-l]/], ["M–P", /^[m-p]/], ["Q–S", /^[q-s]/], ["T–Z", /^[t-z]/], ["#", /./]];
function sortTitle(s) { return s.toLowerCase().replace(/^(the|a|an)\s+/, "").replace(/^[^a-z0-9]+/, ""); }

function groups(list) {
  const out = new Map(); const add = (k, g) => { if (!out.has(k)) out.set(k, []); out.get(k).push(g); };
  const order = (keys) => keys.filter((k) => out.has(k)).map((k) => [k, out.get(k)]).concat([...out].filter(([k]) => !keys.includes(k)));
  switch (prefs.arrange) {
    case "family": {
      // Base games in A–Z shelves, each followed by its own expansions
      const visible = new Set(list.map((g) => g.id));
      const roots = list.filter((g) => !baseOf(g) || !visible.has(baseOf(g).id));
      roots.sort((a, b) => sortTitle(a.name).localeCompare(sortTitle(b.name)));
      for (const r of roots) {
        const fam = [r, ...list.filter((x) => x !== r && baseOf(x) === r).sort((a, b) => (a.year || 0) - (b.year || 0))];
        const key = (LETTERS.find(([, re]) => re.test(sortTitle(baseOf(r)?.name || r.name))) || LETTERS[6])[0];
        for (const g of fam) add(key, g);
      }
      return order(LETTERS.map((x) => x[0])).map(([k, v]) => [k, v, true]);
    }
    case "theme": for (const g of list) add((g.themes || ["Other"])[0] || "Other", g); return [...out].sort((a, b) => b[1].length - a[1].length);
    case "style": for (const g of list) add((g.styles || [])[0] || "Something else", g); return [...out].sort((a, b) => b[1].length - a[1].length);
    case "weight": for (const g of list) add(g.weight > 0 ? weightLabel(g.weight) : "Unknown weight", g); return order(["Light", "Medium-light", "Medium", "Medium-heavy", "Heavy", "Unknown weight"]);
    case "played": for (const g of list) { const n = daysSince(g.lastPlayed); add(n == null ? (g.numPlays ? "Played, date not logged" : "No plays logged") : n <= 31 ? "Played this month" : n <= 365 ? "Played this year" : n <= 730 ? "Last played 1–2 years ago" : "Gathering dust (2+ years)", g); }
      return order(["Played this month", "Played this year", "Last played 1–2 years ago", "Gathering dust (2+ years)", "Played, date not logged", "No plays logged"]);
    case "kind": for (const g of list) add(g.type === "expansion" ? "Expansions" : g.type === "accessory" ? "Accessories" : "Base games", g); return order(["Base games", "Expansions", "Accessories"]);
    case "status": for (const g of list) { const st = g.status || []; add(st.includes("own") ? "Owned" : st.includes("preordered") ? "Pre-ordered" : st.includes("wishlist") ? "Wishlist" : st.includes("prevowned") ? "Previously owned" : "Rated or played", g); }
      return order(["Owned", "Pre-ordered", "Wishlist", "Rated or played", "Previously owned"]);
    case "decade": for (const g of list) add(isNum(g.year) ? `${Math.floor(g.year / 10) * 10}s` : "Year unknown", g); return [...out].sort((a, b) => b[0].localeCompare(a[0]));
    default: return [["The whole collection", list]];
  }
}

/* ------------------------------------------------------------ render shelves */
function itemHTML(g) {
  const exp = g.type === "expansion" ? `<span class="badge exp">EXP</span>` : g.type === "accessory" ? `<span class="badge">ACC</span>` : "";
  const label = `${g.name}${g.year ? `, ${g.year}` : ""}`;
  if (prefs.view === "spines") {
    const w = Math.round((16 + (g.weight > 0 ? g.weight : 2.2) * 5 + (g.maxTime > 90 ? 5 : 0)) * (window.innerWidth < 640 ? 0.8 : 1));
    const hf = (0.78 + (hash(g.id + "h") % 22) / 100).toFixed(2);
    const c = g.color || `hsl(${hash(g.name) % 360} 45% ${28 + (hash(g.id) % 25)}%)`;
    const tc = g.color ? textColor(g.color) : "#fdf8ef";
    return `<div class="slot"><button class="item" data-id="${esc(g.id)}" aria-label="${esc(label)}" title="${esc(label)}"><div class="spine" style="--w:calc(${w}px * var(--z));--hf:${hf};--c:${c};--tc:${tc}"><span>${esc(g.name)}</span>${g.year ? `<i>${String(g.year).slice(2)}</i>` : ""}</div></button></div>`;
  }
  const src = imgSrc(g);
  const inner = src ? `<div class="cover"><img src="${esc(src)}" alt="" loading="lazy" decoding="async" ${g.ratio ? `style="aspect-ratio:${g.ratio}"` : ""} onerror="this.parentNode.outerHTML=window.genCoverFor('${esc(g.id)}')"></div>` : genCover(g);
  return `<div class="slot"><button class="item" data-id="${esc(g.id)}" aria-label="${esc(label)}" title="${esc(label)}">${exp}${inner}</button></div>`;
}
window.genCoverFor = (id) => genCover(byId.get(id) || { name: "?" });

let visibleList = [];
function render() {
  document.documentElement.style.setProperty("--z", prefs.zoom);
  const pool = games.filter(statusOk);
  visibleList = pool.filter(matches).sort(cmp);
  const box = $("#shelves");
  if (!games.length) { box.innerHTML = `<div class="empty">The shelf is empty. Run the BoardGameGeek sync to fill it.</div>`; return; }
  if (!visibleList.length) { box.innerHTML = `<div class="empty">Nothing on the shelf matches. <button class="linkbtn" id="clearAll2">Clear filters</button></div>`; $("#clearAll2")?.addEventListener("click", clearFilters); return; }
  box.innerHTML = groups(visibleList).map(([name, list, keepOrder]) => {
    const items = keepOrder ? list : [...list].sort(cmp);
    return `<section class="shelf"><div class="plate">${esc(name)} <small>${items.length}</small></div><div class="row">${items.map(itemHTML).join("")}</div></section>`;
  }).join("");
  renderSubtitle(pool.length);
  renderActiveFilters();
}
function renderSubtitle(poolCount) {
  const owned = games.filter((g) => (g.status || []).includes("own"));
  const base = owned.filter((g) => g.type === "base").length, exp = owned.filter((g) => g.type === "expansion").length;
  const plays = owned.reduce((s, g) => s + (g.numPlays || 0), 0);
  const parts = [`${base} games`, exp ? `${exp} expansions` : null, plays ? `${plays.toLocaleString()} plays logged` : null].filter(Boolean);
  const showing = visibleList.length !== poolCount ? ` · showing ${visibleList.length}` : "";
  $("#subtitle").textContent = parts.join(" · ") + showing;
}
function renderActiveFilters() {
  const el = $("#activeFilters"); const f = [];
  if (filters.players) f.push(`${filters.bestOnly ? "Best at" : "Plays"} ${filters.players}${filters.players >= 6 ? "+" : ""}`);
  if (filters.time) f.push(`≤ ${filters.time} min`);
  if (filters.wmin || filters.wmax) f.push(`Weight ${filters.wmin || 1}–${filters.wmax || 5}`);
  for (const s of filters.styles) f.push(s); for (const t of filters.themes) f.push(t);
  if (filters.lang) f.push(`Text: ${LANG[filters.lang]}`);
  if (filters.hideExp) f.push("No expansions");
  el.hidden = !f.length;
  el.innerHTML = f.length ? `Filters: ${f.map((x) => `<span class="fchip">${esc(x)}</span>`).join("")} <button class="linkbtn" id="clearAll">Clear all</button>` : "";
  $("#clearAll")?.addEventListener("click", clearFilters);
}
function clearFilters() { Object.assign(filters, { players: 0, bestOnly: false, time: 0, wmin: 0, wmax: 0, lang: 0, hideExp: false }); filters.styles.clear(); filters.themes.clear(); render(); }

$("#shelves").addEventListener("click", (e) => { const it = e.target.closest(".item"); if (it) openGame(it.dataset.id); });

/* ------------------------------------------------------------ overlay */
let lastFocus = null;
function openSheet(html) { lastFocus = document.activeElement; $("#sheet").innerHTML = html; $("#overlay").hidden = false; document.body.style.overflow = "hidden"; $("#sheet").scrollTop = 0; setTimeout(() => $("#sheet .x")?.focus(), 30); }
function closeSheet() { $("#overlay").hidden = true; document.body.style.overflow = ""; if (location.hash) history.replaceState(null, "", location.pathname + location.search); lastFocus?.focus?.(); }
$("#overlay").addEventListener("click", (e) => { if (e.target.id === "overlay" || e.target.closest("[data-close]")) closeSheet(); });

/* ------------------------------------------------------------ game card */
function bggUrl(g) { const kind = g.type === "expansion" ? "boardgameexpansion" : g.type === "accessory" ? "boardgameaccessory" : "boardgame"; return /^\d+$/.test(g.id) ? `https://boardgamegeek.com/${kind}/${g.id}` : `https://boardgamegeek.com/geeksearch.php?action=search&objecttype=boardgame&q=${encodeURIComponent(g.name)}`; }
function miniHTML(g) { const src = imgSrc(g); return `<button class="mini" data-open="${esc(g.id)}">${src ? `<img src="${esc(src)}" alt="">` : genCover(g)}<span>${esc(g.name)}</span></button>`; }

function openGame(id) {
  const g = byId.get(id); if (!g) return;
  try { history.replaceState(null, "", "#" + encodeURIComponent(id)); } catch {}
  const src = imgSrc(g);
  const fr = friendsAvg(g);
  const base = baseOf(g);
  const exps = games.filter((x) => (x.baseIds || []).includes(g.id));
  const best = (g.bestPlayers || []).length ? `best ${g.bestPlayers.join(", ")}` : "";
  const st = (g.status || []).map((s) => `<span class="chip st ${s === "own" ? "own" : ""}">${esc(STATUS_LABEL[s] || s)}</span>`).join("") || (isNum(g.myRating) ? `<span class="chip st">Rated, not owned</span>` : "");
  const lastP = g.lastPlayed ? `${ago(g.lastPlayed)} <small>(${esc(new Date(g.lastPlayed).toLocaleDateString())})</small>` : null;
  const videos = (g.videos || []).filter((v) => /^https:\/\//.test(v.link));
  const yt = `https://www.youtube.com/results?search_query=${encodeURIComponent(`how to play ${g.name} board game`)}`;
  const own = /^https?:\/\//.test(g.howToPlay || "") ? g.howToPlay : null;
  const rules = /^https?:\/\//.test(g.rulesUrl || "") ? g.rulesUrl : /^\d+$/.test(g.id) ? `${bggUrl(g)}/x/files` : null;
  const desc = g.description || "";

  openSheet(`
    <div class="sheet-top"><span style="font-size:13px;color:var(--panel-muted)">${g.type === "expansion" ? "Expansion" : g.type === "accessory" ? "Accessory" : "Board game"}${g.bggRank ? ` · BGG rank #${g.bggRank}` : ""}</span><button class="x" data-close aria-label="Close">×</button></div>
    <div class="g-head">
      <div class="g-cover">${src ? `<img src="${esc(src)}" alt="${esc(g.name)} box">` : genCover(g)}</div>
      <div>
        <h2 id="sheetTitle">${esc(g.name)}</h2>
        <div class="g-sub">${[g.year, (g.designers || []).slice(0, 3).join(", ")].filter(Boolean).map(esc).join(" · ")}</div>
        <div class="chips">${st}</div>
        <div class="chips">${[...(g.themes || []).filter((t) => t !== "Other"), ...(g.styles || [])].map((t) => `<span class="chip">${esc(t)}</span>`).join("")}</div>
      </div>
    </div>
    <div class="stats">
      <div class="stat"><b>${esc(range(g.minPlayers, g.maxPlayers) || "—")}</b><span>players${best ? ` · ${esc(best)}` : ""}</span></div>
      <div class="stat"><b>${esc(range(g.minTime, g.maxTime) || "—")}</b><span>minutes</span></div>
      <div class="stat"><b>${g.weight > 0 ? g.weight.toFixed(1) : "—"}</b><span>${weightLabel(g.weight)} / 5</span></div>
      <div class="stat"><b>${g.minAge ? g.minAge + "+" : "—"}</b><span>age</span></div>
      ${isNum(g.lang) ? `<div class="stat"><b>${g.lang}/5</b><span>${esc(LANG[g.lang])}</span></div>` : ""}
    </div>
    <div class="sec"><h3>Ratings & plays</h3>
      <div class="ratings">
        <div class="rbox"><div class="v">${isNum(g.myRating) ? g.myRating : "—"}</div><div class="l">His rating</div></div>
        <div class="rbox"><div class="v">${isNum(g.bggRating) ? g.bggRating.toFixed(1) : "—"}</div><div class="l">BGG average${g.usersRated ? ` · ${g.usersRated.toLocaleString()} votes` : ""}</div></div>
        <div class="rbox"><div class="v">${fr != null ? fr.toFixed(1) : "—"}</div><div class="l">Friends' average</div></div>
        <div class="rbox"><div class="v">${g.numPlays || 0}</div><div class="l">${g.numPlays === 1 ? "play" : "plays"}${lastP ? ` · last ${lastP}` : ""}</div></div>
      </div>
      ${(g.friends || []).length ? `<div class="friends">${g.friends.map((f) => `${esc(f.user)} ${esc(f.rating)}`).join(" · ")}</div>` : ""}
    </div>
    ${g.review ? `<div class="sec"><h3>His review</h3><blockquote class="review">${esc(g.review)}</blockquote></div>` : ""}
    ${g.notes ? `<div class="sec"><h3>Notes</h3><p class="desc">${esc(g.notes)}</p></div>` : ""}
    ${desc ? `<div class="sec"><h3>About</h3><p class="desc clamp" id="desc">${esc(desc)}</p>${desc.length > 380 ? `<button class="more" id="moreBtn">Read more</button>` : ""}</div>` : ""}
    <div class="sec"><h3>Learn to play</h3><div class="links">
      ${own ? `<a class="lnk" href="${esc(own)}" target="_blank" rel="noopener"><span class="ic">★</span><span>Our favourite how-to<small>${esc(new URL(own).hostname)}</small></span></a>` : ""}
      ${videos.map((v) => `<a class="lnk" href="${esc(v.link)}" target="_blank" rel="noopener"><span class="ic">▶</span><span>${esc(v.title || "How to play")}<small>${esc(v.language || "Video")} · from BGG</small></span></a>`).join("")}
      ${!videos.length && !own ? `<a class="lnk" href="${esc(yt)}" target="_blank" rel="noopener"><span class="ic">▶</span><span>How-to-play videos<small>YouTube search</small></span></a>` : ""}
      ${rules ? `<a class="lnk" href="${esc(rules)}" target="_blank" rel="noopener"><span class="ic">📄</span><span>Rulebooks & player aids<small>BGG files</small></span></a>` : ""}
      <a class="lnk" href="${esc(bggUrl(g))}" target="_blank" rel="noopener"><span class="ic">⬡</span><span>BoardGameGeek page<small>Reviews, forums, photos</small></span></a>
    </div></div>
    ${base ? `<div class="sec"><h3>Expands</h3><div class="minis">${miniHTML(base)}</div></div>` : ""}
    ${exps.length ? `<div class="sec"><h3>Expansions on the shelf</h3><div class="minis">${exps.map(miniHTML).join("")}</div></div>` : ""}
  `);
  $("#moreBtn")?.addEventListener("click", (e) => { $("#desc").classList.remove("clamp"); e.target.remove(); });
  $$("#sheet [data-open]").forEach((b) => b.addEventListener("click", () => openGame(b.dataset.open)));
}

/* ------------------------------------------------------------ what shall we play */
function allValues(key) { const c = new Map(); for (const g of games.filter(statusOk)) for (const v of g[key] || []) if (v !== "Other") c.set(v, (c.get(v) || 0) + 1); return [...c].sort((a, b) => b[1] - a[1]).map(([v]) => v); }
function openFilters() {
  const pills = (name, vals, cur) => vals.map((v) => `<button class="pill ${cur(v) ? "on" : ""}" data-f="${name}" data-v="${esc(v)}">${esc(v)}</button>`).join("");
  openSheet(`
    <div class="sheet-top"><h2 id="sheetTitle" style="font-family:var(--display);font-size:28px;margin:0">What shall we play?</h2><button class="x" data-close aria-label="Close">×</button></div>
    <div class="fgrid">
      <div><h4>How many of us?</h4><div class="pills">${pills("players", ["1", "2", "3", "4", "5", "6+"], (v) => filters.players === parseInt(v, 10))}</div>
        <label class="check"><input type="checkbox" id="bestOnly" ${filters.bestOnly ? "checked" : ""}> Only games that are <b>best</b> at that count (BGG community vote)</label></div>
      <div><h4>Time we've got</h4><div class="pills">${pills("time", ["20", "30", "45", "60", "90", "120"], (v) => filters.time === +v).replace(/data-v="(\d+)">\d+</g, (m, n) => `data-v="${n}">≤ ${n} min<`)}</div></div>
      <div><h4>Weight (BGG complexity)</h4><div class="pills">${pills("weight", ["Light", "Medium", "Heavy"], (v) => (v === "Light" && filters.wmax === 2.2) || (v === "Medium" && filters.wmin === 2.2 && filters.wmax === 3.2) || (v === "Heavy" && filters.wmin === 3.2))}</div></div>
      <div><h4>Play style (any of)</h4><div class="pills">${pills("styles", allValues("styles"), (v) => filters.styles.has(v))}</div></div>
      <div><h4>Theme (any of)</h4><div class="pills">${pills("themes", allValues("themes"), (v) => filters.themes.has(v))}</div></div>
      <div><h4>Text on the table</h4><div class="pills">${pills("lang", ["No text needed", "Some text", "Moderate text"], (v) => filters.lang === LANG.indexOf(v))}</div></div>
      <label class="check"><input type="checkbox" id="hideExp" ${filters.hideExp ? "checked" : ""}> Hide expansions and accessories</label>
    </div>
    <div class="fact"><button class="btn accent" id="pickBtn">Pick one for us</button><button class="btn" id="fClear">Clear all filters</button><span class="fcount" id="fCount"></span></div>
  `);
  const count = () => { $("#fCount").textContent = `${games.filter(statusOk).filter(matches).length} games fit`; };
  count();
  $("#sheet").onclick = (e) => {
    const p = e.target.closest(".pill"); if (!p) return;
    const f = p.dataset.f, v = p.dataset.v;
    if (f === "players") { const n = parseInt(v, 10); filters.players = filters.players === n ? 0 : n; }
    if (f === "time") filters.time = filters.time === +v ? 0 : +v;
    if (f === "weight") { const map = { Light: [0, 2.2], Medium: [2.2, 3.2], Heavy: [3.2, 0] }; const [a, b] = map[v]; const on = filters.wmin === a && filters.wmax === b; filters.wmin = on ? 0 : a; filters.wmax = on ? 0 : b; }
    if (f === "styles" || f === "themes") { const s = filters[f]; s.has(v) ? s.delete(v) : s.add(v); }
    if (f === "lang") { const n = LANG.indexOf(v); filters.lang = filters.lang === n ? 0 : n; }
    const scroll = $("#sheet").scrollTop; render(); openFilters(); $("#sheet").scrollTop = scroll;
  };
  $("#bestOnly").onchange = (e) => { filters.bestOnly = e.target.checked; render(); count(); };
  $("#hideExp").onchange = (e) => { filters.hideExp = e.target.checked; render(); count(); };
  $("#fClear").onclick = () => { clearFilters(); openFilters(); };
  $("#pickBtn").onclick = pickOne;
}
function pickOne() {
  const pool = games.filter(statusOk).filter(matches).filter((g) => g.type === "base");
  if (!pool.length) { toast("Nothing fits those filters."); return; }
  // Favour well-loved games, and give dusty ones a little nudge
  const w = (g) => 1 + (g.myRating ? g.myRating / 3 : 0) + (friendsAvg(g) || 0) / 4 + Math.max(0, (g.bggRating || 6) - 6) + (daysSince(g.lastPlayed) > 365 ? 1 : 0);
  let r = Math.random() * pool.reduce((s, g) => s + w(g), 0), pick = pool[0];
  for (const g of pool) { r -= w(g); if (r <= 0) { pick = g; break; } }
  closeSheet();
  const el = $(`.item[data-id="${CSS.escape(pick.id)}"]`);
  if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.add("picked"); setTimeout(() => { el.classList.remove("picked"); openGame(pick.id); }, 1300); }
  else openGame(pick.id);
}

/* ------------------------------------------------------------ room: lights, torch, lively, cat */
function applyRoom() {
  document.body.classList.toggle("night", prefs.night);
  document.body.classList.toggle("torch", prefs.night && prefs.torch);
  document.body.classList.toggle("lively", prefs.lively);
  $("#lightBtn").setAttribute("aria-pressed", String(prefs.night)); $("#lightBtn").textContent = prefs.night ? "☀" : "☾";
  $("#livelyBtn").setAttribute("aria-pressed", String(prefs.lively));
  $$(".seg [data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === prefs.view));
}
document.addEventListener("pointermove", (e) => { if (prefs.night && prefs.torch) { document.body.style.setProperty("--mx", e.clientX + "px"); document.body.style.setProperty("--my", e.clientY + "px"); } }, { passive: true });

let livelyTimer = null;
function lively() {
  clearInterval(livelyTimer);
  const m = $("#motes"); m.innerHTML = "";
  if (!prefs.lively) return;
  for (let i = 0; i < 18; i++) { const d = document.createElement("i"); d.className = "mote"; d.style.left = Math.random() * 100 + "vw"; d.style.top = (60 + Math.random() * 60) + "vh"; d.style.animationDuration = (18 + Math.random() * 22) + "s"; d.style.animationDelay = (-Math.random() * 30) + "s"; d.style.opacity = (0.3 + Math.random() * 0.6).toFixed(2); m.appendChild(d); }
  livelyTimer = setInterval(() => {
    const items = $$(".item"); if (!items.length) return;
    const it = items[Math.floor(Math.random() * items.length)];
    const r = it.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) return;
    it.classList.add("wiggle"); setTimeout(() => it.classList.remove("wiggle"), 950);
    if (Math.random() < 0.04) callCat();
  }, 2600);
}

const CAT_SVG = `<svg viewBox="0 0 86 60"><g fill="#1b1714"><path class="tail" d="M16 30 C4 26 2 12 8 6 C10 4 13 6 11 9 C7 15 10 24 19 27 Z"/><ellipse cx="42" cy="34" rx="26" ry="13"/><circle cx="68" cy="24" r="11"/><path d="M60 16 L62 5 L68 14 Z M70 14 L76 5 L77 17 Z"/><rect class="leg" x="23" y="40" width="6" height="18" rx="3" style="transform-origin:26px 41px"/><rect class="leg b" x="31" y="40" width="6" height="18" rx="3" style="transform-origin:34px 41px"/><rect class="leg b" x="50" y="40" width="6" height="18" rx="3" style="transform-origin:53px 41px"/><rect class="leg" x="58" y="40" width="6" height="18" rx="3" style="transform-origin:61px 41px"/></g><circle cx="65" cy="23" r="1.8" fill="#f2c94c"/><circle cx="72" cy="23" r="1.8" fill="#f2c94c"/></svg>`;
let catBusy = false;
function callCat() {
  if (catBusy) return; const items = $$(".item"); if (!items.length) return;
  const room = $("#room"), rr = room.getBoundingClientRect();
  // pick a visible shelf line near the middle of the screen
  const vis = items.filter((i) => { const r = i.getBoundingClientRect(); return r.bottom > 80 && r.bottom < innerHeight - 10; });
  const ref = (vis.length ? vis : items)[Math.floor(Math.random() * (vis.length || items.length))];
  const y = ref.closest(".slot").getBoundingClientRect().bottom - rr.top;
  const cat = $("#cat"); catBusy = true;
  const fromLeft = Math.random() < 0.5, W = room.clientWidth;
  cat.innerHTML = CAT_SVG; cat.hidden = false; cat.className = "cat walk" + (fromLeft ? "" : " flip");
  cat.style.top = (y - 57) + "px";
  const start = fromLeft ? -90 : W + 10, mid = W * (0.3 + Math.random() * 0.4), end = fromLeft ? W + 10 : -90;
  cat.style.transition = "none"; cat.style.left = start + "px";
  requestAnimationFrame(() => requestAnimationFrame(() => {
    cat.style.transition = `left ${Math.abs(mid - start) / 90}s linear`; cat.style.left = mid + "px";
    setTimeout(() => { cat.classList.remove("walk"); setTimeout(() => { cat.classList.add("walk"); cat.style.transition = `left ${Math.abs(end - mid) / 110}s linear`; cat.style.left = end + "px";
      setTimeout(() => { cat.hidden = true; catBusy = false; }, Math.abs(end - mid) / 110 * 1000 + 100); }, 2600); }, Math.abs(mid - start) / 90 * 1000);
  }));
}
$("#cat").addEventListener("click", () => toast(["Mrrp.", "Purrrr…", "The cat approves of this collection.", "Meow. (It wants to play Isle of Cats.)"][Math.floor(Math.random() * 4)]));

/* ------------------------------------------------------------ controls */
function set(k, v) { prefs[k] = v; savePrefs(); }
function zoom(d) { set("zoom", Math.min(1.8, Math.max(0.55, +(prefs.zoom + d).toFixed(2)))); render(); }
$$(".seg [data-view]").forEach((b) => b.addEventListener("click", () => { set("view", b.dataset.view); applyRoom(); render(); }));
for (const [id, key] of [["#arrange", "arrange"], ["#sort", "sort"], ["#status", "status"]]) { $(id).value = prefs[key]; $(id).addEventListener("change", (e) => { set(key, e.target.value); render(); }); }
$("#search").addEventListener("input", (e) => { query = e.target.value.trim().toLowerCase(); render(); });
$("#playBtn").addEventListener("click", openFilters);
$("#zoomIn").addEventListener("click", () => zoom(0.15));
$("#zoomOut").addEventListener("click", () => zoom(-0.15));
$("#lightBtn").addEventListener("click", () => { set("night", !prefs.night); if (prefs.night) toast("Lights off. Press T for a torch."); applyRoom(); });
$("#livelyBtn").addEventListener("click", () => { set("lively", !prefs.lively); applyRoom(); lively(); toast(prefs.lively ? "The shelf is lively." : "The shelf settles down."); });
$("#catBtn").addEventListener("click", callCat);
$("#fullBtn").addEventListener("click", toggleFull);
$("#hideBtn").addEventListener("click", toggleBare);
$("#unhide").addEventListener("click", toggleBare);
$("#helpBtn").addEventListener("click", openHelp);
function toggleFull() { const d = document; if (!d.fullscreenElement) d.documentElement.requestFullscreen?.().catch(() => toast("Full screen isn't available here.")); else d.exitFullscreen?.(); }
function toggleBare() { const on = !document.body.classList.contains("bare"); document.body.classList.toggle("bare", on); $("#unhide").hidden = !on; }
function openHelp() {
  openSheet(`<div class="sheet-top"><h2 id="sheetTitle" style="font-family:var(--display);font-size:26px;margin:0">Player aid</h2><button class="x" data-close aria-label="Close">×</button></div>
  <dl class="keys">
    <dt><kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd></dt><dd>Step along the shelf; up/down to the shelf above or below</dd>
    <dt><kbd>Enter</kbd> / <kbd>Esc</kbd></dt><dd>Open / close a game</dd>
    <dt><kbd>/</kbd></dt><dd>Search</dd><dt><kbd>P</kbd></dt><dd>What shall we play?</dd>
    <dt><kbd>+</kbd> <kbd>−</kbd></dt><dd>Zoom</dd><dt><kbd>V</kbd></dt><dd>Covers or spines</dd>
    <dt><kbd>H</kbd> / <kbd>F</kbd></dt><dd>Just the shelf / full screen</dd>
    <dt><kbd>L</kbd> / <kbd>T</kbd></dt><dd>Lights on or off / torch in the dark</dd>
    <dt><kbd>C</kbd></dt><dd>Call the cat</dd>
  </dl>`);
}

/* keyboard */
function moveFocus(dir) {
  const items = $$(".item"); if (!items.length) return;
  const cur = document.activeElement?.classList?.contains("item") ? document.activeElement : null;
  if (!cur) { items[0].focus(); return; }
  const i = items.indexOf(cur);
  if (dir === "left") return items[Math.max(0, i - 1)].focus();
  if (dir === "right") return items[Math.min(items.length - 1, i + 1)].focus();
  const r = cur.getBoundingClientRect(), cx = r.left + r.width / 2;
  const cand = items.map((el) => ({ el, r: el.getBoundingClientRect() })).filter(({ r: q }) => dir === "down" ? q.bottom > r.bottom + 5 : q.bottom < r.bottom - 5);
  if (!cand.length) return;
  const targetBottom = dir === "down" ? Math.min(...cand.map((c) => c.r.bottom)) : Math.max(...cand.map((c) => c.r.bottom));
  const line = cand.filter((c) => Math.abs(c.r.bottom - targetBottom) < 6);
  line.sort((a, b) => Math.abs(a.r.left + a.r.width / 2 - cx) - Math.abs(b.r.left + b.r.width / 2 - cx));
  line[0].el.focus(); line[0].el.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || "");
  if (e.key === "Escape") { if (!$("#overlay").hidden) closeSheet(); else if (typing) document.activeElement.blur(); return; }
  if (typing || !$("#overlay").hidden) return;
  const k = e.key;
  const map = { ArrowLeft: () => moveFocus("left"), ArrowRight: () => moveFocus("right"), ArrowUp: () => moveFocus("up"), ArrowDown: () => moveFocus("down"),
    "/": () => $("#search").focus(), "+": () => zoom(0.15), "=": () => zoom(0.15), "-": () => zoom(-0.15),
    v: () => { set("view", prefs.view === "covers" ? "spines" : "covers"); applyRoom(); render(); }, h: toggleBare, f: toggleFull,
    l: () => $("#lightBtn").click(), t: () => { if (!prefs.night) { set("night", true); } set("torch", !prefs.torch); applyRoom(); }, c: callCat, p: openFilters, "?": openHelp };
  const fn = map[k] || map[k.toLowerCase?.()];
  if (fn) { e.preventDefault(); fn(); }
});
let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => prefs.view === "spines" && render(), 200); });

/* ------------------------------------------------------------ boot */
async function boot() {
  applyRoom(); lively();
  try {
    const res = await fetch("data/games.json", { cache: "no-cache" });
    DATA = await res.json();
  } catch { $("#shelves").innerHTML = `<div class="empty">Couldn't load data/games.json.</div>`; $("#subtitle").textContent = ""; return; }
  games = (DATA.games || []).filter((g) => g && g.id && g.name);
  for (const g of games) byId.set(String(g.id), g);
  document.title = DATA.title || "Game Shelf";
  $("#title").textContent = DATA.title || "Game Shelf";
  $("#demo").hidden = !DATA.demo;
  // If nothing is marked owned (e.g. a list-only shelf), show everything
  if (prefs.status === "own" && !games.some((g) => (g.status || []).includes("own"))) { prefs.status = "all"; $("#status").value = "all"; }
  const when = DATA.generated ? new Date(DATA.generated).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null;
  $("#foot").innerHTML = `<span>${DATA.owner ? `Collection of <a href="https://boardgamegeek.com/collection/user/${encodeURIComponent(DATA.owner)}" target="_blank" rel="noopener">${esc(DATA.owner)}</a> on BoardGameGeek` : ""}${when ? ` · synced ${esc(when)}` : ""}</span><a href="https://boardgamegeek.com" target="_blank" rel="noopener">Powered by BoardGameGeek</a>`;
  render();
  const h = decodeURIComponent(location.hash.slice(1)); if (h && byId.has(h)) openGame(h);
}
boot();
