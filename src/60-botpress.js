/* ==================================================================
   60 · Botpress: lazy load, handover, fade, timeout, restart
   Nothing in here runs until the visitor engages (or already has a
   live conversation). Modes:
     "new"    first message pending: skip greeting, send it, fade when it
              shows in the live chat
     "resume" live conversation from an earlier page: load and reveal
     "open"   mic clicked with nothing typed: load and reveal
   ================================================================== */
var BP = {
  loaded: false,       // inject.js requested
  ready: false,        // webchat:ready fired
  revealed: false,
  pending: null,       // {text, source} waiting for a conversation
  awaitingConv: false, // a restart is in flight: ignore the old conversation
  mode: null,
  ctx: null,           // {region, labels, row, ui, shell, remountShell}
  langSentFor: {},
  safetyTimer: null,
  observer: null
};

function bp() { return window.botpress; }

/* ---- the event Botpress already reads ({type:"language", ...}) ----
   New fields are additive; page/route are only sent for rows that set a
   route, so the Studio gates for the campaign routes behave as today. */
function startEventPayload(source) {
  var ctx = BP.ctx, row = ctx.row || {};
  var p = {
    type: "language",
    language: ctx.region.language,
    region: ctx.region.id,
    startPage: location.pathname,
    startUrl: location.origin + location.pathname,
    pageKey: row.page || "default",
    source: source || "unknown",
    opener: String(row.opener || "").split(/\n\s*\n/)[0].slice(0, 500)
  };
  if (row.route) { p.page = row.page || ""; p.route = row.route; }
  return p;
}

function sendStartEvent(convId, attempt) {
  attempt = attempt || 0;
  if (!convId || BP.langSentFor[convId]) return;
  var api = bp();
  if (!api || typeof api.sendEvent !== "function") {
    if (attempt < 40) setTimeout(function () { sendStartEvent(convId, attempt + 1); }, 250);
    return;
  }
  BP.langSentFor[convId] = true;
  var payload = startEventPayload(BP.pendingSource || BP.mode);
  try {
    Promise.resolve(api.sendEvent(payload)).then(function () {
      log("start event confirmed", payload.language, convId);
      var live = LS.getJSON(LIVE_KEY);
      if (live) { live.convId = convId; LS.setJSON(LIVE_KEY, live); }
    }, function (err) {
      BP.langSentFor[convId] = false;
      log("start event rejected", err);
      if (attempt < 10) setTimeout(function () { sendStartEvent(convId, attempt + 1); }, 1000);
    });
  } catch (e) {
    BP.langSentFor[convId] = false;
    if (attempt < 10) setTimeout(function () { sendStartEvent(convId, attempt + 1); }, 1000);
  }
}

// Trust sendMessage's promise; retry only if the API is missing or rejects
// (same rule as the live tags, so a message is never sent twice).
function sendAsUser(text, attempt) {
  attempt = attempt || 0;
  var api = bp();
  if (!api || typeof api.sendMessage !== "function") {
    if (attempt < 20) setTimeout(function () { sendAsUser(text, attempt + 1); }, 250);
    return;
  }
  try {
    Promise.resolve(api.sendMessage(text)).then(function () {
      State.touch();
      log("first message sent");
    }, function (err) {
      log("sendMessage rejected", err);
      if (attempt < 5) setTimeout(function () { sendAsUser(text, attempt + 1); }, 1000);
    });
  } catch (e) {
    if (attempt < 5) setTimeout(function () { sendAsUser(text, attempt + 1); }, 1000);
  }
}

function flushPending() {
  if (!BP.pending) return;
  var text = BP.pending.text;
  BP.pending = null;
  BP.sentText = text;
  sendAsUser(text);
}

// Skip-greeting gate in Studio reads proactiveClickAt (fresh = skip).
function markProactive(text) {
  var api = bp();
  if (api && api.updateUser) {
    try { api.updateUser({ data: { proactiveClickAt: String(now()), proactiveTopic: String(text || "") } }); } catch (e) {}
  }
}

function attachBotpressListeners() {
  var api = bp();

  api.on("webchat:initialized", function () {
    if (BP.pending) markProactive(BP.pending.text);
    else if (api.updateUser) {
      try { api.updateUser({ data: { proactiveClickAt: "0", proactiveTopic: "" } }); } catch (e) {}
    }
  });

  api.on("conversation", function (convId) {
    if (!convId) return;
    var live = LS.getJSON(LIVE_KEY);
    var known = live && live.convId === convId;
    if (known && BP.mode === "resume") { log("resumed", convId); return; }
    if (BP.awaitingConv && convId === BP.prevConvId) return; // old one, restart pending
    BP.awaitingConv = false;
    SS.del("spotler_calendar_contact");
    SS.set("spotler_last_conversation_id", convId);
    log("conversation", convId);
    setTimeout(function () {
      sendStartEvent(convId);
      flushPending();
      if (BP.mode === "open" && BP.ready && !BP.revealed) setTimeout(reveal, 500);
    }, 300);
  });

  api.on("message", function () { State.touch(); });

  api.on("webchat:ready", function () {
    BP.ready = true;
    pushDataLayer({ event: "spotler_mia_ready" });
    if (BP.mode !== "new") {
      // Plain timer, not requestAnimationFrame: rAF never fires in a tab
      // opened in the background, which left the panel on its spinner.
      setTimeout(reveal, 800);
    }
    // Fallback: no conversation event within FORCE_SEND_MS of ready.
    setTimeout(function () {
      if (BP.pending) { log("no conversation event, force-sending"); flushPending(); }
    }, SETTINGS.FORCE_SEND_MS);
    watchForUserMessage();
  });
}

