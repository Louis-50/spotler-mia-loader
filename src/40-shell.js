/* ==================================================================
   40 · Static shell: a frozen copy of the Mia chat
   Rendered in its own shadow root so site CSS can't touch it (the live
   Botpress chat is also in a shadow root). All config text is set with
   textContent: never parsed as HTML.
   ================================================================== */
var SVG_NS = "http://www.w3.org/2000/svg";
function icon(cls, paths, rect) {
  var s = document.createElementNS(SVG_NS, "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("class", "ico " + cls);
  s.setAttribute("aria-hidden", "true");
  paths.forEach(function (d) {
    var p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    s.appendChild(p);
  });
  if (rect) {
    var r = document.createElementNS(SVG_NS, "rect");
    for (var k in rect) if (rect.hasOwnProperty(k)) r.setAttribute(k, rect[k]);
    s.appendChild(r);
  }
  return s;
}

function avatar(cls) {
  var wrap = el("span", { "class": cls });
  if (SETTINGS.AVATAR_URL) {
    var img = el("img", { src: SETTINGS.AVATAR_URL, alt: "" });
    img.onerror = function () { wrap.innerHTML = ""; wrap.appendChild(el("span", { "class": "av-fb", text: "M" })); };
    wrap.appendChild(img);
  } else {
    wrap.appendChild(el("span", { "class": "av-fb", text: "M" }));
  }
  return wrap;
}

/**
 * createShell(host, labels, row, handlers)
 * handlers.onSend(text, source)  source: "button" | "typed"
 * handlers.onOpen()              mic clicked with nothing typed
 */
function createShell(host, labels, row, handlers) {
  var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
  addStyle(CSS.shell, root);

  var container = el("div", { "class": "c", role: "region", "aria-label": labels.botName });
  var list = el("div", { "class": "list" });
  var scroll = el("div", { "class": "scroll" });
  var vp = el("div", { "class": "vp", "aria-live": "polite" });
  var openerBox = el("div", { style: "display:contents" });
  var userBox = el("div", { style: "display:contents" });

  vp.appendChild(el("div", { "class": "mq" }, [
    avatar("mq-av"),
    el("div", { "class": "mq-txt" }, [
      el("h1", { "class": "mq-title", text: labels.botName }),
      el("p", { "class": "mq-desc", text: labels.botTagline })
    ])
  ]));
  vp.appendChild(el("div", { "class": "m today" }, [el("p", { text: labels.today })]));
  vp.appendChild(openerBox);
  vp.appendChild(userBox);
  scroll.appendChild(vp);
  list.appendChild(scroll);

  var cmp = el("div", { "class": "cmp" });
  var inw = el("div", { "class": "inw" });
  var ta = el("textarea", { rows: "1", placeholder: labels.placeholder, "aria-label": labels.placeholder });
  var send = icon("send", ["m5 12 7-7 7 7", "M12 19V5"]);
  var mic = icon("mic", ["M12 19v3", "M19 10v2a7 7 0 0 1-14 0v-2"], { x: "9", y: "2", width: "6", height: "13", rx: "3" });
  send.setAttribute("role", "button"); send.setAttribute("aria-label", "Send"); send.setAttribute("tabindex", "0");
  mic.setAttribute("role", "button"); mic.setAttribute("aria-label", "Voice input"); mic.setAttribute("tabindex", "0");
  inw.appendChild(ta); inw.appendChild(send); inw.appendChild(mic);
  cmp.appendChild(inw);

  container.appendChild(list);
  container.appendChild(cmp);
  container.appendChild(el("div", { "class": "ft" }, [el("p", { text: labels.powered })]));
  root.appendChild(container);

  var locked = false;
  var buttons = [];

  function scrollDown() { scroll.scrollTop = scroll.scrollHeight; }

  function renderOpener(r) {
    openerBox.innerHTML = "";
    buttons = [];
    var bubbles = String((r && r.opener) || "").split(/\n\s*\n/).map(trim).filter(Boolean);
    bubbles.forEach(function (text, i) {
      var last = i === bubbles.length - 1;
      var bubble = el("div", { "class": "b" }, [el("p", { text: text })]);
      var col = bubble;
      if (last && r.buttons && r.buttons.length) {
        col = el("div", { "class": "col" }, [bubble]);
        var rowEl = el("div", { "class": "row" });
        r.buttons.forEach(function (b) {
          var btn = el("button", { "class": "btn", type: "button", text: b.label });
          btn.addEventListener("click", function () { submit(b.send || b.label, "button"); });
          buttons.push(btn);
          rowEl.appendChild(btn);
        });
        col.appendChild(rowEl);
      }
      openerBox.appendChild(el("div", { "class": "m in anim" }, [avatar("av"), col]));
    });
    scrollDown();
  }

  function syncComposer() {
    var has = !!trim(ta.value);
    if (has) inw.classList.add("has-text"); else inw.classList.remove("has-text");
    ta.style.height = "20px";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  }

  function submit(text, source) {
    text = trim(text);
    if (locked || !text) return;
    handlers.onSend(text, source);
  }

  ta.addEventListener("input", syncComposer);
  ta.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(ta.value, "typed"); }
  });
  function activate(fn) {
    return function (e) {
      if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault(); fn();
    };
  }
  var onSendClick = activate(function () { submit(ta.value, "typed"); });
  var onMicClick = activate(function () { if (!locked && handlers.onOpen) handlers.onOpen(); });
  send.addEventListener("click", onSendClick); send.addEventListener("keydown", onSendClick);
  mic.addEventListener("click", onMicClick); mic.addEventListener("keydown", onMicClick);

  renderOpener(row);

  return {
    host: host,
    setRow: function (r) { if (!locked) renderOpener(r); },
    lock: function () {
      locked = true;
      ta.value = ""; ta.disabled = true; syncComposer();
      cmp.classList.add("off");
      buttons.forEach(function (b) { b.disabled = true; });
    },
    showUser: function (text) {
      userBox.appendChild(el("div", { "class": "m out anim" }, [
        el("div", { "class": "b" }, [el("p", { text: text })])
      ]));
      scrollDown();
    },
    showTyping: function () {
      userBox.appendChild(el("div", { "class": "m in anim" }, [
        avatar("av"), el("div", { "class": "typing", "aria-label": "typing" }, [el("i"), el("i"), el("i")])
      ]));
      scrollDown();
    },
    focus: function () { try { ta.focus({ preventScroll: true }); } catch (e) {} }
  };
}
