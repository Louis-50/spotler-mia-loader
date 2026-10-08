/* ==================================================================
   50 · Slide-out mode: panel, pill, teaser, page squeeze
   Behaviour matches the live slide-out tags: open on first visit,
   remember open/dismissed for the session, teaser bubble 4 s after the
   pill shows (once per page per session).
   ================================================================== */
function createSlideout(region, labels, handlers) {
  addStyle(CSS.slideout);
  var rootStyle = document.documentElement.style;

  var title = el("span", { id: "spotler-agent-title", text: labels.title });
  var restartBtn = el("button", { id: "spotler-agent-restart", type: "button", "aria-label": labels.restart, title: labels.restart });
  restartBtn.innerHTML = "&#8635;";
  var closeBtn = el("button", { id: "spotler-agent-close", type: "button", "aria-label": labels.close, title: labels.close });
  closeBtn.innerHTML = "&#10005;";
  var body = el("div", { id: "spotler-agent-body" });
  var loading = el("div", { id: "spotler-agent-loading", "aria-hidden": "true" }, [el("span")]);
  var webchat = el("div", { id: "bp-embedded-webchat" });
  body.appendChild(loading);
  body.appendChild(webchat);

  var panel = el("div", { id: "spotler-agent-panel", "aria-label": labels.title }, [
    el("div", { id: "spotler-agent-header" }, [
      title,
      el("span", { id: "spotler-agent-header-actions" }, [restartBtn, closeBtn])
    ]),
    body
  ]);

  var pill = el("button", { id: "spotler-agent-pill", type: "button" });
  pill.appendChild(el("span", { "class": "pill-spark", "aria-hidden": "true" }));
  pill.firstChild.innerHTML = "&#10022;";
  pill.appendChild(document.createTextNode(" " + labels.pill));

  var teaserText = el("span", { id: "spotler-agent-teaser-text" });
  var teaserClose = el("button", { id: "spotler-agent-teaser-close", type: "button", "aria-label": "Dismiss" });
  teaserClose.innerHTML = "&#10005;";
  var teaser = el("div", { id: "spotler-agent-teaser", role: "status" }, [teaserClose, teaserText]);
  teaser.hidden = true;
  if (region.id === "nl") teaser.className = "nl";

  document.body.appendChild(panel);
  document.body.appendChild(teaser);
  document.body.appendChild(pill);

  /* ---- sizing ---- */
  function syncPanelWidth() {
    var w = window.innerWidth >= 1600 ? SETTINGS.PANEL_WIDTH_WIDE : SETTINGS.PANEL_WIDTH;
    rootStyle.setProperty("--spotler-agent-w", w + "px");
  }
  function syncBannerHeight() {
    var bar = document.querySelector(".top-header-container");
    if (bar) {
      var h = bar.offsetHeight;
      if (h >= 24 && h <= 64) rootStyle.setProperty("--spotler-banner-h", h + "px");
    }
    var link = document.querySelector(".top-header-container a");
    if (link) {
      var cs = getComputedStyle(link);
      title.style.fontSize = cs.fontSize;
      title.style.fontWeight = cs.fontWeight;
      title.style.fontFamily = cs.fontFamily;
    }
  }
  rootStyle.setProperty("--spotler-banner-h", SETTINGS.DEFAULT_BANNER_PX + "px");
  syncPanelWidth();
  syncBannerHeight();
  var rt;
  window.addEventListener("resize", function () {
    syncPanelWidth();
    clearTimeout(rt); rt = setTimeout(syncBannerHeight, 150);
  });
  window.addEventListener("load", syncBannerHeight);
  setTimeout(syncBannerHeight, 1500);

  function isDesktop() { return window.innerWidth >= SETTINGS.DESKTOP_MIN_WIDTH; }

  /* ---- open / close ---- */
  function open(instant) {
    if (instant) {
      panel.classList.add("no-anim");
      requestAnimationFrame(function () { requestAnimationFrame(function () { panel.classList.remove("no-anim"); }); });
    }
    panel.classList.add("open");
    document.body.classList.add("agent-panel-open");
    pill.style.display = "none";
    hideTeaser(false);
    SS.set(PANEL_STATE_KEY, "open");
    syncBannerHeight();
    if (handlers.onOpen) handlers.onOpen();
  }
  function close() {
    panel.classList.remove("open");
    document.body.classList.remove("agent-panel-open");
    SS.set(PANEL_STATE_KEY, "dismissed");
    if (isDesktop()) { pill.style.display = "flex"; scheduleTeaser(); }
  }

  /* ---- teaser ---- */
  var teaserRow = null, teaserTimer, teaserHideTimer;
  function teased() { return SS.getJSON(TEASED_KEY) || []; }
  function markTeased() {
    var list = teased();
    if (list.indexOf(location.pathname) === -1) { list.push(location.pathname); SS.setJSON(TEASED_KEY, list); }
  }
  function hideTeaser(markSeen) {
    teaser.hidden = true;
    clearTimeout(teaserTimer); clearTimeout(teaserHideTimer);
    if (markSeen) markTeased();
  }
  function scheduleTeaser() {
    if (!isDesktop() || !teaserRow || !teaserRow.teaser_text) return;
    if (teased().indexOf(location.pathname) !== -1) return;
    clearTimeout(teaserTimer);
    teaserTimer = setTimeout(function () {
      if (panel.classList.contains("open")) return;
      teaserText.textContent = teaserRow.teaser_text;
      teaser.hidden = false;
      markTeased();
      teaserHideTimer = setTimeout(function () { hideTeaser(false); }, SETTINGS.TEASER_HIDE_MS);
    }, SETTINGS.TEASER_DELAY_MS);
  }
  teaser.addEventListener("click", function (e) {
    if (e.target === teaserClose) return;
    hideTeaser(true);
    open(false);
    if (handlers.onTeaser && teaserRow) handlers.onTeaser(teaserRow.teaser_send || teaserRow.teaser_text);
  });
  teaserClose.addEventListener("click", function () { hideTeaser(true); });

  pill.addEventListener("click", function () { open(false); });
  closeBtn.addEventListener("click", close);
  restartBtn.addEventListener("click", function () { if (handlers.onRestart) handlers.onRestart(); });

  demoteWhatsApp();

  return {
    body: body,
    webchat: webchat,
    loading: loading,
    open: open,
    close: close,
    isOpen: function () { return panel.classList.contains("open"); },
    setRow: function (row) {
      teaserRow = row;
      if (!panel.classList.contains("open") && pill.style.display === "flex") scheduleTeaser();
    },
    // Restore the session's open/dismissed state (first visit: open at once).
    restore: function () {
      if (!isDesktop()) return;
      var st = SS.get(PANEL_STATE_KEY);
      if (st === "dismissed") { pill.style.display = "flex"; scheduleTeaser(); }
      else open(true);
    }
  };
}

