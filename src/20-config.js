/* ==================================================================
   20 · Page config: load config.json, pick the row for this page
   - Returning visitors: cached copy used at once, refreshed in the
     background (a change shows from their next page).
   - First visit: wait up to CONFIG_WAIT_MS, then fall back to the
     built-in DEFAULT_ROWS. A late response is still cached.
   ================================================================== */
var CONFIG_CACHE_KEY = "spotler_mia_config";

function fetchConfig(cb) {
  var done = false;
  var xhr;
  try {
    xhr = new XMLHttpRequest();
    xhr.open("GET", SETTINGS.CONFIG_URL, true);
    xhr.timeout = 10000;
    xhr.onload = function () {
      if (done) return; done = true;
      if (xhr.status >= 200 && xhr.status < 300) {
        try { cb(validateConfig(JSON.parse(xhr.responseText))); return; } catch (e) { log("config parse failed", e); }
      }
      cb(null);
    };
    xhr.onerror = xhr.ontimeout = function () { if (!done) { done = true; cb(null); } };
    xhr.send();
  } catch (e) { if (!done) { done = true; cb(null); } }
}

// Defensive: never trust the file's shape. Bad rows are dropped, not fatal.
function validateConfig(cfg) {
  if (!cfg || typeof cfg !== "object" || !cfg.rows || !cfg.rows.length) throw new Error("no rows");
  var rows = [];
  for (var i = 0; i < cfg.rows.length; i++) {
    var r = cfg.rows[i];
    if (!r || typeof r.url_match !== "string" || typeof r.region !== "string") continue;
    rows.push({
      url_match: trim(r.url_match).toLowerCase(),
      match_type: (r.match_type === "exact" || r.match_type === "contains") ? r.match_type : "prefix",
      region: r.region,
      mode: (r.mode === "half" || r.mode === "full") ? r.mode : "slideout",
      page: typeof r.page === "string" ? r.page : "",
      route: typeof r.route === "string" ? r.route : "",
      opener: typeof r.opener === "string" ? r.opener.slice(0, 1200) : "",
      buttons: (r.buttons || []).filter(function (b) { return b && trim(b.label); }).slice(0, 6).map(function (b) {
        return { label: trim(b.label).slice(0, 80), send: trim(b.send || b.label).slice(0, 300) };
      }),
      teaser_text: typeof r.teaser_text === "string" ? r.teaser_text.slice(0, 200) : "",
      teaser_send: typeof r.teaser_send === "string" ? r.teaser_send.slice(0, 300) : "",
      headline: typeof r.headline === "string" ? r.headline.slice(0, 200) : "",
      intro: typeof r.intro === "string" ? r.intro.slice(0, 400) : "",
      media_selector: typeof r.media_selector === "string" ? r.media_selector.slice(0, 300) : ""
    });
  }
  if (!rows.length) throw new Error("no valid rows");
  return {
    version: String(cfg.version || ""),
    enabledRegions: (cfg.enabledRegions && cfg.enabledRegions.length) ? cfg.enabledRegions : null,
    rows: rows
  };
}

function loadConfig(cb) {
  var cached = LS.getJSON(CONFIG_CACHE_KEY);
  var answered = false;
  function answer(cfg, source) {
    if (answered) return;
    answered = true;
    log("config from " + source + (cfg && cfg.version ? " v" + cfg.version : ""));
    cb(cfg);
  }

  if (cached && cached.rows) answer(cached, "cache");

  fetchConfig(function (fresh) {
    if (fresh) {
      if (!cached || cached.version !== fresh.version) LS.setJSON(CONFIG_CACHE_KEY, fresh);
      answer(fresh, "network");
    } else {
      answer(null, "built-in default (fetch failed)");
    }
  });

  if (!cached) setTimeout(function () { answer(null, "built-in default (slow)"); }, SETTINGS.CONFIG_WAIT_MS);
}

function normalisePath(p) {
  p = String(p || "/").toLowerCase().split("?")[0].split("#")[0];
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p || "/";
}

// Most specific match wins: exact > longest prefix > "*".
function matchRow(rows, path, regionId) {
  path = normalisePath(path);
  var best = null, bestScore = -1;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r.region !== regionId) continue;
    var m = r.url_match === "*" ? "*" : normalisePath(r.url_match);
    var score = -1;
    if (m === "*") score = 0;
    else if (r.match_type === "exact") { if (path === m) score = 100000 + m.length; }
    else if (r.match_type === "contains") { if (path.indexOf(String(r.url_match).toLowerCase()) !== -1) score = r.url_match.length; }
    else if (path === m || path.indexOf(m + "/") === 0) score = m.length;
    if (score > bestScore) { best = r; bestScore = score; }
  }
  return best;
}

function rowsFor(cfg) {
  return (cfg && cfg.rows) ? cfg.rows : SETTINGS.DEFAULT_ROWS;
}

// A page row only needs the columns it changes: anything left blank
// comes from that region's "*" row, then from the built-in default.
function pickRow(cfg, path, regionId) {
  var rows = rowsFor(cfg);
  var row = matchRow(rows, path, regionId);
  var base = matchRow(rows, "/__no_page__", regionId);
  var builtIn = matchRow(SETTINGS.DEFAULT_ROWS, "/__no_page__", regionId);
  var out = {};
  [builtIn, base, row].forEach(function (r) {
    if (!r) return;
    for (var k in r) {
      if (!r.hasOwnProperty(k)) continue;
      var v = r[k];
      if (k === "buttons") {
        // No buttons on a row = inherit, unless that row sets its own opener.
        if (v && v.length) out.buttons = v;
        else if (r === row && r.opener) out.buttons = [];
        continue;
      }
      if (v == null || v === "") continue;
      out[k] = v;
    }
  });
  return out;
}
