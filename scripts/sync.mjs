#!/usr/bin/env node
// Game Shelf: BoardGameGeek sync.
// Reads config.json + games.txt, pulls the owner's BGG collection, game details,
// friends' ratings and box covers, and writes site/data/games.json.
//
//   BGG_TOKEN=xxxx node scripts/sync.mjs
//
// Get a token by registering a (free, non-commercial) app at https://boardgamegeek.com/applications

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.resolve(process.env.SHELF_SITE || path.join(ROOT, "site"));
const DATA = path.resolve(process.env.SHELF_DATA || path.join(ROOT, "data"));
const CONFIG_FILE = path.resolve(process.env.SHELF_CONFIG || path.join(ROOT, "config.json"));
const GAMES_FILE = path.resolve(process.env.SHELF_GAMES || path.join(ROOT, "games.txt"));
const EXTRAS_FILE = path.resolve(process.env.SHELF_EXTRAS || path.join(ROOT, "extras.json"));
const API = "https://boardgamegeek.com/xmlapi2";
const TOKEN = process.env.BGG_TOKEN || "";
const MOCK = process.env.BGG_MOCK || ""; // folder of fixture XML files, for offline testing
const DELAY = Number(process.env.BGG_DELAY_MS || 2000);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "text",
  parseAttributeValue: false,
  parseTagValue: false,
  isArray: (name, _jpath, _leaf, isAttr) => !isAttr && ["item", "link", "name", "rank", "poll", "results", "result", "poll-summary", "video", "play", "subtype"].includes(name),
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : null; };
const attr = (node, key = "value") => (node && typeof node === "object" ? node[key] : node);
const text = (node) => (node == null ? "" : typeof node === "object" ? (node.text ?? "") : String(node));

async function readJSON(file, fallback) { try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; } }
async function writeJSON(file, data) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n"); }

/* ------------------------------------------------------------------ HTTP */
let lastCall = 0;
async function bgg(endpoint, params) {
  const url = `${API}/${endpoint}?` + new URLSearchParams(params).toString();
  if (MOCK) return mockFetch(endpoint, params);
  for (let attempt = 1; attempt <= 12; attempt++) {
    const wait = lastCall + DELAY - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    let res;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, "User-Agent": "game-shelf-sync/1.0" } });
    } catch (e) { log(`  network error (${e.message}), retrying…`); await sleep(5000 * attempt); continue; }
    if (res.status === 200) return parser.parse(await res.text());
    if (res.status === 202) { log("  BGG is preparing the collection, waiting…"); await sleep(5000 + 2000 * attempt); continue; }
    if (res.status === 401 || res.status === 403) throw new Error(`BGG refused the request (${res.status}). Check the BGG_TOKEN secret.`);
    if (res.status === 429 || res.status >= 500) { log(`  BGG said ${res.status}, backing off…`); await sleep(8000 * attempt); continue; }
    throw new Error(`BGG ${endpoint} failed with HTTP ${res.status}`);
  }
  throw new Error(`BGG ${endpoint} kept failing; try again later.`);
}

async function mockFetch(endpoint, params) {
  const read = async (f) => { try { return await fs.readFile(path.join(MOCK, f), "utf8"); } catch { return null; } };
  if (endpoint === "collection") {
    const xml = await read(`collection-${params.username}-${params.subtype || "boardgame"}.xml`);
    return parser.parse(xml || "<items totalitems=\"0\"></items>");
  }
  if (endpoint === "thing") {
    const parts = [];
    for (const id of String(params.id).split(",")) { const x = await read(`thing-${id}.xml`); if (x) parts.push(x); }
    return parser.parse(`<items>${parts.join("")}</items>`);
  }
  if (endpoint === "plays") return parser.parse((params.page == 1 && await read(`plays-${params.username}.xml`)) || "<plays total=\"0\"></plays>");
  if (endpoint === "search") {
    const key = String(params.query).toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const x = (params.exact ? await read(`search-exact-${key}.xml`) : null) ?? await read(`search-${key}.xml`);
    return parser.parse(x || "<items total=\"0\"></items>");
  }
  return parser.parse("<items></items>");
}