function loadBotpress(mode) {
  BP.mode = mode;
  if (BP.loaded) return;
  BP.loaded = true;
  log("loading Botpress (" + mode + ")");
  if (mode !== "resume") State.forgetBotpressConversation();

  loadScript(SETTINGS.INJECT_URL, function () { log("inject.js failed to load"); });
  (function waitForApi(tries) {
    var api = bp();
    if (api && typeof api.on === "function") {
      attachBotpressListeners();
      initHubSpot();
      loadScript(SETTINGS.BOT_CONFIG_URL, function () { log("bot config failed to load"); });
      return;
    }
    if (tries < 300) setTimeout(function () { waitForApi(tries + 1); }, 100);
    else log("Botpress SDK never became available");
  })(0);
}

/* ---- fade: reveal once the visitor's message shows in the live chat ---- */
function webchatShadow() {
  var host = document.querySelector("#bp-embedded-webchat #webchat-root, #bp-embedded-webchat .bpEmbeddedWebchat");
  return host && host.shadowRoot;
}

function watchForUserMessage() {
  if (BP.observer) return;
  var tries = 0;
  (function attach() {
    var sr = webchatShadow();
    if (!sr) { if (++tries < 100) setTimeout(attach, 100); return; }
    BP.checkForUserMessage = check;
    if (BP.ctx.ui.videoWidth) sizeVideos(sr, BP.ctx.ui.videoWidth);
    // Swap only once the bot's reply is in: mirror it into the shell,
    // let it slide in there, then cross-fade to the identical live chat.
    function check() {
      if (BP.mode !== "new" || BP.revealed || BP.mirroring || BP.awaitingConv || BP.pending || !BP.sentText) return;
      var want = trim(BP.sentText);
      var all = sr.querySelectorAll(".bpMessageContainer");
      var mine = -1;
      for (var i = all.length - 1; i >= 0; i--) {
        if (all[i].getAttribute("data-direction") === "outgoing" && trim(all[i].textContent).indexOf(want) !== -1) { mine = i; break; }
      }
      if (mine === -1) return;
      var replies = [];
      for (var j = mine + 1; j < all.length; j++) {
        if (all[j].getAttribute("data-direction") === "incoming") replies.push(all[j]);
      }
      if (!replies.length) return;
      BP.mirroring = true;
      // Give a multi-part reply a moment to land, then mirror what's there.
      setTimeout(function () {
        var items = [], rich = false;
        var nodes = sr.querySelectorAll(".bpMessageContainer");
        var started = false;
        for (var k = 0; k < nodes.length; k++) {
          var n = nodes[k];
          if (!started) { if (n === all[mine]) started = true; continue; }
          if (n.getAttribute("data-direction") !== "incoming") continue;
          if (n.querySelector("video, iframe, img:not(.bpMessageAvatarImage), .bpMessageBlocksCarousel, .bpMessageBlocksCard")) { rich = true; break; }
          var texts = [];
          var bubbles = n.querySelectorAll(".bpMessageBlocksBubble");
          for (var b = 0; b < bubbles.length; b++) { var tx = textOf(bubbles[b]); if (tx) texts.push(tx); }
          var btns = [];
          var bl = n.querySelectorAll(".bpMessageBlocksButton");
          for (var c = 0; c < bl.length; c++) btns.push(textOf(bl[c]));
          if (texts.length || btns.length) items.push({ texts: texts, buttons: btns });
        }
        if (!rich && items.length && BP.ctx.shell && BP.ctx.shell.showReply) {
          BP.ctx.shell.showReply(items);
          setTimeout(reveal, 450);   // after the bubble's own slide-in
        } else {
          reveal();                   // media in the reply: plain cross-fade
        }
      }, 350);
    }
    BP.observer = new MutationObserver(check);
    BP.observer.observe(sr, { childList: true, subtree: true });
    check();
  })();
}

function reveal() {
  if (BP.revealed) return;
  BP.revealed = true;
  clearTimeout(BP.safetyTimer);
  var ui = BP.ctx.ui;
  ui.webchat.classList.add("bp-ready");
  ui.loading.classList.remove("on");
  document.documentElement.classList.add("bp-chat-ready");
  var shellHost = BP.ctx.shell && BP.ctx.shell.host;
  if (shellHost) {
    shellHost.classList.add("mia-out");
    setTimeout(function () { shellHost.classList.add("mia-gone"); }, 300);
  }
  log("revealed live chat");
}

