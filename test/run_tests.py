"""Headless tests for the Mia lazy loader, against a mocked Botpress.
Run: python3 test/run_tests.py  (after `node build.mjs`)"""
import asyncio, json, os, sys, time
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = open(os.path.join(ROOT, "dist/mia-loader.gtm.html")).read()
PAGE = open(os.path.join(ROOT, "test/mock/page.html")).read().replace("<!--TAG-->", TAG)
FULL = open(os.path.join(ROOT, "test/mock/campaign-full.html")).read().replace("<!--TAG-->", TAG)
# Blog-style header: centred copy, a big decorative image behind the headline, no hero picture.
BLOG = PAGE.replace('<div class="hero"><h1>Spotler test page</h1>', '<section class="header-section" style="position:relative;text-align:center;padding:80px 0"><img src="/deco-circles.png" width="900" height="500" style="position:absolute;left:50%;top:0;transform:translateX(-50%);width:900px;height:500px;z-index:0" alt=""><div style="position:relative"><h1>Enrich your marketing knowledge with our blogs</h1><p>Get inspired by our articles.</p></div></section><div class="hero" style="display:none"><h1>x</h1>', 1)
HS_PAGE = open(os.path.join(ROOT, "test/mock/hubspot-meetings.html")).read()
HALF = open(os.path.join(ROOT, "test/mock/campaign-half.html")).read().replace("<!--TAG-->", TAG)
SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#002a4d"/></svg>'
MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
INJECT = open(os.path.join(ROOT, "test/mock/inject.js")).read()
BOTCFG = open(os.path.join(ROOT, "test/mock/botconfig.js")).read()
# A fixed copy of the page table (with half/full campaign rows), so tests do not depend on the live config.json.
CONFIG = open(os.path.join(ROOT, "test/mock/config.json")).read()
OUT = os.path.join(ROOT, "test/out"); os.makedirs(OUT, exist_ok=True)
AVATAR = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000" "1f15c4890000000d49444154789c63f8cfc0f01f0005000201a5f6e0540000000049454e44ae426082")

# Website contract v2 start event (bot repo: docs/build-spec.md section 1).
START_KEYS = sorted(["type", "version", "locale", "startPage", "startUrl", "pageKey", "source", "opener", "campaign", "companyDomain", "companyName"])

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASS " if cond else "FAIL ") + name + (("  -- " + str(detail)) if detail and not cond else ""))

async def setup(ctx, config_ok=True, config=None, raw_down=False, slow_ms=0):
    reqs = []
    async def handler(route):
        url = route.request.url
        reqs.append(url)
        if "cdn.botpress.cloud" in url: return await route.fulfill(body=INJECT, content_type="application/javascript")
        if "files.bpcontent.cloud" in url and url.endswith(".js"): return await route.fulfill(body=BOTCFG, content_type="application/javascript")
        if url.endswith(".webp"): return await route.fulfill(body=AVATAR, content_type="image/png")
        if "raw.githubusercontent.com" in url and raw_down: return await route.fulfill(status=503, body="")
        if "cdn.jsdelivr.net" in url or "raw.githubusercontent.com" in url:
            if not config_ok: return await route.fulfill(status=500, body="")
            if slow_ms: await asyncio.sleep(slow_ms / 1000)
            return await route.fulfill(body=config or CONFIG, content_type="application/json", headers={"access-control-allow-origin": "*"})
        if url.endswith("/logo.svg"): return await route.fulfill(body=SVG, content_type="image/svg+xml")
        if url.endswith(".png"): return await route.fulfill(body=AVATAR, content_type="image/png")
        if "spotler.com" in url and "/discover/mailplus" in url: return await route.fulfill(body=FULL, content_type="text/html")
        if "spotler.com" in url and "/discover/feedbackpro" in url: return await route.fulfill(body=HALF, content_type="text/html")
        if "meetings.hubspot.com" in url: return await route.fulfill(body=HS_PAGE, content_type="text/html")
        if "spotler.com" in url and "/en-gb/blog" in url: return await route.fulfill(body=BLOG, content_type="text/html")
        if "spotler.com" in url: return await route.fulfill(body=PAGE, content_type="text/html")
        return await route.fulfill(status=404, body="")
    await ctx.route("**/*", handler)
    return reqs

def bp_requests(reqs): return [u for u in reqs if "botpress" in u or "bpcontent.cloud" in u and u.endswith(".js")]