/* ------------------------------------------------------------ parsing */
function parseThing(it) {
  const names = arr(it.name);
  const primary = names.find((n) => n.type === "primary") || names[0] || {};
  const links = arr(it.link);
  const linkVals = (type) => links.filter((l) => l.type === type).map((l) => l.value);
  const polls = arr(it.poll);
  const stats = it.statistics?.ratings || {};
  const rankNode = arr(stats.ranks?.rank).find((r) => r.name === "boardgame");

  // Player-count poll → best / recommended counts
  const best = [], rec = [];
  const pn = polls.find((p) => p.name === "suggested_numplayers");
  for (const r of arr(pn?.results)) {
    const votes = Object.fromEntries(arr(r.result).map((x) => [x.value, int(x.numvotes) || 0]));
    const total = (votes.Best || 0) + (votes.Recommended || 0) + (votes["Not Recommended"] || 0);
    if (total < 3) continue;
    const n = String(r.numplayers).replace("+", "");
    const count = int(n); if (!count) continue;
    if ((votes.Best || 0) >= (votes.Recommended || 0) && (votes.Best || 0) > (votes["Not Recommended"] || 0)) best.push(count);
    if ((votes.Best || 0) + (votes.Recommended || 0) > (votes["Not Recommended"] || 0)) rec.push(count);
  }
  // Language dependence poll → winning level 1..5
  let lang = null;
  const lp = polls.find((p) => p.name === "language_dependence");
  const lres = arr(arr(lp?.results)[0]?.result);
  if (lres.length) {
    const top = lres.reduce((a, b) => ((int(b.numvotes) || 0) > (int(a.numvotes) || 0) ? b : a));
    if ((int(top.numvotes) || 0) > 0) lang = int(top.level);
  }

  const type = it.type === "boardgameexpansion" ? "expansion" : it.type === "boardgameaccessory" ? "accessory" : "base";
  return {
    id: String(it.id),
    name: primary.value || "Unknown",
    altNames: names.filter((n) => n.type !== "primary").map((n) => n.value).slice(0, 40),
    type,
    year: int(attr(it.yearpublished)),
    imageUrl: text(it.image).trim() || null,
    thumbUrl: text(it.thumbnail).trim() || null,
    description: cleanDescription(text(it.description)),
    minPlayers: int(attr(it.minplayers)), maxPlayers: int(attr(it.maxplayers)),
    bestPlayers: best, recPlayers: rec,
    minTime: int(attr(it.minplaytime)) || int(attr(it.playingtime)), maxTime: int(attr(it.maxplaytime)) || int(attr(it.playingtime)),
    minAge: int(attr(it.minage)),
    weight: num(attr(stats.averageweight)) || null,
    bggRating: num(attr(stats.average)) || null,
    usersRated: int(attr(stats.usersrated)) || 0,
    bggRank: rankNode ? int(rankNode.value) : null,
    categories: linkVals("boardgamecategory"),
    mechanics: linkVals("boardgamemechanic"),
    designers: linkVals("boardgamedesigner").filter((d) => d !== "(Uncredited)"),
    publishers: linkVals("boardgamepublisher").slice(0, 3),
    // On an expansion, links with inbound="true" point at the base game(s).
    baseIds: type !== "base" ? links.filter((l) => (l.type === "boardgameexpansion" || l.type === "boardgameaccessory") && l.inbound === "true").map((l) => String(l.id)) : [],
    lang,
    videos: arr(it.videos?.video).filter((v) => v.category === "instructional" && /^https?:/.test(v.link || "")).map((v) => ({ title: v.title, link: v.link.replace(/^http:/, "https:"), language: v.language || "", date: v.postdate || "" })),
  };
}

function cleanDescription(s) {
  const decoded = s
    .replace(/&#10;/g, "\n").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&mdash;/g, "—").replace(/&ndash;/g, "–").replace(/&hellip;/g, "…")
    .replace(/&rsquo;/g, "’").replace(/&lsquo;/g, "‘").replace(/&ldquo;/g, "“").replace(/&rdquo;/g, "”").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&[a-z]+;/g, " ");
  return decoded.split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean).join("\n\n").slice(0, 2400);
}

