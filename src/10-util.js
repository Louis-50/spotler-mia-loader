/* ==================================================================
   10 · Small helpers (ES5 only: GTM Custom HTML)
   ================================================================== */
function log() {
  try {
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[Mia]");
    console.log.apply(console, args);
  } catch (e) {}
}

function now() { return new Date().getTime(); }

// Storage that never throws (private mode, blocked storage, quota).
function store(kind) {
  var s = null;
  try { s = window[kind]; s.getItem("x"); } catch (e) { s = null; }
  return {
    get: function (k) { try { return s ? s.getItem(k) : null; } catch (e) { return null; } },
    set: function (k, v) { try { if (s) s.setItem(k, v); } catch (e) {} },
    del: function (k) { try { if (s) s.removeItem(k); } catch (e) {} },
    keys: function () {
      var out = [];
      try { for (var i = 0; s && i < s.length; i++) out.push(s.key(i)); } catch (e) {}
      return out;
    },
    getJSON: function (k) { try { return JSON.parse(this.get(k)); } catch (e) { return null; } },
    setJSON: function (k, v) { try { this.set(k, JSON.stringify(v)); } catch (e) {} }
  };
}
var LS = store("localStorage");
var SS = store("sessionStorage");

// Build an element. attrs: {class, id, text, html? (never used with config text)}
function el(tag, attrs, children) {
  var e = document.createElement(tag);
  attrs = attrs || {};
  for (var k in attrs) {
    if (!attrs.hasOwnProperty(k) || attrs[k] == null) continue;
    if (k === "text") e.textContent = attrs[k];
    else if (k === "class") e.className = attrs[k];
    else e.setAttribute(k, attrs[k]);
  }
  (children || []).forEach(function (c) { if (c) e.appendChild(c); });
  return e;
}

function addStyle(cssText, root) {
  var s = document.createElement("style");
  s.setAttribute("data-mia", "");
  s.textContent = cssText;
  (root || document.head).appendChild(s);
  return s;
}

function loadScript(src, onerror) {
  var s = document.createElement("script");
  s.src = src;
  s.async = true;
  s.onerror = onerror || function () { log("failed to load", src); };
  document.head.appendChild(s);
  return s;
}

function preconnect(origin) {
  try {
    var l = document.createElement("link");
    l.rel = "preconnect";
    l.href = origin;
    l.crossOrigin = "anonymous";
    document.head.appendChild(l);
  } catch (e) {}
}

function trim(s) { return String(s == null ? "" : s).replace(/^\s+|\s+$/g, ""); }

function pushDataLayer(obj) {
  try { window.dataLayer = window.dataLayer || []; window.dataLayer.push(obj); } catch (e) {}
}

function onDomReady(fn) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
  else fn();
}

function isMobileOrTabletUA() {
  var ua = navigator.userAgent || "";
  if (/Mobi|Android|iPhone|iPad|iPod|Tablet|Silk|Kindle|PlayBook/i.test(ua)) return true;
  // iPadOS in "desktop mode" reports as Mac but has touch.
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true;
  return false;
}