// Keep any WhatsApp widget below the panel (ported from the live tags).
function demoteWhatsApp() {
  var WHATSAPP_Z = "2147482000";
  function findFixedRoot(node) {
    var fixed = null;
    while (node && node !== document.body && node.nodeType === 1) {
      var pos = window.getComputedStyle(node).position;
      if (pos === "fixed" || pos === "sticky" || pos === "absolute") fixed = node;
      node = node.parentElement;
    }
    return fixed;
  }
  function demote() {
    var found = document.querySelectorAll(
      'a[href*="wa.me"], a[href*="api.whatsapp.com"], a[href*="web.whatsapp.com"],' +
      '[class*="whatsapp" i], [id*="whatsapp" i], [class*="joinchat" i], [id*="joinchat" i]'
    );
    Array.prototype.forEach.call(found, function (node) {
      if (node.closest("#spotler-agent-panel, #spotler-agent-teaser, #spotler-agent-pill, #hubspot-modal, .bpWebchat, .bpFab, #fab-root, #chatinterface")) return;
      (findFixedRoot(node) || node).style.setProperty("z-index", WHATSAPP_Z, "important");
    });
  }
  window.addEventListener("load", demote);
  [1000, 2500, 5000, 8000].forEach(function (t) { setTimeout(demote, t); });
}