function parseCollection(doc) {
  return arr(doc?.items?.item).map((it) => {
    const st = it.status || {};
    const statuses = ["own", "prevowned", "fortrade", "want", "wanttoplay", "wanttobuy", "wishlist", "preordered"].filter((k) => st[k] === "1");
    const rating = num(attr(it.stats?.rating));
    return {
      id: String(it.objectid),
      subtype: it.subtype,
      statuses,
      name: text(arr(it.name)[0]).trim(),
      myRating: rating && rating > 0 ? rating : null,
      numPlays: int(text(it.numplays)) || 0,
      comment: text(it.comment).trim() || null,
      lastModified: st.lastmodified || null,
    };
  });
}

/* --------------------------------------------------------- themes & styles */
const THEME_RULES = [
  ["Fantasy", ["Fantasy", "Medieval"]],
  ["Sci-fi & space", ["Science Fiction", "Space Exploration"]],
  ["Horror", ["Horror", "Zombies"]],
  ["History & war", ["Wargame", "World War I", "World War II", "Modern Warfare", "Napoleonic", "American Civil War", "Ancient", "Renaissance", "Age of Reason", "Civilization", "Political", "Pirates", "American West", "Post-Napoleonic", "Vietnam War", "Korean War", "American Revolutionary War", "Prehistoric", "Arabian"]],
  ["Mythology", ["Mythology"]],
  ["Nature & animals", ["Animals", "Environmental", "Farming"]],
  ["Trade & building", ["Economic", "City Building", "Industry / Manufacturing", "Territory Building", "Trains", "Transportation", "Nautical", "Travel", "Mature / Adult"]],
  ["Adventure", ["Adventure", "Exploration", "Murder/Mystery", "Spies/Secret Agents"]],
  ["Party & words", ["Party Game", "Word Game", "Trivia", "Humor", "Music", "Movies / TV / Radio theme"]],
  ["Sports & racing", ["Sports", "Racing"]],
  ["Abstract & puzzle", ["Abstract Strategy", "Puzzle", "Math", "Number"]],
];
const STYLE_RULES = [
  ["Co-op", ["Cooperative Game", "Team-Based Game", "Semi-Cooperative Game"]],
  ["Deck & bag building", ["Deck, Bag, and Pool Building"]],
  ["Worker placement", ["Worker Placement", "Worker Placement, Different Worker Types", "Worker Placement with Dice Workers"]],
  ["Tile laying", ["Tile Placement", "Grid Coverage", "Pattern Building", "Network and Route Building"]],
  ["Drafting", ["Card Drafting", "Open Drafting", "Closed Drafting"]],
  ["Dice", ["Dice Rolling", "Die Icon Resolution"]],
  ["Area control", ["Area Majority / Influence", "Area-Impulse", "Territory Building"]],
  ["Engine building", ["Tableau Building", "Income", "Resource to Move"]],
  ["Auction & trading", ["Auction/Bidding", "Auction: Open", "Auction: Sealed Bid", "Auction: Turn Order Until Pass", "Trading", "Negotiation", "Market"]],
  ["Bluffing & deduction", ["Hidden Roles", "Deduction", "Betting and Bluffing", "Traitor Game"]],
  ["Push your luck", ["Push Your Luck"]],
  ["Trick-taking", ["Trick-taking", "Ladder Climbing"]],
  ["Real-time & dexterity", ["Real-Time", "Speed Matching", "Physical Removal", "Stacking and Balancing", "Flicking"]],
  ["Roll & write", ["Paper-and-Pencil", "Roll / Spin and Move"]],
  ["Legacy & campaign", ["Legacy Game", "Campaign / Battle Card Driven", "Scenario / Mission / Campaign Game"]],
  ["Miniatures & skirmish", ["Simulation", "Hexagon Grid", "Critical Hits and Failures", "Line of Sight"]],
];
function classify(g) {
  const cats = new Set([...(g.categories || [])]);
  const mech = new Set([...(g.mechanics || [])]);
  const themes = THEME_RULES.filter(([, keys]) => keys.some((k) => cats.has(k))).map(([t]) => t);
  const styles = STYLE_RULES.filter(([, keys]) => keys.some((k) => mech.has(k))).map(([t]) => t);
  if (cats.has("Party Game") && !styles.includes("Party")) styles.unshift("Party");
  if (cats.has("Children's Game")) themes.push("Kids");
  if (g.maxPlayers === 2 && g.minPlayers <= 2) styles.push("Two-player");
  return { themes: themes.length ? themes : ["Other"], styles: [...new Set(styles)].slice(0, 6) };
}

