/* ==================================================================
   90 · Boot
   The page's config row decides the mode:
     slideout  desktop only (1200px+, no phone/tablet)
     half      desktop and laptop (HALF_MIN_WIDTH+, no phone/tablet)
     full      every device: the only mode on mobile
   A mode the device can't show means no chat on that page.
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

function modeAllowed(mode) {
  var touch = isMobileOrTabletUA(), w = window.innerWidth;
  if (mode === "full") return true;
  if (mode === "half") return !touch && w >= SETTINGS.HALF_MIN_WIDTH;
  return !touch && w >= SETTINGS.DESKTOP_MIN_WIDTH;
}

function boot() {
  if (window.__spotlerMiaStarted) return;          // GTM can fire a tag twice
  window.__spotlerMiaStarted = SETTINGS.VERSION;

  var path = location.pathname;
  if (isLegacyExcluded(path)) { log("off: page still on a legacy tag"); return; }
  if (document.getElementById("bp-embedded-webchat")) { log("off: another Botpress tag already runs on this page"); return; }

  var region = detectRegion(path);
  if (region.id === "none") { log("off: no chat for this locale"); return; }
  SETTINGS.CDN_ORIGINS.forEach(preconnect);

  var labels = SETTINGS.LABELS[region.id] || SETTINGS.LABELS["en-GB"];
  var ctx = { region: region, labels: labels, row: null, ui: null, shell: null };
  BP.ctx = ctx;

  // Cached config answers at once; a first visit waits for the file
  // (CONFIG_WAIT_MS at most) so the right mode is chosen before painting.
  var started = false;
  // The region switch lives in config.json (enabledRegions), so a region
  // can be turned on or off without a GTM publish.
  loadConfig(function (cfg, source) {
    if (started) return;
    var enabled = (cfg && cfg.enabledRegions) || SETTINGS.ENABLED_REGIONS;
    if (enabled.indexOf(region.id) === -1) {
      if (source === "cache") { log("cached config has region " + region.id + " off, checking the live copy"); return false; }
      started = true;
      log("off: region " + region.id + " not enabled");
      return;
    }
    started = true;
    State.cleanLegacy();
    start(pickRow(cfg, path, region.id));
  });

  function start(row) {
    var mode = row.mode || "slideout";
    if (!modeAllowed(mode)) { log("off: mode '" + mode + "' not shown on this device"); return; }
    ctx.row = row;
    log("mode " + mode + ", page " + (row.page || "default"));

    addStyle(CSS.common);
    var hs = document.createElement("div");
    hs.innerHTML = HTML.hubspot;
    while (hs.firstChild) document.body.appendChild(hs.firstChild);

    var handlers = {
      onRestart: function () { if (LS.getJSON(LIVE_KEY) || BP.engaged) resetToShell("restart"); },
      onTeaser: function (text) { teaserSend(text); }
    };

    function slideout() {
      ctx.ui = createSlideout(region, labels, handlers);
      begin();
      ctx.ui.restore();
      ctx.ui.setRow(row);
    }
    if (mode === "slideout") slideout();
    else createEmbedded(mode, row, labels, handlers, function (ui) { ctx.ui = ui; begin(); }, function () {
      // The page has nowhere to put the card: the slide-out still offers the chat.
      if (modeAllowed("slideout")) slideout();
    });
  }

  function mountShell() {
    if (ctx.shell && ctx.shell.host && ctx.shell.host.parentNode) ctx.shell.host.parentNode.removeChild(ctx.shell.host);
    var host = el("div", { id: "spotler-mia-shell" });
    if (ctx.ui.videoWidth) host.style.setProperty("--mia-video-w", ctx.ui.videoWidth + "px");
    ctx.ui.body.insertBefore(host, ctx.ui.body.firstChild);
    ctx.shell = createShell(host, labels, ctx.row, {
      onSend: function (text, source) { engage(text, source); },
      onOpen: function () { engage(null, "open"); }
    });
  }
  ctx.remountShell = mountShell;

  // One live conversation per visitor, shown in whatever container this
  // page uses: resume it, or show the static shell.
  function begin() {
    if (State.getLive(region.id)) resume();
    else mountShell();
    startTimeoutWatch();
  }
}

onDomReady(function () {
  try { boot(); } catch (e) { log("boot failed", e); }
});
