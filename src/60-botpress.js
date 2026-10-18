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
  convId: null,        // the conversation the webchat is on
  startSentFor: {},
  safetyTimer: null,
  observer: null
};

function bp() { return window.botpress; }

/* ---- website contract v2 (bot: src/lib/website-events.ts) ----
   Page → bot through botpress.sendEvent:
     start     once per conversation, right before the first message
     page      every later page view while the conversation is live
     leadinfo  the company, when it becomes readable after the start
     end       before the tag ends a conversation (timeout, restart)
     demoBooked  70-hubspot.js
   The bot never greets and never replies to these. */
function pageKey() { return (BP.ctx.row && BP.ctx.row.page) || "default"; }
function campaign() { return (BP.ctx.row && BP.ctx.row.campaign) || ""; }

function startEventPayload(source) {
  var ctx = BP.ctx, row = ctx.row || {}, co = leadinfoCompany();
  return {
    type: "start",
    version: 2,
    locale: ctx.region.locale,
    startPage: location.pathname,
    startUrl: location.origin + location.pathname,
    pageKey: pageKey(),
    source: source || "unknown",
    opener: String(row.opener || "").split(/\n\s*\n/)[0].slice(0, 500),
    campaign: campaign(),
    companyDomain: co ? co.domain : "",
    companyName: co ? co.name : ""
  };
}

function sendStartEvent(convId, attempt) {
  attempt = attempt || 0;
  if (!convId || BP.startSentFor[convId]) return;
  var api = bp();
  if (!api || typeof api.sendEvent !== "function") {
    if (attempt < 40) setTimeout(function () { sendStartEvent(convId, attempt + 1); }, 250);
    return;
  }
  BP.startSentFor[convId] = true;
  var payload = startEventPayload(BP.pendingSource || BP.mode);
  try {
    Promise.resolve(api.sendEvent(payload)).then(function () {
      log("start event confirmed", payload.locale, convId);
      var live = LS.getJSON(LIVE_KEY);
      if (live) {
        live.convId = convId;
        if (payload.companyDomain) live.leadinfo = payload.companyDomain;
        LS.setJSON(LIVE_KEY, live);
      }
      sendLeadinfo();   // the company may have become readable meanwhile
    }, function (err) {
      BP.startSentFor[convId] = false;
      log("start event rejected", err);
      if (attempt < 10) setTimeout(function () { sendStartEvent(convId, attempt + 1); }, 1000);
    });
  } catch (e) {
    BP.startSentFor[convId] = false;
    if (attempt < 10) setTimeout(function () { sendStartEvent(convId, attempt + 1); }, 1000);
  }
}

// The other page → bot events: fire and forget, a few retries if rejected.
function sendBotEvent(payload, retries, attempt) {
  attempt = attempt || 0;
  var api = bp();
  if (!api || typeof api.sendEvent !== "function") {
    if (attempt < 20) setTimeout(function () { sendBotEvent(payload, retries, attempt + 1); }, 250);
    return;
  }
  function retry(err) {
    log(payload.type + " event rejected", err);
    if (attempt < retries) setTimeout(function () { sendBotEvent(payload, retries, attempt + 1); }, 1000);
  }
  try {
    Promise.resolve(api.sendEvent(payload)).then(function () { log(payload.type + " event sent"); }, retry);
  } catch (e) { retry(e); }
}

function sendPageEvent() {
  sendBotEvent({ type: "page", page: location.pathname, url: location.origin + location.pathname,
                 pageKey: pageKey(), title: String(document.title || "").slice(0, 200) }, 3);
}

// Ordering guard: the bot may see the first message before the start
// event, so the user data carries what it needs to answer it.
function writeUserData() {
  var api = bp();
  if (!api || !api.updateUser) return;
  try {
    Promise.resolve(api.updateUser({ data: { locale: BP.ctx.region.locale, pageKey: pageKey(), campaign: campaign() } }))
      .then(null, function (err) { log("updateUser rejected", err); });
  } catch (e) {}
}

