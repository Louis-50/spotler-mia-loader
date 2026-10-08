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
