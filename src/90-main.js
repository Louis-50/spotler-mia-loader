/* ==================================================================
   90 · Boot
   v1 runs the slide-out on desktop only. Rows set to "half" or "full"
   are left alone (their old campaign tags still serve them) until the
   embedded modes ship.
   ================================================================== */
function detectRegion(path) {
  for (var i = 0; i < SETTINGS.REGIONS.length; i++) {
    if (SETTINGS.REGIONS[i].test.test(path)) return SETTINGS.REGIONS[i];
  }
  return SETTINGS.REGIONS[SETTINGS.REGIONS.length - 1];
}

function isLegacyExcluded(path) {
  path = normalisePath(path);
  for (var i = 0; i < SETTINGS.LEGACY_EXCLUDE.length; i++) {
    var p = normalisePath(SETTINGS.LEGACY_EXCLUDE[i]);
    if (path === p || path.indexOf(p + "/") === 0) return true;
  }
  return false;
}

function boot() {
  if (window.__spotlerMiaStarted) return;          // GTM can fire a tag twice
  window.__spotlerMiaStarted = SETTINGS.VERSION;

  var path = location.pathname;
  if (isLegacyExcluded(path)) { log("off: page still on a legacy campaign tag"); return; }

  var region = detectRegion(path);
  var cachedCfg = LS.getJSON(CONFIG_CACHE_KEY);
  var enabled = (cachedCfg && cachedCfg.enabledRegions) || SETTINGS.ENABLED_REGIONS;
  if (enabled.indexOf(region.id) === -1) { log("off: region " + region.id + " not enabled"); return; }

  if (window.innerWidth < SETTINGS.DESKTOP_MIN_WIDTH || isMobileOrTabletUA()) {
    log("off: slide-out is desktop only");
    return;
  }

  SETTINGS.CDN_ORIGINS.forEach(preconnect);
  State.cleanLegacy();

  var labels = SETTINGS.LABELS[region.id] || SETTINGS.LABELS["en-GB"];
  var ctx = { region: region, labels: labels, row: null, ui: null, shell: null };
  BP.ctx = ctx;

  // HubSpot booking modal markup (logic attaches when Botpress loads).
  var hs = document.createElement("div");
  hs.innerHTML = HTML.hubspot;
  while (hs.firstChild) document.body.appendChild(hs.firstChild);

  ctx.ui = createSlideout(region, labels, {
    onRestart: function () {
      if (LS.getJSON(LIVE_KEY) || BP.engaged) resetToShell("restart");
    },
    onTeaser: function (text) { teaserSend(text); }
  });

  function mountShell() {
    if (ctx.shell && ctx.shell.host && ctx.shell.host.parentNode) ctx.shell.host.parentNode.removeChild(ctx.shell.host);
    var host = el("div", { id: "spotler-mia-shell" });
    ctx.ui.body.insertBefore(host, ctx.ui.body.firstChild);
    ctx.shell = createShell(host, labels, ctx.row, {
      onSend: function (text, source) { engage(text, source); },
      onOpen: function () { engage(null, "open"); }
    });
  }
  ctx.remountShell = mountShell;

  var live = State.getLive(region.id);
  if (live) {
    // Mid-conversation from an earlier page: straight to the live chat.
    resume();
  } else {
    mountShell();
  }
  ctx.ui.restore();
  startTimeoutWatch();

  loadConfig(function (cfg) {
    var row = pickRow(cfg, path, region.id);
    if (row && row.mode !== "slideout") {
      log("row asks for mode '" + row.mode + "' (not in v1): using slide-out");
    }
    ctx.row = row;
    if (ctx.shell) ctx.shell.setRow(row);
    ctx.ui.setRow(row);
  });
}

onDomReady(function () {
  try { boot(); } catch (e) { log("boot failed", e); }
});