/* ---- Leadinfo: the company the visitor's IP belongs to ----
   GTM's Data Layer Push tag puts it in the data layer on every page; it is
   read only with Cookiebot consent for LEADINFO_CONSENT. Known at the start:
   on the start event. Readable later (consent given, or a later page): one
   leadinfo event per company per conversation. */
function leadinfoConsent() {
  if (!SETTINGS.LEADINFO_REQUIRE_CONSENT) return true;
  var cat = SETTINGS.LEADINFO_CONSENT, cb = window.Cookiebot;
  if (cb && cb.consent) return !!cb.consent[cat];
  var m = /(?:^|;\s*)CookieConsent=([^;]*)/.exec(document.cookie || "");
  return !!(m && decodeURIComponent(m[1]).indexOf(cat + ":true") !== -1);
}

function leadinfoCompany() {
  if (!leadinfoConsent()) return null;
  var dl = window.dataLayer || [];
  for (var i = dl.length - 1; i >= 0; i--) {
    var e = dl[i];
    if (e && e.event === SETTINGS.LEADINFO_EVENT && e.company_domain) {
      return { domain: trim(String(e.company_domain)).toLowerCase().slice(0, 200),
               name: e.company_name ? trim(String(e.company_name)).slice(0, 200) : "" };
    }
  }
  return null;
}

function sendLeadinfo() {
  var live = LS.getJSON(LIVE_KEY);
  // Only into a conversation the bot already has a start event for.
  if (!BP.loaded || !live || !live.convId || live.convId !== BP.convId) return;
  var co = leadinfoCompany();
  if (!co || live.leadinfo === co.domain) return;
  live.leadinfo = co.domain;
  LS.setJSON(LIVE_KEY, live);
  sendBotEvent({ type: "leadinfo", companyDomain: co.domain, companyName: co.name }, 3);
}

["CookiebotOnAccept", "CookiebotOnConsentReady"].forEach(function (ev) {
  window.addEventListener(ev, function () { setTimeout(sendLeadinfo, 0); });
});

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

function attachBotpressListeners() {
  var api = bp();

  api.on("webchat:initialized", function () {
    if (BP.mode !== "resume") writeUserData();
  });

  api.on("conversation", function (convId) {
    if (!convId) return;
    BP.convId = convId;
    var live = LS.getJSON(LIVE_KEY);
    var known = live && live.convId === convId;
    if (known && BP.mode === "resume") {
      log("resumed", convId);
      sendPageEvent();
      sendLeadinfo();
      return;
    }
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
      // Every listener first: init fires webchat:initialized and the
      // conversation events, and a listener added later misses them.
      attachBotpressListeners();
      initHubSpot();
      initWebchat(api);
      return;
    }
    if (tries < 300) setTimeout(function () { waitForApi(tries + 1); }, 100);
    else log("Botpress SDK never became available");
  })(0);
}

/* ---- botpress.init: the tag starts the webchat itself ----
   No bot config script (Botpress's "Share" script calls init without an
   embed target, so the webchat would render as the floating button).
   inject.js v3.7 embeds when a version "v2" configuration's embeddedChatId
   names an element id; `selector` is passed too but v3.7 does not read it.
   Server-side webchat settings don't reach a direct init (allowedOrigins
   is still enforced by the server). botpress.init is
   read-only in v3.7, so it can't be wrapped: our labels go in here. */
function initWebchat(api) {
  var L = BP.ctx.labels;
  try {
    Promise.resolve(api.init({
      botId: SETTINGS.BOT_ID,
      clientId: SETTINGS.CLIENT_ID,
      selector: "#bp-embedded-webchat",
      configuration: {
        // Without version "v2" inject.js parses this as a legacy v0 config:
        // it drops embeddedChatId (floating button), history and more.
        version: "v2",
        embeddedChatId: "bp-embedded-webchat",
        botName: L.botName,
        botDescription: L.botTagline,
        botAvatar: SETTINGS.AVATAR_URL,
        composerPlaceholder: L.placeholder,
        footer: footerMarkdown(L),
        storageLocation: "localStorage",
        proactiveMessageEnabled: false,
        conversationHistory: true,
        // The static shell's look (40-shell.css): navy, Inter, 24px bubbles
        // (Botpress bubble radius = 6px × radius, so 4).
        color: "#002A4D",
        themeMode: "light",
        variant: "solid",
        headerVariant: "solid",
        radius: 4,
        fontFamily: "inter"
      }
    })).then(null, function (err) { log("botpress.init failed", err); });
  } catch (e) { log("botpress.init failed", e); }
}

