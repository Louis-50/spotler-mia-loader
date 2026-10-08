// Minimal stand-in for Botpress webchat v3.7 inject.js (tests only).
(function () {
  var handlers = {};
  var log = window.__bpLog = [];
  function emit(name, arg) { (handlers[name] || []).forEach(function (fn) { try { fn(arg); } catch (e) { console.error(e); } }); }
  function clientKey() { return "bp-webchat-test-client-client"; }
  var root, list;
  function addMsg(dir, text) {
    var m = document.createElement("div");
    m.className = "bpReset bpMessageContainer";
    m.setAttribute("data-direction", dir);
    m.innerHTML = '<div class="bpMessageBlocksBubble"><p class="bpMessageBlocksTextText"></p></div>';
    m.querySelector("p").textContent = text;
    list.appendChild(m);
  }
  function newConv() { return "conv_" + Math.random().toString(36).slice(2, 10); }
  var convId = null;
  window.botpress = {
    on: function (n, fn) { (handlers[n] = handlers[n] || []).push(fn); },
    init: function () {
      log.push(["init"]);
      var host = document.querySelector("#bp-embedded-webchat");
      root = document.createElement("div"); root.id = "webchat-root"; root.className = "bpEmbeddedWebchat";
      host.appendChild(root);
      var sr = root.attachShadow({ mode: "open" });
      sr.innerHTML = '<div class="bpContainer" style="height:100%;background:#fdfdfd;font:14px sans-serif"><div class="list" style="padding:12px"></div></div>';
      list = sr.querySelector(".list");
      setTimeout(function () { emit("webchat:initialized"); }, 50);
      setTimeout(function () {
        var stored = JSON.parse(localStorage.getItem(clientKey()) || "null") || { state: { user: { userId: "u1" } }, version: 1 };
        if (stored.state.conversationId) { convId = stored.state.conversationId; log.push(["resume", convId]); }
        else { convId = newConv(); stored.state.conversationId = convId; localStorage.setItem(clientKey(), JSON.stringify(stored)); log.push(["new", convId]); }
        emit("conversation", convId);
        setTimeout(function () { emit("webchat:ready"); }, 100);
      }, 150);
    },
    updateUser: function (u) { log.push(["updateUser", JSON.stringify(u.data)]); return Promise.resolve(); },
    sendEvent: function (e) { log.push(["sendEvent", JSON.stringify(e)]); if (e.type === "language" && !e.__quiet && !window.__skipGreeting) { addMsg("incoming", "Greeting from Botpress"); } return Promise.resolve(); },
    sendMessage: function (t) {
      log.push(["sendMessage", t]);
      setTimeout(function () { addMsg("outgoing", t); emit("message", { text: t }); }, 200);
      setTimeout(function () { addMsg("incoming", window.__replyText || ("Bot reply to: " + t)); emit("message", { text: "reply" }); }, window.__replyDelay || 700);
      return Promise.resolve();
    },
    restartConversation: function () {
      log.push(["restartConversation"]);
      list.innerHTML = "";
      convId = newConv();
      var stored = JSON.parse(localStorage.getItem(clientKey()) || "null") || { state: { user: { userId: "u1" } } };
      stored.state.conversationId = convId; localStorage.setItem(clientKey(), JSON.stringify(stored));
      setTimeout(function () { emit("conversation", convId); }, 100);
      return Promise.resolve();
    }
  };
})();
