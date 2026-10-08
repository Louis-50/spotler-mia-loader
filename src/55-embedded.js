/* ==================================================================
   55 · Embedded modes
   "half": the chat card overlays the hero image next to the page copy
           (FeedbackPro). The original image stays in the layout,
           invisible, so the column keeps its size.
   "full": the hero is hidden and a section with headline, intro and a
           large centred card goes in its place (Mail+).
   Mount logic ported from the live campaign tags. Calls onMounted(ui)
   once the card is on the page; gives up quietly (page untouched) if
   no mount point is found.
   ================================================================== */
function createEmbedded(mode, row, labels, handlers, onMounted, onUnplaceable) {
  addStyle(CSS.embedded);

  var restart = el("button", { id: "spotler-inline-restart", type: "button", "aria-label": labels.restart, title: labels.restart });
  restart.innerHTML = "&#8635;";
  restart.addEventListener("click", function () { if (handlers.onRestart) handlers.onRestart(); });

  var logo = el("div", { id: "spotler-load-logo" });
  var spinner = el("span", { id: "spotler-load-spinner" });
  var loading = el("div", { id: "spotler-inline-loading", "aria-hidden": "true" }, [logo, spinner]);
  var webchat = el("div", { id: "bp-embedded-webchat" });
  var scale = el("div", { id: "spotler-chat-scale" }, [webchat]);

  var shell = el("div", { id: "spotler-agent-shell" }, [
    el("div", { id: "spotler-agent-glow", "aria-hidden": "true" }, [el("i")]),
    el("div", { id: "spotler-agent-ring", "aria-hidden": "true" }, [el("i")]),
    restart,
    el("div", { id: "spotler-inline-body" }, [loading, scale])
  ]);

  var agent = el("div", { id: "spotler-inline-agent", "class": "mia-" + mode, "aria-label": labels.title });
  if (mode === "full") {
    if (row.headline) agent.appendChild(el("h2", { id: "spotler-agent-headline", text: row.headline }));
    if (row.intro) agent.appendChild(el("p", { id: "spotler-agent-intro", text: row.intro }));
  }
  agent.appendChild(shell);

  cloneSiteLogo(logo, spinner);

  var ui = {
    mode: mode,
    body: scale,
    webchat: webchat,
    loading: loading,
    videoWidth: mode === "full" ? 420 : 380,
    open: function () {},
    setRow: function () {}
  };

  var placed = false;
  function done() {
    placed = true;
    if (mode === "full") document.body.classList.add("mia-full-page");
    onMounted(ui);
    if (mode === "full") glideIntoView(agent);
  }

  if (mode === "half") {
    (function tryHalf(attempt) {
      if (placed) return;
      var h1 = document.querySelector("h1");
      var hero = h1 ? findHeroAround(h1) : null;
      var host = hero ? findVisualHost(hero, h1, row.media_selector) : null;
      // The card covers the host, so it has to be a real picture next to
      // the copy: big enough, and not behind the headline (a decorative
      // background image would put the card over the page text).
      var ok = host && (row.media_selector || besideHeadline(host, h1));
      if (!ok) {
        if (attempt < 20) return setTimeout(function () { tryHalf(attempt + 1); }, 250);  // images may still be loading
        log(host ? "half: the only image is behind the headline; slide-out instead" : "half: no hero image found; slide-out instead");
        if (onUnplaceable) onUnplaceable();
        return;
      }
      host.classList.add("spotler-inline-visual-host");
      host.appendChild(agent);
      done();
    })(0);
  } else {
    var selector = row.media_selector || 'iframe[src*="player.vimeo.com"], img[src*="services-hero"]';
    (function tryFull(attempt) {
      if (placed) return;
      var media = null;
      try { media = document.querySelector(selector); } catch (e) { media = null; }
      if (!media && attempt < 12) return setTimeout(function () { tryFull(attempt + 1); }, 200);

      if (media) {
        var hero = sectionWithH1(media);
        if (hero) {
          // Outside the hero, so the theme's column/overflow rules can't clip it.
          hero.style.display = "none";
          hero.insertAdjacentElement("afterend", agent);
          return done();
        }
        var wrapper = media.parentElement;
        wrapper.style.paddingTop = "0"; wrapper.style.paddingBottom = "0";
        wrapper.style.height = "auto"; wrapper.style.position = "static";
        wrapper.replaceChild(agent, media);
        return done();
      }
      var h1 = document.querySelector("h1");
      if (h1 && h1.parentNode) { h1.parentNode.insertBefore(agent, h1.nextSibling); return done(); }
      log("full: no place for the card; slide-out instead");
      if (onUnplaceable) onUnplaceable();
    })(0);
  }
  return ui;
}

