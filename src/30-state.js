/* ==================================================================
   30 · Conversation state
   One live conversation per visitor, shared by all tabs (Botpress keeps
   its conversation id in localStorage too). A conversation is "live"
   from the visitor's first message until TIMEOUT_MS without activity,
   a Restart, or a region change. Ending it clears ONLY the Botpress
   conversation id (the Botpress user is kept) and our own chat keys.
   ================================================================== */
var LIVE_KEY = "spotler_mia_live";      // {region, startedAt, lastActivity, startPage}
var PANEL_STATE_KEY = "spotlerAgentState"; // 'open' | 'dismissed' (same key as the old tags)
var TEASED_KEY = "spotlerTeaserPages";

/* ---- consent (Cookiebot) ----
   Before a chat starts the tag only keeps convenience state: the saved
   page table, panel open/closed, pages already teased. With Cookiebot on
   the page that needs "preferences" consent; without it the state lives
   in memory for this page only. Starting a chat is the visitor asking for
   the service, so from then on the chat's own state is kept. */
var Consent = {
  ok: function () {
    var cb = window.Cookiebot;
    if (cb && cb.consent) return !!cb.consent.preferences;
    var m = /(?:^|;\s*)CookieConsent=([^;]*)/.exec(document.cookie || "");
    if (m) return /preferences:true/.test(decodeURIComponent(m[1]));
    return true;                      // no consent tool on this page
  },
  chatting: function () { return !!(LS.get(LIVE_KEY) || (typeof BP !== "undefined" && BP.engaged)); },
  // Consent refused (or withdrawn): drop what was kept before it was known.
  purge: function () {
    if (Consent.ok()) return;
    LS.del(CONFIG_CACHE_KEY);
    SS.del(TEASED_KEY);
    if (!Consent.chatting()) SS.del(PANEL_STATE_KEY);
    log("no preferences consent: pre-chat storage cleared");
  }
};
["CookiebotOnDecline", "CookiebotOnConsentReady", "CookiebotOnAccept"].forEach(function (ev) {
  window.addEventListener(ev, function () { Consent.purge(); });
});

// Pre-chat session state: sessionStorage with consent (or once chatting), else memory.
var PS = (function () {
  var mem = {};
  function stored() { return Consent.ok() || Consent.chatting(); }
  return {
    get: function (k) { return stored() ? SS.get(k) : (mem.hasOwnProperty(k) ? mem[k] : null); },
    set: function (k, v) { if (stored()) SS.set(k, v); else mem[k] = String(v); },
    getJSON: function (k) { try { return JSON.parse(this.get(k)); } catch (e) { return null; } },
    setJSON: function (k, v) { this.set(k, JSON.stringify(v)); }
  };
})();

var State = {
  getLive: function (regionId) {
    var live = LS.getJSON(LIVE_KEY);
    if (!live || !live.lastActivity) return null;
    if (now() - live.lastActivity > SETTINGS.TIMEOUT_MS) { State.end("timeout"); return null; }
    if (regionId && live.region !== regionId) { State.end("region change"); return null; }
    return live;
  },

  start: function (regionId, row) {
    var live = { region: regionId, startedAt: now(), lastActivity: now(),
                 startPage: location.pathname, page: row && row.page || "" };
    LS.setJSON(LIVE_KEY, live);
    return live;
  },

  touch: function () {
    var live = LS.getJSON(LIVE_KEY);
    if (!live) return;
    live.lastActivity = now();
    LS.setJSON(LIVE_KEY, live);
  },

  isExpired: function () {
    var live = LS.getJSON(LIVE_KEY);
    return !!(live && now() - live.lastActivity > SETTINGS.TIMEOUT_MS);
  },

  end: function (reason) {
    log("conversation ended: " + reason);
    LS.del(LIVE_KEY);
    State.forgetBotpressConversation();
    ["spotler_last_conversation_id", "spotler_lang_sent_convs", "spotler_calendar_contact"].forEach(SS.del);
    pushDataLayer({ event: "spotler_mia_end", miaEndReason: reason });
  },

  // Botpress v3.7 stores {state:{conversationId, user:{userId,userToken}}}
  // under bp-webchat-<clientId>-client. Drop the conversation, keep the user.
  forgetBotpressConversation: function () {
    LS.keys().forEach(function (k) {
      if (/^bp-webchat-.*-client$/.test(k)) {
        var v = LS.getJSON(k);
        if (v && v.state && v.state.conversationId) {
          delete v.state.conversationId;
          LS.setJSON(k, v);
        }
      } else if (/^bp-webchat-message-history-conv_/.test(k)) {
        LS.del(k);
      }
    });
    SS.keys().forEach(function (k) {
      if (/^bp-webchat-composer-files-conv_/.test(k)) SS.del(k);
    });
  },

  // Old tags' keys that would confuse the new flow.
  cleanLegacy: function () {
    ["spotler_chat_region", "spotler_region_switched", "spotler_chat_last_activity"].forEach(LS.del);
    ["spotler_lang_bootstrapped"].forEach(SS.del);
  }
};
