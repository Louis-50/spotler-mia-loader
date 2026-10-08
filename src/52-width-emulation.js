/* ==================================================================
   52 · Page-width emulation for the slide-out
   The site's CSS is built on media queries, which read the window width.
   When the panel squeezes the page, those queries still see the full
   window, so the header and sections laid out for a wide screen got
   crammed into the narrower space (the old tags forced a "compact header"
   that looked messy). While the panel is open we re-evaluate every
   width-based @media rule in the site's stylesheets against the width
   the page really has (window minus panel) and switch each one on or off
   accordingly, so the page lays out exactly as it would in a window that
   size (same as with Chrome's side panel open). Closing the panel
   restores every rule. Our own styles (data-mia) are never touched.
   ================================================================== */
var WidthEmu = (function () {
  var changed = [];          // rules we switched, with their original media text
  var activeWidth = null;

  function toPx(v, unit) { v = parseFloat(v); return /r?em/i.test(unit) ? v * 16 : v; }

  // null = a width condition we don't understand: leave that rule alone.
  function evalQuery(q, W) {
    q = trim(q);
    var negate = false;
    if (/^not\s/i.test(q)) { negate = true; q = q.replace(/^not\s+/i, ""); }
    q = q.replace(/^only\s+/i, "");
    var parts = q.split(/\s+and\s+/i), ok = true;
    for (var i = 0; i < parts.length; i++) {
      var p = trim(parts[i]), m;
      if (/^(screen|all)$/i.test(p)) continue;
      if (/^print$/i.test(p)) { ok = false; continue; }
      m = /^\(\s*(min|max)-width\s*:\s*([\d.]+)(px|em|rem)\s*\)$/i.exec(p);
      if (m) {
        var v = toPx(m[2], m[3]);
        if (m[1].toLowerCase() === "min" ? W < v : W > v) ok = false;
        continue;
      }
      if (/width/i.test(p)) return null;
      try { if (!window.matchMedia(p).matches) ok = false; } catch (e) { return null; }
    }
    return negate ? !ok : ok;
  }

  function evalList(text, W) {
    var qs = text.split(","), any = false;
    for (var i = 0; i < qs.length; i++) {
      var r = evalQuery(qs[i], W);
      if (r === null) return null;
      if (r) any = true;
    }
    return any;
  }

  function walk(rules, W) {
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (r.type === 4 && r.media) {               // CSSMediaRule
        var orig = r.__miaOrig || r.media.mediaText;
        if (/width/i.test(orig)) {
          var res = evalList(orig, W);
          if (res !== null) {
            if (!r.__miaOrig) { r.__miaOrig = orig; changed.push(r); }
            var want = res ? "all" : "not all";
            if (r.media.mediaText !== want) r.media.mediaText = want;
          }
        }
        if (r.cssRules) walk(r.cssRules, W);
      } else if (r.cssRules && r.type !== 7) {     // @supports, @layer…
        walk(r.cssRules, W);
      }
    }
  }

  function apply(W) {
    activeWidth = W;
    var sheets = document.styleSheets;
    for (var s = 0; s < sheets.length; s++) {
      var sh = sheets[s], node = sh.ownerNode;
      if (node && node.hasAttribute && node.hasAttribute("data-mia")) continue;
      var rules;
      try { rules = sh.cssRules; } catch (e) { continue; } // cross-origin sheet
      if (rules) walk(rules, W);
    }
  }

  function restore() {
    activeWidth = null;
    for (var i = 0; i < changed.length; i++) {
      try { changed[i].media.mediaText = changed[i].__miaOrig; } catch (e) {}
      delete changed[i].__miaOrig;
    }
    changed = [];
  }

  return {
    apply: apply,
    restore: restore,
    // Re-run for stylesheets added since (lazy CSS) or a new width.
    refresh: function (W) { if (activeWidth !== null) apply(W); }
  };
})();