/* ---- entry points used by main ---- */
function engage(text, source) {
  var ctx = BP.ctx;
  if (BP.engaged) return;
  BP.engaged = true;
  ctx.shell.lock();
  if (text) {
    ctx.shell.collapseOpener();
    ctx.shell.showUser(text);
    setTimeout(function () { if (!BP.revealed && !BP.mirroring) ctx.shell.showTyping(); }, 900);
  }
  State.start(ctx.region.id, ctx.row);
  pushDataLayer({ event: "spotler_mia_start", miaSource: source, miaRegion: ctx.region.id,
                  miaPage: (ctx.row && ctx.row.page) || "default" });
  BP.pendingSource = source;
  BP.safetyTimer = setTimeout(reveal, SETTINGS.SAFETY_REVEAL_MS);

  BP.sentText = null;
  BP.mirroring = false;
  BP.pending = text ? { text: text, source: source } : null;

  if (!BP.loaded) { loadBotpress(text ? "new" : "open"); return; }

  // Botpress already on the page (after a timeout/restart): new conversation.
  BP.mode = text ? "new" : "open";
  BP.awaitingConv = true;
  BP.prevConvId = SS.get("spotler_last_conversation_id");
  if (text) markProactive(text);
  watchForUserMessage();
  try {
    Promise.resolve(bp().restartConversation()).catch(function (err) { log("restart failed", err); BP.awaitingConv = false; });
  } catch (e) { BP.awaitingConv = false; }
}

function resume() {
  BP.ctx.ui.loading.classList.add("on");
  loadBotpress("resume");
}

// Teaser click: live chat → send straight in; otherwise start one.
function teaserSend(text) {
  if (BP.loaded && BP.revealed && LS.getJSON(LIVE_KEY)) {
    markProactive(text);
    sendAsUser(text);
    return;
  }
  engage(text, "teaser");
}

// Restart button and timeout: end the conversation, bring the shell back.
function resetToShell(reason) {
  State.end(reason);
  BP.engaged = false;
  BP.pending = null;
  if (BP.revealed || BP.loaded) {
    BP.revealed = false;
    BP.ctx.ui.webchat.classList.remove("bp-ready");
    document.documentElement.classList.remove("bp-chat-ready");
  }
  BP.ctx.ui.loading.classList.remove("on");
  BP.ctx.remountShell();
}

function startTimeoutWatch() {
  function check() {
    var live = LS.getJSON(LIVE_KEY);
    if (live && now() - live.lastActivity > SETTINGS.TIMEOUT_MS) { resetToShell("timeout"); return; }
    // Ended in another tab (timeout/restart there) while this one shows the live chat.
    if (!live && BP.revealed) resetToShell("ended in another tab");
  }
  setInterval(check, SETTINGS.TIMEOUT_CHECK_MS);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) check(); });
}

/* Embedded cards: Botpress videos sit in nested shadow roots CSS can't
   reach, so size them inline. Runs on chat changes only (the live
   campaign tags polled every 700 ms forever). */
function sizeVideos(sr, width) {
  function sweep(root) {
    try {
      var media = root.querySelectorAll("video, iframe");
      for (var i = 0; i < media.length; i++) {
        var m = media[i];
        var src = m.getAttribute("src") || "";
        if (m.__miaSized || (m.tagName === "IFRAME" && !/vimeo|youtube/.test(src))) continue;
        m.__miaSized = true;
        m.style.setProperty("width", width + "px", "important");
        m.style.setProperty("max-width", "100%", "important");
        m.style.setProperty("height", "auto", "important");
        m.style.setProperty("border-radius", "12px", "important");
      }
      var all = root.querySelectorAll("*");
      for (var j = 0; j < all.length; j++) if (all[j].shadowRoot) sweep(all[j].shadowRoot);
    } catch (e) {}
  }
  var t;
  new MutationObserver(function () { clearTimeout(t); t = setTimeout(function () { sweep(sr); }, 100); })
    .observe(sr, { childList: true, subtree: true });
  sweep(sr);
}

// Text of a (hidden) live-chat element with its line breaks. innerText
// can't be used: the live chat is visibility:hidden until the swap.
function textOf(node) {
  var out = "";
  (function walk(n) {
    for (var c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) { out += c.nodeValue; continue; }
      if (c.nodeType !== 1) continue;
      if (c.tagName === "BR") { out += "\n"; continue; }
      var block = /^(P|DIV|LI|UL|OL|H[1-6]|PRE|BLOCKQUOTE)$/.test(c.tagName);
      if (block && out && !/\n$/.test(out)) out += "\n";
      if (c.tagName === "LI") out += "• ";
      walk(c);
      if (block && !/\n$/.test(out)) out += "\n";
    }
  })(node);
  return trim(out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n"));
}