async def shell_text(page):
    return await page.evaluate("""() => { const h=document.getElementById('spotler-mia-shell'); return h && h.shadowRoot ? h.shadowRoot.textContent : null }""")

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()

        # ---------- 1. first visit: shell only, no Botpress ----------
        ctx = await b.new_context(viewport={"width": 1440, "height": 900})
        reqs = await setup(ctx)
        page = await ctx.new_page()
        logs = []
        page.on("console", lambda m: logs.append(m.text))
        await page.goto("https://www.spotler.com/en-gb/pricing/compare")
        await page.wait_for_timeout(1200)
        txt = await shell_text(page)
        check("1a shell renders", txt and "Mia" in txt)
        check("1b page opener + buttons from config", txt and "Book a demo" in txt and "What brings you to Spotler" in txt, txt)
        check("1c no Botpress request on page view", not bp_requests(reqs), bp_requests(reqs))
        check("1d panel open + page squeezed", await page.evaluate("document.getElementById('spotler-agent-panel').classList.contains('open') && document.body.classList.contains('agent-panel-open')"))
        await page.screenshot(path=f"{OUT}/1-shell.png")
        await page.locator("#spotler-agent-panel").screenshot(path=f"{OUT}/1-shell-panel.png")

        # ---------- 2. click a button: handover ----------
        t0 = time.time()
        await page.evaluate("""() => { const sr=document.getElementById('spotler-mia-shell').shadowRoot; [...sr.querySelectorAll('.btn')].find(b=>b.textContent==='Book a demo').click(); }""")
        await page.wait_for_timeout(150)
        txt2 = await shell_text(page)
        await page.locator("#spotler-agent-panel").screenshot(path=f"{OUT}/2-sending.png")
        check("2a user bubble shown instantly in shell", txt2 and txt2.count("Book a demo") >= 2)
        await page.wait_for_function("document.getElementById('bp-embedded-webchat').classList.contains('bp-ready')", timeout=8000)
        took = time.time() - t0
        bplog = await page.evaluate("window.__bpLog")
        names = [e[0] for e in bplog]
        check("2b Botpress loaded after click", bp_requests(reqs))
        ev = [json.loads(e[1]) for e in bplog if e[0] == "sendEvent"]
        check("2c one start event, contract v2 shape (exact fields)", len(ev) == 1 and sorted(ev[0]) == START_KEYS and ev[0]["type"] == "start" and ev[0]["version"] == 2
              and ev[0]["locale"] == "en-GB" and ev[0]["startPage"] == "/en-gb/pricing/compare" and ev[0]["startUrl"] == "https://www.spotler.com/en-gb/pricing/compare"
              and ev[0]["pageKey"] == "pricing" and ev[0]["source"] == "button" and ev[0]["opener"].startswith("Hi , I'm the Spotler Agent") and len(ev[0]["opener"]) <= 500
              and ev[0]["campaign"] == "" and ev[0]["companyDomain"] == "" and ev[0]["companyName"] == "", ev)
        check("2d no v1 fields (language, region, page, route)", ev and not any(k in ev[0] for k in ("language", "region", "page", "route")), ev)
        up = [json.loads(e[1]) for e in bplog if e[0] == "updateUser"]
        check("2e updateUser {locale, pageKey, campaign} before the start event and the first message", up == [{"locale": "en-GB", "pageKey": "pricing", "campaign": ""}]
              and names.index("updateUser") < names.index("sendEvent") < names.index("sendMessage"), bplog)
        check("2e no proactiveClickAt / proactiveTopic", not any("proactive" in e[1] for e in bplog if len(e) > 1), bplog)
        check("2f message sent once, after start event", names.count("sendMessage") == 1 and names.index("sendEvent") < names.index("sendMessage"), names)
        await page.wait_for_timeout(500)
        check("2g shell faded out", await page.evaluate("document.getElementById('spotler-mia-shell').classList.contains('mia-out')"))
        check("2h fade within 2s of click (mock)", took < 2.5, round(took, 2))
        live = await page.evaluate("JSON.parse(localStorage.getItem('spotler_mia_live'))")
        check("2i live conversation recorded with convId", live and live.get("convId"), live)
        await page.locator("#spotler-agent-panel").screenshot(path=f"{OUT}/2-live.png")
        dl = await page.evaluate("(window.dataLayer||[]).map(e=>e.event).filter(Boolean)")
        check("2j dataLayer start + ready events", "spotler_mia_start" in dl and "spotler_mia_ready" in dl, dl)

        # ---------- 3. next page: resume, no new start event ----------
        reqs.clear()
        await page.goto("https://www.spotler.com/en-gb/products")
        await page.wait_for_function("document.getElementById('bp-embedded-webchat').classList.contains('bp-ready')", timeout=8000)
        bplog = await page.evaluate("window.__bpLog")
        check("3a resumed same conversation", any(e[0] == "resume" for e in bplog), bplog)
        check("3b no shell on resume", await page.evaluate("!document.getElementById('spotler-mia-shell')"))
        await page.wait_for_timeout(300)
        bplog = await page.evaluate("window.__bpLog")
        ev = [json.loads(e[1]) for e in bplog if e[0] == "sendEvent"]
        check("3c no second start event / message / user data on resume", not any(e[0] in ("sendMessage", "updateUser") for e in bplog) and not any(e["type"] == "start" for e in ev), bplog)
        check("3d page event for the new page (page, url, pageKey, title), once", ev == [{"type": "page", "page": "/en-gb/products", "url": "https://www.spotler.com/en-gb/products", "pageKey": "products", "title": "Spotler test page"}], ev)

        # ---------- 4. timeout: shell returns, conversation id cleared ----------
        await page.evaluate("""() => { const l=JSON.parse(localStorage.getItem('spotler_mia_live')); l.lastActivity = Date.now() - 16*60*1000; localStorage.setItem('spotler_mia_live', JSON.stringify(l)); document.dispatchEvent(new Event('visibilitychange')); }""")
        await page.wait_for_timeout(300)
        check("4a shell back after timeout", (await shell_text(page) or "").find("Book a demo") != -1)
        check("4b webchat hidden", await page.evaluate("!document.getElementById('bp-embedded-webchat').classList.contains('bp-ready')"))
        cleared = await page.evaluate("JSON.parse(localStorage.getItem('bp-webchat-test-client-client')).state")
        check("4c Botpress conversationId cleared, user kept", "conversationId" not in cleared and cleared.get("user"), cleared)
        check("4d live record removed", await page.evaluate("localStorage.getItem('spotler_mia_live') === null"))
        ends = [json.loads(e[1]) for e in await page.evaluate("window.__bpLog") if e[0] == "sendEvent" and '"end"' in e[1]]
        check("4e end event {type: end, reason: timeout} sent to the bot", ends == [{"type": "end", "reason": "timeout"}], ends)

        # ---------- 5. engage again on same page: restart path ----------
        await page.evaluate("""() => { const sr=document.getElementById('spotler-mia-shell').shadowRoot; const ta=sr.querySelector('textarea'); ta.value='How much is Mail+?'; ta.dispatchEvent(new Event('input')); ta.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); }""")
        await page.wait_for_function("document.getElementById('bp-embedded-webchat').classList.contains('bp-ready')", timeout=8000)
        bplog = await page.evaluate("window.__bpLog")
        names = [e[0] for e in bplog]
        check("5a restartConversation used", "restartConversation" in names, names)
        ev = [json.loads(e[1]) for e in bplog if e[0] == "sendEvent"]
        check("5b start event for the new conversation, source typed", ev and ev[-1]["source"] == "typed", ev)
        check("5c typed message sent", ["sendMessage", "How much is Mail+?"] in bplog, bplog)
        ri = names.index("restartConversation")
        check("5d restart path: user data written again before restartConversation, end event before it", any(e[0] == "updateUser" and json.loads(e[1]) == {"locale": "en-GB", "pageKey": "products", "campaign": ""} for e in bplog[:ri])
              and any(e[0] == "sendEvent" and json.loads(e[1]).get("type") == "end" for e in bplog[:ri]), bplog)
        check("5e start event v2 for the new conversation, after the restart", ev and ev[-1]["type"] == "start" and ev[-1]["pageKey"] == "products" and names.index("restartConversation") < len(names) - 1 - names[::-1].index("sendEvent"), names)

        # ---------- 6. restart button: shell returns ----------
        await page.wait_for_timeout(400)
        n_before = len(await page.evaluate("window.__bpLog"))
        await page.click("#spotler-agent-restart")
        await page.wait_for_timeout(300)
        check("6a restart brings shell back", (await shell_text(page) or "").find("Book a demo") != -1)
        check("6b live cleared", await page.evaluate("localStorage.getItem('spotler_mia_live') === null"))
        after = [json.loads(e[1]) for e in (await page.evaluate("window.__bpLog"))[n_before:] if e[0] == "sendEvent"]
        check("6c end event {type: end, reason: restart} sent on Restart", after == [{"type": "end", "reason": "restart"}], after)
        await ctx.close()

        # ---------- 7. guards ----------
        OFF_SWITCH = json.dumps(dict(json.loads(CONFIG), enabledRegions=["en-GB"]))
        for name, url, vw, cfg in [("7a config enabledRegions turns NL off", "https://www.spotler.com/nl-nl/", 1440, OFF_SWITCH),
                                   ("7b config enabledRegions turns INT off", "https://www.spotler.com/pricing", 1440, OFF_SWITCH),
                                   ("7c off below 1200px", "https://www.spotler.com/en-gb/", 1100, None)]:
            ctx = await b.new_context(viewport={"width": vw, "height": 900})
            reqs = await setup(ctx, config=cfg)
            page = await ctx.new_page()
            await page.goto(url); await page.wait_for_timeout(600)
            check(name, await page.evaluate("!document.getElementById('spotler-agent-panel')") and not bp_requests(reqs))
            await ctx.close()

        # a stale cached config that still has the region off must not keep it off
        ctx = await b.new_context(viewport={"width": 1440, "height": 900})
        await setup(ctx)
        stale = json.dumps(dict(json.loads(OFF_SWITCH), version="stale"))
        await ctx.add_init_script("localStorage.setItem('spotler_mia_config', " + json.dumps(stale) + ")")
        page = await ctx.new_page()
        await page.goto("https://www.spotler.com/nl-nl/"); await page.wait_for_timeout(900)
        check("7d stale cached off-switch: live config turns NL back on", await page.evaluate("!!document.getElementById('spotler-agent-panel') && !JSON.parse(localStorage.getItem('spotler_mia_config')).enabledRegions"))
        await ctx.close()

        # an older cached config must not win over the live file
        ctx = await b.new_context(viewport={"width": 1440, "height": 900})
        reqs = await setup(ctx)
        old = json.loads(CONFIG); old["version"] = "old"
        for r in old["rows"]:
            if r["url_match"] == "*" and r["region"] == "en-GB": r["opener"] = "OLD CACHED OPENER"
        await ctx.add_init_script("localStorage.setItem('spotler_mia_config', " + json.dumps(json.dumps(old)) + ")")
        page = await ctx.new_page()
        await page.goto("https://www.spotler.com/en-gb/pricing/compare"); await page.wait_for_timeout(900)
        txt = await shell_text(page) or ""
        check("7e live config wins over an older cached copy on the first load", "OLD CACHED OPENER" not in txt and "Spotler Agent" in txt, txt[:120])
        check("7e config read from GitHub first, with a cache-busting stamp", any("raw.githubusercontent.com" in u and "config.json?t=" in u for u in reqs) and not any("cdn.jsdelivr.net" in u for u in reqs))
        await ctx.close()

        # slow network: the page starts on an old cached copy, then catches up when the live file lands
        ctx = await b.new_context(viewport={"width": 1440, "height": 900})
        await setup(ctx, slow_ms=2600)
        old = json.loads(CONFIG); old["version"] = "old"
        for r in old["rows"]:
            if r["region"] == "en-GB" and r["url_match"] == "*": r["opener"] = "OLD CACHED OPENER"
            if r["region"] == "en-GB" and r.get("teaser_text") and r["url_match"] != "*": r["teaser_text"] = "OLD TEASER"
        await ctx.add_init_script("localStorage.setItem('spotler_mia_config', " + json.dumps(json.dumps(old)) + ")")
        await ctx.add_init_script("sessionStorage.setItem('spotlerAgentState','dismissed')")
        logs = []
        page = await ctx.new_page()
        page.on("console", lambda m: logs.append(m.text))
        await page.goto("https://www.spotler.com/en-gb/pricing/compare"); await page.wait_for_timeout(1900)
        before = await shell_text(page) or ""
        await page.wait_for_timeout(4800)
        after = await shell_text(page) or ""
        tz = await page.evaluate("[document.getElementById('spotler-agent-teaser').hidden, document.getElementById('spotler-agent-teaser-text').textContent]")
        check("7g slow network: starts on the cached copy, then takes the live opener and teaser", "OLD CACHED OPENER" in before and "OLD CACHED OPENER" not in after and "Spotler Agent" in after and not tz[0] and tz[1] != "OLD TEASER" and tz[1], [tz, [l for l in logs if "config" in l]])
        await ctx.close()

        # GitHub down: the jsDelivr copy is used
        ctx = await b.new_context(viewport={"width": 1440, "height": 900})
        reqs = await setup(ctx, raw_down=True)
        logs = []
        page = await ctx.new_page()
        page.on("console", lambda m: logs.append(m.text))
        await page.goto("https://www.spotler.com/en-gb/pricing/compare"); await page.wait_for_timeout(900)
        check("7f GitHub down: config comes from the jsDelivr backup", any("config from network" in l for l in logs) and any("cdn.jsdelivr.net" in u for u in reqs), logs)
        await ctx.close()

        # ---------- 8. config down: built-in default ----------
        ctx = await b.new_context(viewport={"width": 1440, "height": 900})
        reqs = await setup(ctx, config_ok=False)
        page = await ctx.new_page()
        await page.goto("https://www.spotler.com/en-gb/")
        await page.wait_for_timeout(1800)
        check("8a default opener when config fails", "Book a demo" in (await shell_text(page) or ""))
        # ---------- 9. teaser after closing ----------
        await page.click("#spotler-agent-close")
        await page.wait_for_timeout(300)
        check("9a pill shows after close", await page.evaluate("getComputedStyle(document.getElementById('spotler-agent-pill')).display === 'flex'"))
        await ctx.close()

        # ---------- 10. pricing row teaser text ----------
        ctx = await b.new_context(viewport={"width": 1440, "height": 900})
        reqs = await setup(ctx)
        page = await ctx.new_page()
        await page.add_init_script("sessionStorage.setItem('spotlerAgentState','dismissed')")
        await page.goto("https://www.spotler.com/en-gb/pricing/compare")
        await page.wait_for_timeout(4600)
        t = await page.evaluate("document.getElementById('spotler-agent-teaser').hidden ? null : document.getElementById('spotler-agent-teaser-text').textContent")
        check("10a page teaser from config", t == "Want help comparing plans and pricing?", t)
        await page.screenshot(path=f"{OUT}/10-teaser.png")
        await page.click("#spotler-agent-teaser")
        await page.wait_for_function("document.getElementById('bp-embedded-webchat').classList.contains('bp-ready')", timeout=8000)
        bplog = await page.evaluate("window.__bpLog")
        ev = [json.loads(e[1]) for e in bplog if e[0] == "sendEvent"]
        check("10b teaser click sends its message, source teaser", ["sendMessage", "Help me compare plans and pricing"] in bplog and ev and ev[0]["source"] == "teaser", bplog)
        await ctx.close()

        # ---------- 11. full-page (Mail+) ----------
        ctx = await b.new_context(viewport={"width": 1440, "height": 900})
        reqs = await setup(ctx)
        page = await ctx.new_page()
        await page.goto("https://www.spotler.com/en-gb/discover/mailplus-video-overview")
        await page.wait_for_timeout(1500)
        st = await page.evaluate("""() => { const a=document.getElementById('spotler-inline-agent'); const sr=document.getElementById('spotler-mia-shell')&&document.getElementById('spotler-mia-shell').shadowRoot;
            return { mode: a && a.className, heroHidden: getComputedStyle(document.querySelector('.header-section')).display==='none', afterHero: a && a.previousElementSibling && a.previousElementSibling.classList.contains('header-section'),
              h2: a && a.querySelector('h2') && a.querySelector('h2').textContent, intro: document.getElementById('spotler-agent-intro') && document.getElementById('spotler-agent-intro').textContent,
              video: sr && sr.querySelector('video') && sr.querySelector('video').getAttribute('src'), buttons: sr ? sr.querySelectorAll('.btn').length : 0,
              scale: a && getComputedStyle(a).getPropertyValue('--chat-scale').trim(), panel: !!document.getElementById('spotler-agent-panel') } }""")
        check("11a full card replaces hero, after it", st["mode"] == "mia-full" and st["heroHidden"] and st["afterHero"], st)
        check("11b headline + intro from config", st["h2"] and "Mail+" in st["h2"] and st["intro"] and "Let" in st["intro"], st)
        check("11c shell shows campaign opener: video + 5 buttons", st["video"] and st["video"].endswith(".mov") and st["buttons"] == 5, st)
        check("11d content scale 1.08 at 1440px, no slide-out", st["scale"] == "1.08" and not st["panel"], st)
        check("11e no Botpress on page view", not bp_requests(reqs), bp_requests(reqs))
        await page.screenshot(path=f"{OUT}/11-full.png", full_page=False)
        await page.evaluate("""() => { const sr=document.getElementById('spotler-mia-shell').shadowRoot; [...sr.querySelectorAll('.btn')].find(b=>b.textContent==='What does it cost?').click(); }""")
        await page.wait_for_function("document.getElementById('bp-embedded-webchat').classList.contains('bp-ready')", timeout=8000)
        bplog = await page.evaluate("window.__bpLog")
        ev = [json.loads(e[1]) for e in bplog if e[0] == "sendEvent"]
        check("11f start event carries campaign mailplus (route column not forwarded)", ev and ev[0]["campaign"] == "mailplus" and ev[0]["pageKey"] == "services" and "route" not in ev[0] and ev[0]["source"] == "button", ev)
        up = [json.loads(e[1]) for e in bplog if e[0] == "updateUser"]
        check("11f user data carries the campaign too", up == [{"locale": "en-GB", "pageKey": "services", "campaign": "mailplus"}], up)
        check("11g message sent", ["sendMessage", "What does it cost?"] in bplog, bplog)
        # carry over: campaign chat follows into the slide-out
        await page.goto("https://www.spotler.com/en-gb/pricing/compare")
        await page.wait_for_function("document.getElementById('bp-embedded-webchat') && document.getElementById('bp-embedded-webchat').classList.contains('bp-ready')", timeout=8000)
        bplog = await page.evaluate("window.__bpLog")
        check("11h campaign conversation resumes in slide-out", any(e[0] == "resume" for e in bplog) and await page.evaluate("!!document.getElementById('spotler-agent-panel') && !document.getElementById('spotler-mia-shell')"), bplog)
        await page.wait_for_timeout(300)
        ev = [json.loads(e[1]) for e in await page.evaluate("window.__bpLog") if e[0] == "sendEvent"]
        check("11i page event on the next page (pricing), no new start event", [e["type"] for e in ev] == ["page"] and ev[0]["pageKey"] == "pricing" and ev[0]["page"] == "/en-gb/pricing/compare", ev)
        await ctx.close()

        # ---------- 12. full-page on mobile ----------
        ctx = await b.new_context(viewport={"width": 390, "height": 844}, user_agent=MOBILE_UA, is_mobile=True, has_touch=True)
        reqs = await setup(ctx)
        page = await ctx.new_page()
        await page.goto("https://www.spotler.com/en-gb/discover/mailplus-video-overview")
        await page.wait_for_timeout(1500)
        ok = await page.evaluate("!!document.querySelector('#spotler-inline-agent.mia-full') && !!document.getElementById('spotler-mia-shell')")
        check("12a full-page shows on mobile", ok)
        await page.screenshot(path=f"{OUT}/12-full-mobile.png")
        await page.goto("https://www.spotler.com/en-gb/discover/feedbackpro-x-zendesk")
        await page.wait_for_timeout(1200)
        check("12b half-page off on mobile", await page.evaluate("!document.getElementById('spotler-inline-agent')"))
        await page.goto("https://www.spotler.com/en-gb/pricing/compare")
        await page.wait_for_timeout(800)
        check("12c slide-out off on mobile", await page.evaluate("!document.getElementById('spotler-agent-panel')") and not bp_requests(reqs))
        await ctx.close()

        # ---------- 13. half-page (FeedbackPro) ----------
        ctx = await b.new_context(viewport={"width": 1440, "height": 900})
        reqs = await setup(ctx)
        page = await ctx.new_page()
        await page.goto("https://www.spotler.com/en-gb/discover/feedbackpro-x-zendesk")
        await page.wait_for_timeout(1500)
        st = await page.evaluate("""() => { const a=document.getElementById('spotler-inline-agent'); const sr=document.getElementById('spotler-mia-shell')&&document.getElementById('spotler-mia-shell').shadowRoot;
            return { mode: a && a.className, inVisual: a && a.parentElement.classList.contains('spotler-inline-visual-host'), imgHidden: getComputedStyle(document.querySelector('.visual img')).visibility==='hidden',
              copyVisible: getComputedStyle(document.querySelector('.copy')).visibility==='visible', buttons: sr ? sr.querySelectorAll('.btn').length : 0, text: sr && sr.textContent } }""")
        check("13a half card overlays the hero image, copy untouched", st["mode"] == "mia-half" and st["inVisual"] and st["imgHidden"] and st["copyVisible"], st)
        check("13b FeedbackPro opener + 6 buttons", st["buttons"] == 6 and "FeedbackPro inside out" in (st["text"] or ""), st)
        check("13c no Botpress on page view", not bp_requests(reqs), bp_requests(reqs))
        await page.screenshot(path=f"{OUT}/13-half.png")
        ctx2 = await b.new_context(viewport={"width": 1440, "height": 900})
        blogcfg = json.loads(CONFIG)
        blogcfg["rows"].append({"url_match": "/en-gb/blog", "match_type": "exact", "region": "en-GB", "mode": "half", "page": "blog", "opener": "blog test", "buttons": [{"label": "blog", "send": "blog"}]})
        await setup(ctx2, config=json.dumps(blogcfg))
        bp = await ctx2.new_page()
        await bp.goto("https://www.spotler.com/en-gb/blog"); await bp.wait_for_timeout(6500)
        st2 = await bp.evaluate("() => ({ card: !!document.getElementById('spotler-inline-agent') && !!document.getElementById('spotler-inline-agent').parentNode, panel: !!document.getElementById('spotler-agent-panel'), h1: getComputedStyle(document.querySelector('h1')).visibility })")
        check("13e half row on a page whose only image sits behind the headline: slide-out instead, copy untouched", not st2["card"] and st2["panel"] and st2["h1"] == "visible", st2)
        await bp.screenshot(path=f"{OUT}/13e-blog.png")
        await ctx2.close()
        await page.evaluate("""() => { const sr=document.getElementById('spotler-mia-shell').shadowRoot; const ta=sr.querySelector('textarea'); ta.value='Does it work with Zendesk?'; ta.dispatchEvent(new Event('input')); ta.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); }""")
        await page.wait_for_function("document.getElementById('bp-embedded-webchat').classList.contains('bp-ready')", timeout=8000)
        bplog = await page.evaluate("window.__bpLog")
        ev = [json.loads(e[1]) for e in bplog if e[0] == "sendEvent"]
        check("13d campaign feedbackpro on the start event, typed message sent", ev and ev[0]["campaign"] == "feedbackpro" and ev[0]["pageKey"] == "feedbackpro-zendesk" and ev[0]["source"] == "typed" and ["sendMessage", "Does it work with Zendesk?"] in bplog, bplog)
        await page.click("#spotler-inline-restart")
        await page.wait_for_timeout(300)
        check("13e card restart brings the shell back", "FeedbackPro inside out" in (await shell_text(page) or ""))
        await ctx.close()


        # ---------- 15. NL and INT regions, other locales off ----------
        ctx = await b.new_context(viewport={"width": 1440, "height": 900})
        await setup(ctx)
        page = await ctx.new_page()
        logs = []
        page.on("console", lambda m: logs.append(m.text))
        await page.goto("https://www.spotler.com/nl-nl/prijzen")
        await page.wait_for_timeout(1200)
        txt = await shell_text(page)
        check("15a NL shell: Dutch greeting + buttons", txt and "Wat brengt je vandaag naar Spotler" in txt and "Een demo boeken" in txt and "Bekijk prijzen" in txt, txt)
        ph = await page.evaluate("document.getElementById('spotler-mia-shell').shadowRoot.querySelector('textarea').getAttribute('placeholder')")
        check("15b NL placeholder + header title", ph == "Stel Mia een vraag..." and await page.evaluate("document.getElementById('spotler-agent-title').textContent") == "Spotler AI-assistent", ph)
        await page.locator("#spotler-agent-panel").screenshot(path=f"{OUT}/15-nl-shell.png")
        sh = await page.evaluate("""() => { const sr=document.getElementById('spotler-mia-shell').shadowRoot;
            return [sr.querySelector('.mq-desc').textContent, sr.querySelector('.today') ? 'today shown' : 'no date line', sr.textContent.includes('Vandaag'), sr.querySelector('.ft p').textContent, sr.querySelector('.ft a').href, sr.querySelector('.ft a').target] }""")
        check("15i NL shell: AI tagline, no date line, and the 'AI-assistent · Privacy' note linking to the NL privacy page", sh == ["Jouw AI-marketingassistent.", "no date line", False, "AI-assistent · Privacy", "https://spotler.com/nl-nl/privacy-statement", "_blank"], sh)
        await page.evaluate("""() => { const sr=document.getElementById('spotler-mia-shell').shadowRoot; [...sr.querySelectorAll('.btn')].find(b=>b.textContent==='Een demo boeken').click(); }""")
        await page.wait_for_function("document.getElementById('bp-embedded-webchat').classList.contains('bp-ready')", timeout=8000)
        bplog = await page.evaluate("window.__bpLog")
        ev = [json.loads(e[1]) for e in bplog if e[0] == "sendEvent"]
        check("15c NL start event locale nl, page key prijzen", ev and ev[0]["locale"] == "nl" and ev[0]["pageKey"] == "prijzen" and ["sendMessage", "Een demo boeken"] in bplog, ev)
        await page.wait_for_timeout(900)
        live = await page.evaluate("""() => { const sr=document.querySelector('#bp-embedded-webchat #webchat-root').shadowRoot;
            return { desc: sr.querySelector('.desc').textContent, today: getComputedStyle(sr.querySelector('.bpDate')).display === 'none' ? 'hidden' : sr.querySelector('.bpDate').textContent, ph: sr.querySelector('textarea').getAttribute('placeholder'),
              footer: sr.querySelector('.bpFooter').textContent, link: (sr.querySelector('.bpFooter a') || {}).href || '', status: [...sr.querySelectorAll('.bpStatus')].map(e => e.textContent) } }""")
        check("15j NL live chat stays Dutch: AI tagline, no Today line, placeholder, AI-assistent · Privacy (NL link), Afgeleverd", live["desc"] == "Jouw AI-marketingassistent." and live["today"] == "hidden" and live["ph"] == "Stel Mia een vraag..." and live["footer"] == "AI-assistent · Privacy" and live["link"] == "https://spotler.com/nl-nl/privacy-statement" and live["status"] and all(x == "Afgeleverd" for x in live["status"]), live)
        # Moving to an INT page ends the NL conversation and shows the INT shell
        await page.goto("https://www.spotler.com/pricing")
        await page.wait_for_timeout(1200)
        txt = await shell_text(page)
        check("15d region change starts fresh: INT shell, NL chat ended", txt and "Hi, I'm the Spotler Agent" in txt and "Pricing" in txt and not await page.evaluate("document.getElementById('bp-embedded-webchat').classList.contains('bp-ready')"), txt)
        await page.click("#spotler-agent-close")
        await page.wait_for_timeout(4400)
        tz = await page.evaluate("[document.getElementById('spotler-agent-teaser').hidden, document.getElementById('spotler-agent-teaser-text').textContent, document.getElementById('spotler-agent-pill').textContent]")
        check("15e INT teaser from the /pricing row", not tz[0] and tz[1] == "Want help comparing plans and pricing?" and "Ask Mia" in tz[2], tz)
        await page.evaluate("document.getElementById('spotler-agent-teaser').click()")
        await page.wait_for_function("document.getElementById('bp-embedded-webchat').classList.contains('bp-ready')", timeout=8000)
        bplog = await page.evaluate("window.__bpLog")
        ev = [json.loads(e[1]) for e in bplog if e[0] == "sendEvent"]
        check("15f INT start event locale int, teaser text sent", ev and ev[-1]["locale"] == "int" and ev[-1]["source"] == "teaser" and ["sendMessage", "Help me compare plans and pricing"] in bplog, [ev, bplog[-3:]])
        await page.wait_for_timeout(900)
        live = await page.evaluate("""() => { const sr=document.querySelector('#bp-embedded-webchat #webchat-root').shadowRoot;
            return { desc: sr.querySelector('.desc').textContent, today: getComputedStyle(sr.querySelector('.bpDate')).display === 'none' ? 'hidden' : sr.querySelector('.bpDate').textContent, ph: sr.querySelector('textarea').getAttribute('placeholder'),
              footer: sr.querySelector('.bpFooter').textContent, link: (sr.querySelector('.bpFooter a') || {}).href || '', status: [...sr.querySelectorAll('.bpStatus')].map(e => e.textContent) } }""")
        check("15k INT live chat: English text, no Today line, AI tagline, 'AI assistant · Privacy' linking to the INT privacy page", live["desc"] == "Your AI marketing assistant." and live["today"] == "hidden" and live["ph"] == "Ask Mia a question..." and live["footer"] == "AI assistant · Privacy" and live["link"] == "https://spotler.com/privacy-statement" and live["status"] == ["Delivered"], live)
        await ctx.close()

        ctx = await b.new_context(viewport={"width": 1440, "height": 900})
        await setup(ctx)
        page = await ctx.new_page()
        logs = []
        page.on("console", lambda m: logs.append(m.text))
        await page.goto("https://www.spotler.com/nl-nl/")
        await page.wait_for_timeout(1000)
        await page.click("#spotler-agent-close")
        await page.wait_for_timeout(4400)
        tz = await page.evaluate("[document.getElementById('spotler-agent-teaser').className, document.getElementById('spotler-agent-teaser-text').textContent, document.getElementById('spotler-agent-pill').textContent]")
        check("15g NL default teaser beside the pill, Dutch pill", tz[0] == "nl" and tz[1] == "Vragen over Spotler? Vraag maar raak!" and "Vraag het Mia" in tz[2], tz)
        for loc in ["/fr-fr/", "/it-it/pricing"]:
            logs.clear()
            await page.goto("https://www.spotler.com" + loc)
            await page.wait_for_timeout(700)
            off = await page.evaluate("!document.getElementById('spotler-agent-panel') && !document.getElementById('spotler-mia-shell')")
            check(f"15h no chat on a locale outside the eight ({loc})", off and any("no chat for this locale" in l for l in logs), logs)
        await ctx.close()

        # ---------- 20. the five new locales: shell, labels, start event ----------
        # Mock page table has no rows for them: the built-in rows (DE/ES/SV in their language, en-DE/en-AU = INT).
        NEW = [("/de-de/preise", "de-DE", "Spotler KI-Assistent", "Hallo, ich bin Mia", "Demo buchen", "Stellen Sie Mia eine Frage..."),
               ("/en-de/pricing", "en-DE", "Spotler AI Assistant", "Hi, I’m Mia", "Book a demo", "Ask Mia a question..."),
               ("/es-es/precios", "es-ES", "Asistente de IA de Spotler", "Hola, soy Mia", "Reservar una demo", "Haz una pregunta a Mia..."),
               ("/sv-se/priser", "sv-SE", "Spotler AI-assistent", "Hej, jag är Mia", "Boka en demo", "Ställ en fråga till Mia..."),
               ("/en-au/pricing", "en-AU", "Spotler AI Assistant", "Hi, I’m Mia", "Book a demo", "Ask Mia a question...")]
        for path, loc, title, opener, btn, ph in NEW:
            ctx = await b.new_context(viewport={"width": 1440, "height": 900})
            await setup(ctx)
            page = await ctx.new_page()
            await page.goto("https://www.spotler.com" + path); await page.wait_for_timeout(1200)
            st = await page.evaluate("""() => { const sr=document.getElementById('spotler-mia-shell') && document.getElementById('spotler-mia-shell').shadowRoot;
                return sr ? { title: document.getElementById('spotler-agent-title').textContent, text: sr.textContent, ph: sr.querySelector('textarea').getAttribute('placeholder'),
                  privacy: sr.querySelector('.ft a').href } : null }""")
            check(f"20a {loc}: shell on, its labels and opener", st and st["title"] == title and opener in st["text"] and btn in st["text"] and st["ph"] == ph and st["privacy"] == "https://spotler.com/privacy-statement", st)
            await page.evaluate("(b) => { const sr=document.getElementById('spotler-mia-shell').shadowRoot; [...sr.querySelectorAll('.btn')].find(x=>x.textContent===b).click(); }", btn)
            await page.wait_for_function("document.getElementById('bp-embedded-webchat').classList.contains('bp-ready')", timeout=8000)
            bplog = await page.evaluate("window.__bpLog")
            ev = [json.loads(e[1]) for e in bplog if e[0] == "sendEvent"]
            up = [json.loads(e[1]) for e in bplog if e[0] == "updateUser"]
            check(f"20b {loc}: start event and user data carry locale {loc}", ev and ev[0]["type"] == "start" and ev[0]["locale"] == loc and up == [{"locale": loc, "pageKey": "default", "campaign": ""}] and ["sendMessage", btn] in bplog, [ev, up])
            await ctx.close()

        # The real config/config.json: new-locale rows and campaign ids parse in the tag
        REAL = open(os.path.join(ROOT, "config/config.json"), encoding="utf-8").read()
        ctx = await b.new_context(viewport={"width": 1440, "height": 900})
        await setup(ctx, config=REAL)
        page = await ctx.new_page()
        await page.goto("https://www.spotler.com/en-au/"); await page.wait_for_timeout(1200)
        txt = await shell_text(page) or ""
        check("20c real config: en-AU uses its own * row", "Hi, I’m Mia, Spotler’s AI assistant" in txt and "Pricing" in txt, txt[:160])
        await page.goto("https://www.spotler.com/en-gb/discover/mailplus-video-overview"); await page.wait_for_timeout(1500)
        await page.evaluate("() => { const sr=document.getElementById('spotler-mia-shell').shadowRoot; sr.querySelector('.btn').click(); }")
        await page.wait_for_function("document.getElementById('bp-embedded-webchat').classList.contains('bp-ready')", timeout=8000)
        ev = [json.loads(e[1]) for e in await page.evaluate("window.__bpLog") if e[0] == "sendEvent"]
        check("20d real config: the Mail+ page sends campaign mailplus", ev and ev[0]["campaign"] == "mailplus" and ev[0]["pageKey"] == "mailplus-video-overview", ev)
        await ctx.close()

        # ---------- 21. Leadinfo: company from the data layer, behind marketing consent ----------
        LI = "window.dataLayer = window.dataLayer || []; window.dataLayer.push({event: 'leadinfo_company', company_domain: 'Example.co.uk', company_name: 'Example Ltd'});"
        async def li_chat(consent):
            ctx = await b.new_context(viewport={"width": 1440, "height": 900})
            await setup(ctx)
            if consent is not None:
                await ctx.add_init_script("window.Cookiebot = { consent: { necessary: true, preferences: true, statistics: false, marketing: " + consent + " } }")
            await ctx.add_init_script(LI)
            page = await ctx.new_page()
            await page.goto("https://www.spotler.com/en-gb/pricing"); await page.wait_for_timeout(1200)
            await page.evaluate("() => { const sr=document.getElementById('spotler-mia-shell').shadowRoot; sr.querySelector('.btn').click(); }")
            await page.wait_for_function("document.getElementById('bp-embedded-webchat').classList.contains('bp-ready')", timeout=8000)
            await page.wait_for_timeout(300)
            return ctx, page
        def events(log, t): return [json.loads(e[1]) for e in log if e[0] == "sendEvent" and json.loads(e[1]).get("type") == t]

        ctx, page = await li_chat("true")
        log = await page.evaluate("window.__bpLog")
        st = events(log, "start")
        check("21a marketing consent: company on the start event, no separate leadinfo event", st and st[0]["companyDomain"] == "example.co.uk" and st[0]["companyName"] == "Example Ltd" and not events(log, "leadinfo"), log)
        await page.goto("https://www.spotler.com/en-gb/products"); await page.wait_for_timeout(1500)
        log = await page.evaluate("window.__bpLog")
        check("21b next page, same company: page event only, no leadinfo repeat", [json.loads(e[1])["type"] for e in log if e[0] == "sendEvent"] == ["page"], log)
        await ctx.close()

        ctx, page = await li_chat("false")
        log = await page.evaluate("window.__bpLog")
        st = events(log, "start")
        check("21c no marketing consent: company not read (empty on the start event)", st and st[0]["companyDomain"] == "" and st[0]["companyName"] == "" and not events(log, "leadinfo"), st)
        await page.evaluate("window.Cookiebot.consent.marketing = true; window.dispatchEvent(new Event('CookiebotOnAccept'))")
        await page.wait_for_timeout(300)
        await page.evaluate("window.dispatchEvent(new Event('CookiebotOnAccept'))")
        await page.wait_for_timeout(300)
        li = events(await page.evaluate("window.__bpLog"), "leadinfo")
        check("21d consent given after the start: one leadinfo event with the company", li == [{"type": "leadinfo", "companyDomain": "example.co.uk", "companyName": "Example Ltd"}], li)
        await ctx.close()

        ctx, page = await li_chat(None)
        st = events(await page.evaluate("window.__bpLog"), "start")
        check("21e no Cookiebot on the page: company not read (strict, as the old hand-over tag)", st and st[0]["companyDomain"] == "", st)
        await ctx.close()

        # ---------- 14. header fit beside the open panel ----------
        for vw, expect in [(2100, None), (1920, None), (1440, None), (1366, None), (1280, None), (1200, None)]:
            ctx = await b.new_context(viewport={"width": vw, "height": 800})
            await setup(ctx)
            page = await ctx.new_page()
            await page.goto("https://www.spotler.com/en-gb/")
            await page.wait_for_timeout(900)
            r = await page.evaluate("""() => { const hdr=document.getElementById('header'), box=hdr.querySelector('.header-box');
                const lis=[...box.querySelectorAll('.main-nav > li')].filter(li=>li.offsetParent!==null); const last=lis[lis.length-1];
                const btn=box.querySelector('.header-buttons').getBoundingClientRect();
                return { levels:[1,2,3,4].filter(l=>document.body.classList.contains('mia-fit-'+l)).length,
                  storiesHidden: lis.every(li=>!/Success stories/.test(li.textContent)), aboutShown: lis.some(li=>/About/.test(li.textContent)), gap: Math.round(btn.left - last.getBoundingClientRect().right),
                  clear: Math.round(hdr.getBoundingClientRect().right - box.querySelector('.main-switcher-box').getBoundingClientRect().right),
                  logoLeft: Math.round(box.querySelector('.logo-wrapper img').getBoundingClientRect().left - hdr.getBoundingClientRect().left),
                  htmlStyle: document.documentElement.getAttribute('style'),
                  barRows: new Set([...document.querySelectorAll('.top-nav > li')].map(li=>Math.round(li.getBoundingClientRect().top))).size,
                  barRight: Math.round(hdr.getBoundingClientRect().right - document.querySelector('.top-nav > li:last-child').getBoundingClientRect().right) } }""")
            ok = r["barRows"] == 1 and r["barRight"] >= 12 and r["gap"] >= 12 and r["clear"] >= 12 and r["logoLeft"] >= 4 and r["htmlStyle"] is None and (expect is None or r["levels"] == expect)
            ok = ok and r["aboutShown"]
            if r["levels"] >= 1: ok = ok and r["storiesHidden"]
            check(f"14 header + top bar fit beside panel at {vw}px (levels {r['levels']}, Success stories {'hidden' if r['storiesHidden'] else 'shown'}, About us shown)", ok, r)
            await page.screenshot(path=f"{OUT}/14-header-{vw}.png", clip={"x": 0, "y": 0, "width": vw, "height": 140})
            if vw == 1280:
                await page.click("#spotler-agent-close"); await page.wait_for_timeout(300)
                back = await page.evaluate("[1,2,3,4].every(l=>!document.body.classList.contains('mia-fit-'+l)) && [...document.querySelectorAll('.main-nav > li')].some(li=>li.offsetParent!==null && /Success stories/.test(li.textContent))")
                back = back and await page.evaluate("getComputedStyle(document.querySelector('.top-nav-container')).marginRight === document.querySelector('.top-nav-container').style.marginRight")
                check("14 closing the panel restores the full header and top bar", back)
                await page.click("#spotler-agent-pill"); await page.wait_for_timeout(500)
                # open it and record its shift on every frame of the open animation
                d = await page.evaluate("""() => new Promise(res => { const drop=document.querySelector('.switch-drop'), seen=[];
                  document.querySelector('.main-switcher-box').click();
                  const t0=performance.now(); function f(){ seen.push(drop.style.translate);
                    if (performance.now()-t0 < 450) return requestAnimationFrame(f);
                    const r=drop.getBoundingClientRect();
                    res({ right: Math.round(document.getElementById('header').getBoundingClientRect().right - r.right), left: Math.round(r.left), shifts: [...new Set(seen)] }); } requestAnimationFrame(f); })""")
                check("16 region switcher dropdown opens clear of the panel", d["right"] >= 12 and d["left"] >= 0, d)
                check("16 dropdown opens in place (one shift from the first frame, no jump)", len(d["shifts"]) == 1 and d["shifts"][0] != "", d)
                await page.click("#spotler-agent-close"); await page.wait_for_timeout(300)
                check("16 closing the panel puts the dropdown back", await page.evaluate("!document.querySelector('.switch-drop').style.translate"))
            await ctx.close()

        # ---------- 17. demo calendar opens inside the chat ----------
        ctx = await b.new_context(viewport={"width": 1440, "height": 900})
        await setup(ctx)
        page = await ctx.new_page()
        await page.goto("https://www.spotler.com/en-gb/pricing/compare"); await page.wait_for_timeout(1200)
        await page.evaluate("""() => { const sr=document.getElementById('spotler-mia-shell').shadowRoot; [...sr.querySelectorAll('.btn')].find(b=>b.textContent==='Book a demo').click(); }""")
        await page.wait_for_function("document.getElementById('bp-embedded-webchat').classList.contains('bp-ready')", timeout=8000)
        await page.evaluate("window.__bpEmit('customEvent', { action: 'showHubSpotCalendar', url: 'https://meetings.hubspot.com/test-owner' })")
        await page.wait_for_timeout(1200)
        c = await page.evaluate("""() => { const l=document.getElementById('spotler-cal'), r=l && l.shadowRoot, v=r && r.querySelector('.c'), f=r && r.querySelector('iframe'), p=document.getElementById('spotler-agent-panel');
            return { inPanel: !!l && document.getElementById('spotler-agent-body').contains(l), shown: !!v && v.classList.contains('shown') && getComputedStyle(v).opacity === '1',
              w: Math.round(p.getBoundingClientRect().width), src: f ? f.src : '', modal: getComputedStyle(document.getElementById('hubspot-modal')).display,
              back: r ? r.querySelector('.back').textContent : '' } }""")
        check("17a calendar opens inside the chat (Mia's line, card, Cancel in the composer slot), no page modal, panel widens for HubSpot's two columns", c["inPanel"] and c["shown"] and c["w"] >= 860 and "meetings.hubspot.com/test-owner" in c["src"] and c["modal"] == "none" and c["back"] == "Cancel", c)
        await page.screenshot(path=f"{OUT}/17-calendar.png")
        await page.evaluate("document.body.style.minHeight = '3000px'")
        await page.mouse.move(900, 500); await page.mouse.wheel(0, 800); await page.wait_for_timeout(300)
        lock = await page.evaluate("() => ({ overflow: getComputedStyle(document.documentElement).overflow, scrollY: Math.round(scrollY), htmlStyle: document.documentElement.getAttribute('style') })")
        check("17j page doesn't scroll while the calendar is open (class lock, no inline style on <html>)", lock["overflow"] == "hidden" and lock["scrollY"] == 0 and lock["htmlStyle"] is None, lock)
        check("17l top bar links hidden while the wide calendar covers them (no stray letter)", await page.evaluate("getComputedStyle(document.querySelector('.top-nav-container')).visibility === 'hidden'"))
        await page.click("#spotler-cal .back"); await page.wait_for_timeout(600)
        back = await page.evaluate("() => ({ hidden: !document.getElementById('spotler-cal').classList.contains('on'), w: Math.round(document.getElementById('spotler-agent-panel').getBoundingClientRect().width), ready: document.getElementById('bp-embedded-webchat').classList.contains('bp-ready') })")
        check("17b Cancel: calendar closes, panel back to its width, chat still there", back["hidden"] and back["ready"] and back["w"] <= 400, back)
        await page.mouse.move(300, 500); await page.mouse.wheel(0, 400); await page.wait_for_timeout(300)
        check("17k after Cancel the page scrolls again, top bar links back", await page.evaluate("getComputedStyle(document.documentElement).overflow !== 'hidden' && scrollY > 0 && getComputedStyle(document.querySelector('.top-nav-container')).visibility === 'visible'"))
        await page.evaluate("scrollTo(0, 0)")
        await page.evaluate("window.__bpEmit('customEvent', { action: 'showHubSpotCalendar', url: 'https://meetings.hubspot.com/test-owner' })")
        await page.wait_for_timeout(900)
        hs = next(f for f in page.frames if "meetings.hubspot.com" in f.url)
        await hs.evaluate("document.getElementById('book').click()")  # stand-in's Confirm
        await page.wait_for_timeout(600)
        bplog = await page.evaluate("window.__bpLog")
        booked = [json.loads(e[1]) for e in bplog if e[0] == "sendEvent" and "demoBooked" in e[1]]
        check("17c booking reported to the bot (demoBooked with date, time and contact)", booked and booked[0]["meetingWhen"] and booked[0]["userEmail"] == "jo.bloggs@acme.com", booked)
        check("17h no skip-greeting flag around demoBooked (the bot never greets)", not any(e[0] == "updateUser" and "proactive" in e[1] for e in bplog), bplog[-4:])
        await page.wait_for_timeout(2000)
        done = await page.evaluate("() => ({ hidden: !document.getElementById('spotler-cal').classList.contains('on'), empty: !document.getElementById('spotler-cal').shadowRoot.querySelector('iframe') })")
        check("17d after booking the chat comes back on its own (no Cancel needed)", done["hidden"] and done["empty"], done)
        await ctx.close()

        # sizing: as tall as HubSpot's content on a big screen (chat visible above), fills a small one
        for w, h in [(1920, 1080), (1200, 700)]:
            ctx = await b.new_context(viewport={"width": w, "height": h}); await setup(ctx)
            page = await ctx.new_page()
            await page.goto("https://www.spotler.com/en-gb/pricing/compare"); await page.wait_for_timeout(1200)
            await page.evaluate("""() => { const sr=document.getElementById('spotler-mia-shell').shadowRoot; sr.querySelector('.btn').click(); }""")
            await page.wait_for_function("document.getElementById('bp-embedded-webchat').classList.contains('bp-ready')", timeout=8000)
            await page.evaluate("window.__bpEmit('customEvent', { action: 'showHubSpotCalendar', url: 'https://meetings.hubspot.com/test-owner' })")
            await page.wait_for_timeout(1600)
            hsf = next(f for f in page.frames if "meetings.hubspot.com" in f.url)
            content = await hsf.evaluate("document.documentElement.scrollHeight")
            s2 = await page.evaluate("""() => { const l=document.getElementById('spotler-cal'), r=l.shadowRoot, card=r.querySelector('.card').getBoundingClientRect(), lay=l.getBoundingClientRect(), bar=r.querySelector('.back').getBoundingClientRect();
                const f=r.querySelector('iframe'), month=f.contentDocument ? null : null;
                return { card: Math.round(card.height), above: Math.round(card.top - lay.top), room: Math.round(lay.height), barGap: Math.round(lay.bottom - bar.bottom),
                  bubble: getComputedStyle(r.querySelector('.intro')).display !== 'none', iframeTop: Math.round(f.getBoundingClientRect().top - card.top) } }""")
            s2["monthTop"] = (await hsf.evaluate("Math.round(document.querySelector('.month').getBoundingClientRect().top)")) + s2["iframeTop"]
            hdr = await hsf.evaluate("Math.round(document.querySelector('.month').getBoundingClientRect().top)")
            if w == 1920:
                check(f"17g {w}x{h}: tall screen: card stops at HubSpot's two-column height (no white block inside it)", 700 <= s2["card"] <= 722 and s2["bubble"], dict(s2, content=content))
            else:
                check(f"17g {w}x{h}: calendar fills the chat under Mia's line", s2["card"] >= s2["room"] - 160 and s2["bubble"], dict(s2, content=content))
            two = await hsf.evaluate("getComputedStyle(document.querySelector('.w')).display === 'flex'")
            check(f"17i {w}x{h}: HubSpot uncropped and in its two-column layout", -17 <= s2["iframeTop"] <= -15 and two, dict(s2, twoColumn=two))
            widths = await hsf.evaluate("window.__widths")
            check(f"17m {w}x{h}: HubSpot first loads at its real width (not 0 or mid-widen), so it picks two columns on first view", widths[0] >= 792 and min(widths) >= 792, widths)
            await page.screenshot(path=f"{OUT}/17g-{w}.png")
            await ctx.close()

        # no sideways scroll on tablets and phones with a full card (open calendar included)
        for w, h, ua in [(768, 1024, None), (390, 844, MOBILE_UA)]:
            opts = {"viewport": {"width": w, "height": h}}
            if ua: opts.update(user_agent=ua, is_mobile=True, has_touch=True)
            ctx = await b.new_context(**opts); await setup(ctx)
            page = await ctx.new_page()
            await page.goto("https://www.spotler.com/en-gb/discover/mailplus-video-overview"); await page.wait_for_timeout(1800)
            await page.evaluate("() => { const sr=document.getElementById('spotler-mia-shell').shadowRoot; sr.querySelector('.btn').click(); }")
            await page.wait_for_function("document.getElementById('bp-embedded-webchat').classList.contains('bp-ready')", timeout=9000)
            await page.evaluate("window.__bpEmit('customEvent', { action: 'showHubSpotCalendar', url: 'https://meetings.hubspot.com/test-owner' })")
            await page.wait_for_timeout(1200)
            m = await page.evaluate("() => ({ sw: document.documentElement.scrollWidth, vw: " + str(w) + ", inCard: document.getElementById('spotler-inline-body').contains(document.getElementById('spotler-cal')), card: Math.round(document.getElementById('spotler-cal').shadowRoot.querySelector('.card').getBoundingClientRect().height) })")
            check(f"17f full card at {w}px: calendar inside the card, card at least 300px tall, no sideways page scroll", m["inCard"] and m["card"] >= 300 and m["sw"] <= w, m)
            await ctx.close()

        # the half card hosts the calendar too
        ctx = await b.new_context(viewport={"width": 1440, "height": 900})
        await setup(ctx)
        page = await ctx.new_page()
        await page.goto("https://www.spotler.com/en-gb/discover/feedbackpro-x-zendesk"); await page.wait_for_timeout(1500)
        await page.evaluate("""() => { const sr=document.getElementById('spotler-mia-shell').shadowRoot; sr.querySelector('.btn').click(); }""")
        await page.wait_for_function("document.getElementById('bp-embedded-webchat').classList.contains('bp-ready')", timeout=8000)
        await page.evaluate("window.__bpEmit('customEvent', { action: 'showHubSpotCalendar', url: 'https://meetings.hubspot.com/test-owner' })")
        await page.wait_for_timeout(1200)
        h = await page.evaluate("() => ({ inCard: !!document.getElementById('spotler-cal') && document.getElementById('spotler-inline-body').contains(document.getElementById('spotler-cal')), modal: getComputedStyle(document.getElementById('hubspot-modal')).display })")
        check("17e on a half card the calendar opens inside the card", h["inCard"] and h["modal"] == "none", h)
        await page.screenshot(path=f"{OUT}/17-calendar-half.png")
        await ctx.close()

        # ---------- 18. AI disclosure: header, note and privacy link per region ----------
        ctx = await b.new_context(viewport={"width": 1440, "height": 900})
        await setup(ctx)
        page = await ctx.new_page()
        await page.goto("https://www.spotler.com/en-gb/pricing"); await page.wait_for_timeout(1200)
        ft = await page.evaluate("""() => { const sr=document.getElementById('spotler-mia-shell').shadowRoot;
            return [document.getElementById('spotler-agent-title').textContent, sr.querySelector('.mq-desc').textContent, sr.querySelector('.ft p').textContent, sr.querySelector('.ft a').href] }""")
        check("18a UK: 'Spotler AI Assistant' header, AI tagline, 'AI assistant · Privacy' linking to the UK privacy page", ft == ["Spotler AI Assistant", "Your AI marketing assistant.", "AI assistant · Privacy", "https://spotler.com/en-gb/privacy-statement"], ft)
        await page.evaluate("""() => { const sr=document.getElementById('spotler-mia-shell').shadowRoot; sr.querySelector('.btn').click(); }""")
        await page.wait_for_function("document.getElementById('bp-embedded-webchat').classList.contains('bp-ready')", timeout=8000)
        cfg = [json.loads(e[1]) for e in await page.evaluate("window.__bpLog") if e[0] == "init"][0]
        check("18b UK live chat: Botpress gets the AI description and the privacy footer", cfg.get("botDescription") == "Your AI marketing assistant." and cfg.get("footer") == "AI assistant · [Privacy](https://spotler.com/en-gb/privacy-statement)", cfg)
        await page.evaluate("window.__bpEmit('customEvent', { action: 'showHubSpotCalendar', url: 'https://meetings.hubspot.com/test-owner' })")
        await page.wait_for_timeout(900)
        cft = await page.evaluate("() => { const r=document.getElementById('spotler-cal').shadowRoot; return [r.querySelector('.ft').textContent, r.querySelector('.ft a').href] }")
        check("18c the calendar view keeps the note and link", cft == ["AI assistant · Privacy", "https://spotler.com/en-gb/privacy-statement"], cft)
        await ctx.close()

        # ---------- 19. Cookiebot: nothing kept before a chat without preferences consent ----------
        for name, prefs in [("refused", "false"), ("accepted", "true")]:
            ctx = await b.new_context(viewport={"width": 1440, "height": 900})
            await setup(ctx)
            await ctx.add_init_script("window.Cookiebot = { consent: { preferences: " + prefs + ", statistics: false, marketing: false } }")
            page = await ctx.new_page()
            await page.goto("https://www.spotler.com/en-gb/pricing"); await page.wait_for_timeout(1300)
            st = await page.evaluate("""() => ({ ls: Object.keys(localStorage), ss: Object.keys(sessionStorage),
                open: document.getElementById('spotler-agent-panel').classList.contains('open'),
                pill: getComputedStyle(document.getElementById('spotler-agent-pill')).display, bp: !!window.botpress })""")
            if prefs == "false":
                check("19a consent refused: page load writes nothing to storage, loads no Botpress, panel waits behind the pill", not st["ls"] and not st["ss"] and not st["open"] and st["pill"] == "flex" and not st["bp"], st)
                await page.click("#spotler-agent-pill"); await page.wait_for_timeout(500)
                await page.evaluate("""() => { const sr=document.getElementById('spotler-mia-shell').shadowRoot; sr.querySelector('.btn').click(); }""")
                await page.wait_for_function("document.getElementById('bp-embedded-webchat').classList.contains('bp-ready')", timeout=8000)
                st2 = await page.evaluate("() => ({ ls: Object.keys(localStorage), ss: Object.keys(sessionStorage) })")
                check("19b consent refused, visitor starts a chat: only the chat's own state is kept (no saved page table)", "spotler_mia_live" in st2["ls"] and "spotler_mia_config" not in st2["ls"], st2)
                await page.goto("https://www.spotler.com/en-gb/pricing/compare"); await page.wait_for_timeout(1500)
                check("19c consent refused: the chat still follows the visitor to the next page", await page.evaluate("document.getElementById('spotler-agent-panel').classList.contains('open') && document.getElementById('bp-embedded-webchat').classList.contains('bp-ready')"))
            else:
                check("19d consent accepted: page table saved, panel opens as usual", "spotler_mia_config" in st["ls"] and st["open"], st)
            await ctx.close()

        # consent refused after the page already kept things: they are removed
        ctx = await b.new_context(viewport={"width": 1440, "height": 900})
        await setup(ctx)
        page = await ctx.new_page()
        await page.goto("https://www.spotler.com/en-gb/pricing"); await page.wait_for_timeout(1300)
        await page.evaluate("window.Cookiebot = { consent: { preferences: false } }; window.dispatchEvent(new Event('CookiebotOnDecline'))")
        st = await page.evaluate("() => ({ ls: Object.keys(localStorage), ss: Object.keys(sessionStorage) })")
        check("19e consent declined later: the saved page table and panel state are removed", "spotler_mia_config" not in st["ls"] and "spotlerAgentState" not in st["ss"], st)
        await ctx.close()

        await b.close()

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    asyncio.run(main())