/* ---- Botpress's own text: our labels, in the visitor's language ----
   init carries our description, placeholder and the "AI assistant ·
   Privacy" footer. The shadow-DOM pass swaps what Botpress doesn't let
   us set ("Delivered"), hides the "Today" date line (the preview has
   none either), and still covers the English bot texts in BOT_TEXT. */
var LOCAL_KEYS = ["delivered", "botTagline", "placeholder"];

function localMap() {
  var L = BP.ctx.labels, B = SETTINGS.BOT_TEXT, map = {};
  for (var i = 0; i < LOCAL_KEYS.length; i++) {
    var k = LOCAL_KEYS[i];
    if (L[k] && B[k] && L[k] !== B[k]) map[B[k]] = L[k];
  }
  if (map[B.placeholder]) map[B.placeholder.replace(/\.+$/, "")] = L.placeholder;
  return map;
}

function localiseWebchat(sr) {
  var map = localMap(), L = BP.ctx.labels, B = SETTINGS.BOT_TEXT, queued = false;
  function swapText(n) {
    var v = n.nodeValue, t = trim(v);
    if (!t) return;
    if (map.hasOwnProperty(t)) n.nodeValue = v.replace(t, map[t]);
    else if (isToday(t)) hideDateLine(n, t);
    else if (t === B.footer && n.parentNode) {
      // the bot's own footer (init not wrapped): put our note in its place
      var at = n.parentNode.tagName === "A" ? n.parentNode : n;
      at.parentNode.replaceChild(footerNote(L), at);
    }
  }
  function isToday(t) {
    var words = [B.today, L.today];
    for (var i = 0; i < words.length; i++) if (words[i] && (t === words[i] || t.indexOf(words[i] + " ") === 0)) return true;
    return false;
  }
  // The date separator, never a word inside a message: hide the largest
  // wrapper that holds nothing but this date (its lines go with it).
  function hideDateLine(n, t) {
    var e = n.parentNode;
    if (!e || e.nodeType !== 1 || (e.closest && e.closest(".bpMessageContainer"))) return;
    while (e.parentNode && e.parentNode.nodeType === 1 && e.parentNode !== sr && trim(e.parentNode.textContent) === t) e = e.parentNode;
    e.style.display = "none";
  }
  function run() {
    queued = false;
    var w = document.createTreeWalker(sr, NodeFilter.SHOW_TEXT, null, false), n, all = [];
    while ((n = w.nextNode())) all.push(n);
    for (var j = 0; j < all.length; j++) swapText(all[j]);
    var ph = sr.querySelectorAll("[placeholder]");
    for (var i = 0; i < ph.length; i++) {
      var p = trim(ph[i].getAttribute("placeholder"));
      if (map.hasOwnProperty(p)) ph[i].setAttribute("placeholder", map[p]);
    }
  }
  new MutationObserver(function () { if (!queued) { queued = true; setTimeout(run, 0); } })
    .observe(sr, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["placeholder"] });
  run();
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
    localiseWebchat(sr);
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
  writeUserData();
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
    sendAsUser(text);
    return;
  }
  engage(text, "teaser");
}

// Restart button and timeout: end the conversation, bring the shell back.
// The bot hears it first (end event), so its end handler runs at once; a
// closed tab sends nothing and the bot's own 15-minute expiry covers it.
function resetToShell(reason) {
  var live = LS.getJSON(LIVE_KEY);
  if ((reason === "timeout" || reason === "restart") && BP.loaded && live && live.convId) {
    sendBotEvent({ type: "end", reason: reason }, 0);
  }
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
    if (live) sendLeadinfo();
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