/* ---------------------------------------------------------------- covers */
let sharp = null;
try { sharp = (await import("sharp")).default; } catch { log("(sharp not installed: covers will be linked from BGG instead of saved locally)"); }

async function cover(g, cache) {
  if (!g.imageUrl) return { image: null, color: null, ratio: null };
  const file = `covers/${g.id}.jpg`;
  const hit = cache[g.id];
  if (hit && hit.src === g.imageUrl) { try { await fs.access(path.join(SITE, file)); return hit; } catch { /* re-download */ } }
  if (!sharp || MOCK) return { image: g.imageUrl, color: null, ratio: null };
  try {
    const res = await fetch(g.imageUrl, { headers: { "User-Agent": "game-shelf-sync/1.0" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const img = sharp(buf).rotate().resize({ width: 420, height: 420, fit: "inside", withoutEnlargement: true });
    const out = await img.jpeg({ quality: 80, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    await fs.mkdir(path.join(SITE, "covers"), { recursive: true });
    await fs.writeFile(path.join(SITE, file), out.data);
    // Spine colour: the dominant colour of the box art's left edge, else the whole cover
    let color = null;
    try {
      const { width, height } = out.info;
      const edge = await sharp(out.data).extract({ left: 0, top: 0, width: Math.max(8, Math.round(width * 0.12)), height }).stats();
      const d = edge.dominant; color = "#" + [d.r, d.g, d.b].map((v) => v.toString(16).padStart(2, "0")).join("");
    } catch { /* ignore */ }
    const entry = { src: g.imageUrl, image: file, color, ratio: +(out.info.width / out.info.height).toFixed(3) };
    cache[g.id] = entry;
    await sleep(300);
    return entry;
  } catch (e) {
    log(`  cover for ${g.name} not saved (${e.message}); linking BGG's copy`);
    return { image: g.imageUrl, color: null, ratio: null };
  }
}

function pickVideos(videos, langs) {
  const score = (v) => { const i = langs.indexOf(v.language); return i < 0 ? 99 : i; };
  return [...(videos || [])].sort((a, b) => score(a) - score(b) || String(b.date).localeCompare(String(a.date))).slice(0, 3);
}

/* ---------------------------------------------------------- games.txt */
function parseLine(line) {
  const raw = line.replace(/#.*$/, "").trim();
  if (!raw) return null;
  const idMatch = raw.match(/^(?:bgg:)?(\d+)$/) || raw.match(/boardgamegeek\.com\/(?:boardgame|boardgameexpansion|boardgameaccessory|thing)\/(\d+)/);
  if (idMatch) return { raw, id: idMatch[1] };
  const y = raw.match(/^(.*?)\s*\((\d{4})\)\s*$/);
  return y ? { raw, name: y[1].trim(), year: +y[2] } : { raw, name: raw };
}

async function resolveName(entry) {
  const candidates = new Map();
  for (const exact of [1, 0]) {
    const doc = await bgg("search", { query: entry.name, type: "boardgame,boardgameexpansion", ...(exact ? { exact: 1 } : {}) });
    for (const it of arr(doc?.items?.item)) {
      const year = int(attr(it.yearpublished));
      if (entry.year && year && Math.abs(year - entry.year) > 1) continue;
      candidates.set(String(it.id), { id: String(it.id), name: attr(arr(it.name)[0]), year });
    }
    if (candidates.size) break;
  }
  if (!candidates.size) return null;
  if (candidates.size === 1) return [...candidates.keys()][0];
  // Several matches (editions, reprints): fetch stats and take the most-rated one.
  const ids = [...candidates.keys()].slice(0, 20);
  const doc = await bgg("thing", { id: ids.join(","), stats: 1 });
  const ranked = arr(doc?.items?.item).map(parseThing).sort((a, b) => {
    const exactA = [a.name, ...a.altNames].some((n) => n.toLowerCase() === entry.name.toLowerCase()) ? 1 : 0;
    const exactB = [b.name, ...b.altNames].some((n) => n.toLowerCase() === entry.name.toLowerCase()) ? 1 : 0;
    return exactB - exactA || b.usersRated - a.usersRated;
  });
  return ranked[0]?.id || ids[0];
}

/* ------------------------------------------------------------------ main */
async function main() {
  const config = await readJSON(CONFIG_FILE, {});
  const owner = String(config.bggUser || "").trim();
  if (!MOCK && !TOKEN) throw new Error("BGG_TOKEN is missing. Register an app at https://boardgamegeek.com/applications and add the token as a repository secret named BGG_TOKEN.");
  const keep = new Set(config.includeStatuses || ["own", "preordered"]);

  const resolved = await readJSON(path.join(DATA, "resolved.json"), {});
  const coverCache = await readJSON(path.join(DATA, "covers.json"), {});
  const extras = await readJSON(EXTRAS_FILE, {});
  const report = { generated: new Date().toISOString(), owner, unresolved: [], resolvedFromList: [], warnings: [] };

  // 1) Owner's collection (games, expansions, accessories)
  const coll = new Map();
  if (owner) {
    for (const subtype of ["boardgame", "boardgameexpansion", "boardgameaccessory"]) {
      log(`Fetching ${owner}'s ${subtype} collection…`);
      const items = parseCollection(await bgg("collection", { username: owner, subtype, stats: 1, ...(subtype === "boardgame" ? { excludesubtype: "boardgameexpansion" } : {}) }));
      for (const c of items) {
        const kept = c.statuses.some((s) => keep.has(s)) || (config.includeRated !== false && (c.myRating || c.comment));
        if (kept) coll.set(c.id, { ...coll.get(c.id), ...c });
      }
    }
    log(`  ${coll.size} items in the collection`);
  } else report.warnings.push("No bggUser in config.json; only games.txt was used.");

  // 2) games.txt (extra games not on BGG yet, or the whole list if there is no BGG collection)
  const listText = await fs.readFile(GAMES_FILE, "utf8").catch(() => "");
  const listIds = new Set(), currentLines = new Set();
  for (const line of listText.split(/\r?\n/)) {
    const e = parseLine(line); if (!e) continue;
    currentLines.add(e.raw);
    let id = e.id || resolved[e.raw];
    if (!id && e.name) { const hit = [...coll.values()].find((c) => c.name && c.name.toLowerCase() === e.name.toLowerCase()); if (hit) id = hit.id; }
    if (id === undefined) {
      log(`Looking up "${e.raw}" on BGG…`);
      id = await resolveName(e);
      resolved[e.raw] = id || null;
    }
    if (id) listIds.add(String(id)); else report.unresolved.push(e.raw);
  }

  // 3) Details for everything
  const allIds = [...new Set([...coll.keys(), ...listIds])];
  const things = new Map();
  for (let i = 0; i < allIds.length; i += 20) {
    const batch = allIds.slice(i, i + 20);
    log(`Fetching details ${i + 1}–${i + batch.length} of ${allIds.length}…`);
    const doc = await bgg("thing", { id: batch.join(","), stats: 1, videos: 1 });
    for (const it of arr(doc?.items?.item)) { const t = parseThing(it); things.set(t.id, t); }
  }
  for (const [raw, id] of Object.entries(resolved)) if (id && currentLines.has(raw) && things.has(String(id))) report.resolvedFromList.push({ line: raw, id, name: things.get(String(id)).name, year: things.get(String(id)).year });

  // 3b) Logged plays → last played date per game
  const plays = new Map(); // id -> {last, count}
  if (owner && config.includePlays !== false) {
    for (let page = 1; page <= 50; page++) {
      log(`Fetching ${owner}'s logged plays (page ${page})…`);
      const doc = await bgg("plays", { username: owner, page });
      const list = arr(doc?.plays?.play);
      for (const p of list) {
        const it = arr(p.item)[0]; if (!it) continue;
        const id = String(it.objectid), date = p.date && p.date !== "0000-00-00" ? p.date : null;
        const cur = plays.get(id) || { last: null, count: 0 };
        cur.count += int(p.quantity) || 1;
        if (date && (!cur.last || date > cur.last)) cur.last = date;
        plays.set(id, cur);
      }
      if (list.length < 100) break;
    }
  }

  // 4) Friends' ratings
  const friendRatings = new Map(); // id -> [{user, rating}]
  for (const f of (config.friends || []).map((s) => String(s).trim()).filter(Boolean)) {
    try {
      log(`Fetching ratings from ${f}…`);
      for (const subtype of ["boardgame", "boardgameexpansion"]) {
        const items = parseCollection(await bgg("collection", { username: f, subtype, rated: 1, stats: 1 }));
        for (const c of items) if (c.myRating && things.has(c.id)) {
          const list = friendRatings.get(c.id) || []; if (!list.some((x) => x.user === f)) list.push({ user: f, rating: c.myRating }); friendRatings.set(c.id, list);
        }
      }
    } catch (e) { report.warnings.push(`Couldn't read ${f}'s ratings: ${e.message}`); }
  }

  // 5) Assemble
  const games = [];
  for (const id of allIds) {
    const t = things.get(id); if (!t) { report.warnings.push(`BGG returned no details for id ${id}`); continue; }
    const c = coll.get(id) || {};
    const ex = extras[id] || extras[t.name] || {};
    const cv = await cover(t, coverCache);
    const { themes, styles } = classify(t);
    games.push({
      id, name: ex.name || t.name, type: t.type, year: t.year,
      image: cv.image, color: ex.color || cv.color, ratio: cv.ratio,
      minPlayers: t.minPlayers, maxPlayers: t.maxPlayers, bestPlayers: t.bestPlayers, recPlayers: t.recPlayers,
      minTime: t.minTime, maxTime: t.maxTime, minAge: t.minAge,
      weight: t.weight ? +t.weight.toFixed(2) : null, bggRating: t.bggRating ? +t.bggRating.toFixed(2) : null, bggRank: t.bggRank, usersRated: t.usersRated,
      myRating: ex.myRating ?? c.myRating ?? null,
      friends: friendRatings.get(id) || [],
      designers: t.designers, publishers: t.publishers, categories: t.categories, mechanics: t.mechanics,
      themes: ex.themes || themes, styles: ex.styles || styles,
      baseIds: t.baseIds, lang: t.lang,
      status: c.statuses || ["own"], owned: (c.statuses || ["own"]).includes("own"),
      numPlays: Math.max(c.numPlays || 0, plays.get(id)?.count || 0), lastPlayed: plays.get(id)?.last || null,
      review: c.comment || null, notes: ex.notes || null,
      howToPlay: ex.howToPlay || null, rulesUrl: ex.rulesUrl || null,
      videos: pickVideos(t.videos, config.videoLanguages || ["English"]),
      description: ex.description || t.description,
      added: c.lastModified || null,
    });
  }
  // Expansions with base games not owned: borrow weight from the base when missing
  const byId = new Map(games.map((g) => [g.id, g]));
  for (const g of games) if (!g.weight && g.baseIds.length) { const b = g.baseIds.map((x) => byId.get(x) || things.get(x)).find(Boolean); if (b?.weight) g.weight = +b.weight.toFixed(2); }

  games.sort((a, b) => a.name.localeCompare(b.name));
  await writeJSON(path.join(SITE, "data", "games.json"), {
    title: config.title || (owner ? `${owner}'s Game Shelf` : "Game Shelf"),
    owner, friends: config.friends || [], generated: report.generated, demo: false, games,
  });
  await writeJSON(path.join(DATA, "resolved.json"), resolved);
  await writeJSON(path.join(DATA, "covers.json"), coverCache);
  await writeJSON(path.join(DATA, "sync-report.json"), report);

  log(`\nDone: ${games.length} items written to site/data/games.json`);
  if (report.unresolved.length) log(`Not found on BGG (edit these lines in games.txt, e.g. use the BGG id):\n  - ${report.unresolved.join("\n  - ")}`);
  for (const w of report.warnings) log(`Warning: ${w}`);
}

main().catch((e) => { console.error(`\nSync failed: ${e.message}`); process.exit(1); });