/* ---- half-page helpers (FeedbackPro v35) ---- */
function findHeroAround(h1) {
  var node = h1.parentElement, fallbackSection = null, fallbackWithMedia = null, depth = 0;
  while (node && node !== document.body && depth < 12) {
    var tag = node.tagName ? node.tagName.toLowerCase() : "";
    var cls = typeof node.className === "string" ? node.className.toLowerCase() : "";
    var hasMedia = !!node.querySelector("img, picture, video, svg");
    if (tag === "section" && !fallbackSection) fallbackSection = node;
    if (hasMedia && !fallbackWithMedia) fallbackWithMedia = node;
    if (hasMedia && (tag === "section" || cls.indexOf("header-section") > -1 || cls.indexOf("hero") > -1)) return node;
    node = node.parentElement; depth++;
  }
  return fallbackWithMedia || fallbackSection;
}

// Picks the hero's main image without needing it to have rendered yet.
function findHeroMedia(hero, selector) {
  if (selector) { try { var forced = hero.querySelector(selector) || document.querySelector(selector); if (forced) return forced; } catch (e) {} }
  var imgs = hero.querySelectorAll("img"), best = null, bestScore = -1;
  for (var i = 0; i < imgs.length; i++) {
    var img = imgs[i];
    var alt = (img.getAttribute("alt") || "").toLowerCase();
    var src = (img.currentSrc || img.getAttribute("src") || img.getAttribute("data-src") || "").toLowerCase();
    var r = img.getBoundingClientRect();
    var score = Math.min(Math.max(0, r.width) * Math.max(0, r.height) / 1000, 500);
    if (alt.indexOf("customer service agent") > -1) score += 1000;
    if (alt.indexOf("customer") > -1) score += 300;
    if (alt.indexOf("agent") > -1) score += 250;
    if (src.indexOf("feedback") > -1) score += 120;
    if (src.indexOf("hero") > -1) score += 100;
    if (alt.indexOf("logo") > -1 || src.indexOf("logo") > -1) score -= 800;
    var dw = parseInt(img.getAttribute("width") || "0", 10) || 0, dh = parseInt(img.getAttribute("height") || "0", 10) || 0;
    if (dw >= 200 && dh >= 200) score += 100;
    if (img.naturalWidth >= 200 && img.naturalHeight >= 200) score += 150;
    if (score > bestScore) { best = img; bestScore = score; }
  }
  return best;
}

function besideHeadline(host, h1) {
  var r = host.getBoundingClientRect(), t = h1.getBoundingClientRect();
  if (r.width < 240 || r.height < 240) return false;
  var overlap = Math.max(0, Math.min(r.right, t.right) - Math.max(r.left, t.left));
  return overlap < 0.3 * t.width;
}

function findVisualHost(hero, h1, selector) {
  var media = findHeroMedia(hero, selector);
  if (!media) return null;
  var current = media, depth = 0;
  while (current && current.parentElement && current.parentElement !== document.body && depth < 12) {
    var parent = current.parentElement;
    if (parent.contains(h1) && !current.contains(h1)) break;
    if (parent === hero) break;
    current = parent; depth++;
  }
  var tag = (current.tagName || "").toLowerCase();
  if (tag === "img" || tag === "picture" || tag === "svg") {
    var p = current.parentElement;
    if (p && !p.contains(h1)) return p;
    var holder = document.createElement("div");
    current.parentNode.insertBefore(holder, current);
    holder.appendChild(current);
    return holder;
  }
  return current;
}

/* ---- full-page helpers (Mail+ v27) ---- */
function sectionWithH1(media) {
  var node = media.parentElement, depth = 0;
  while (node && node !== document.body && depth < 8) {
    if (node.querySelector("h1")) return node;
    node = node.parentElement; depth++;
  }
  return null;
}

// Bring the composer into view a beat after landing, if it's below the fold.
function glideIntoView(agent) {
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setTimeout(function () {
      var rect = agent.getBoundingClientRect();
      if (rect.bottom > window.innerHeight - 8) agent.scrollIntoView({ behavior: "smooth", block: "end" });
    }, 1600);
  } catch (e) {}
}

// Loading state (resume only): the site's own logo, pulsing.
function cloneSiteLogo(host, spinner) {
  var selectors = [".logo-wrapper img", ".logo-wrapper svg", ".header .logo img",
                   'header img[src*="logo"]', 'img[src*="logo"]', 'a[class*="logo"] img', 'img[class*="logo"]'];
  var found = null;
  for (var i = 0; i < selectors.length && !found; i++) found = document.querySelector(selectors[i]);
  if (!found) return;
  var clone = found.cloneNode(true);
  ["id", "class", "width", "height", "style", "loading"].forEach(function (a) { clone.removeAttribute(a); });
  if (clone.tagName && clone.tagName.toLowerCase() === "img") clone.setAttribute("alt", "Spotler");
  host.appendChild(clone);
  host.classList.add("ready");
  spinner.classList.add("hidden");
}
