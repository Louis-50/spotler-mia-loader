"""Headless tests for the Mia lazy loader, against a mocked Botpress.
Run: python3 test/run_tests.py  (after `node build.mjs`)"""
import asyncio, json, os, sys, time
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = open(os.path.join(ROOT, "dist/mia-loader.gtm.html")).read()
PAGE = open(os.path.join(ROOT, "test/mock/page.html")).read().replace("<!--TAG-->", TAG)
INJECT = open(os.path.join(ROOT, "test/mock/inject.js")).read()
BOTCFG = open(os.path.join(ROOT, "test/mock/botconfig.js")).read()
CONFIG = open(os.path.join(ROOT, "config/config.json")).read()
OUT = os.path.join(ROOT, "test/out"); os.makedirs(OUT, exist_ok=True)
AVATAR = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000" "1f15c4890000000d49444154789c63f8cfc0f01f0005000201a5f6e0540000000049454e44ae426082")

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASS " if cond else "FAIL ") + name + (("  -- " + str(detail)) if detail and not cond else ""))

async def setup(ctx, config_ok=True):
    reqs = []
    async def handler(route):
        url = route.request.url
        reqs.append(url)
        if "cdn.botpress.cloud" in url: return await route.fulfill(body=INJECT, content_type="application/javascript")
        if "files.bpcontent.cloud" in url and url.endswith(".js"): return await route.fulfill(body=BOTCFG, content_type="application/javascript")
        if url.endswith(".webp"): return await route.fulfill(body=AVATAR, content_type="image/png")
        if "cdn.jsdelivr.net" in url:
            if not config_ok: return await route.fulfill(status=500, body="")
            return await route.fulfill(body=CONFIG, content_type="application/json", headers={"access-control-allow-origin": "*"})
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
        await page.goto("https://www.spotler.com/en-gb/pricing")
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
        check("2c one start event with region/page fields", len(ev) == 1 and ev[0]["language"] == "en-GB" and ev[0]["startPage"] == "/en-gb/pricing" and ev[0]["source"] == "button" and ev[0]["pageKey"] == "pricing", ev)
        check("2d no page/route on slide-out rows", ev and "route" not in ev[0] and "page" not in ev[0], ev)
        up = [e[1] for e in bplog if e[0] == "updateUser"]
        check("2e skip-greeting flag set before start event", up and '"proactiveTopic":"Book a demo"' in up[-1] and names.index("updateUser") < names.index("sendEvent"), bplog)
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
        check("3c no second start event / message", not any(e[0] in ("sendEvent", "sendMessage") for e in bplog), bplog)

        # ---------- 4. timeout: shell returns, conversation id cleared ----------
        await page.evaluate("""() => { const l=JSON.parse(localStorage.getItem('spotler_mia_live')); l.lastActivity = Date.now() - 16*60*1000; localStorage.setItem('spotler_mia_live', JSON.stringify(l)); document.dispatchEvent(new Event('visibilitychange')); }""")
        await page.wait_for_timeout(300)
        check("4a shell back after timeout", (await shell_text(page) or "").find("Book a demo") != -1)
        check("4b webchat hidden", await page.evaluate("!document.getElementById('bp-embedded-webchat').classList.contains('bp-ready')"))
        cleared = await page.evaluate("JSON.parse(localStorage.getItem('bp-webchat-test-client-client')).state")
        check("4c Botpress conversationId cleared, user kept", "conversationId" not in cleared and cleared.get("user"), cleared)
        check("4d live record removed", await page.evaluate("localStorage.getItem('spotler_mia_live') === null"))

        # ---------- 5. engage again on same page: restart path ----------
        await page.evaluate("""() => { const sr=document.getElementById('spotler-mia-shell').shadowRoot; const ta=sr.querySelector('textarea'); ta.value='How much is Mail+?'; ta.dispatchEvent(new Event('input')); ta.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); }""")
        await page.wait_for_function("document.getElementById('bp-embedded-webchat').classList.contains('bp-ready')", timeout=8000)
        bplog = await page.evaluate("window.__bpLog")
        names = [e[0] for e in bplog]
        check("5a restartConversation used", "restartConversation" in names, names)
        ev = [json.loads(e[1]) for e in bplog if e[0] == "sendEvent"]
        check("5b start event for the new conversation, source typed", ev and ev[-1]["source"] == "typed", ev)
        check("5c typed message sent", ["sendMessage", "How much is Mail+?"] in bplog, bplog)

        # ---------- 6. restart button: shell returns ----------
        await page.click("#spotler-agent-restart")
        await page.wait_for_timeout(300)
        check("6a restart brings shell back", (await shell_text(page) or "").find("Book a demo") != -1)
        check("6b live cleared", await page.evaluate("localStorage.getItem('spotler_mia_live') === null"))
        await ctx.close()

        # ---------- 7. guards ----------
        for name, url, vw in [("7a NL not enabled yet", "https://www.spotler.com/nl-nl/", 1440),
                              ("7b legacy campaign page untouched", "https://www.spotler.com/en-gb/discover/mailplus-video-overview", 1440),
                              ("7c off below 1200px", "https://www.spotler.com/en-gb/", 1100)]:
            ctx = await b.new_context(viewport={"width": vw, "height": 900})
            reqs = await setup(ctx)
            page = await ctx.new_page()
            await page.goto(url); await page.wait_for_timeout(600)
            check(name, await page.evaluate("!document.getElementById('spotler-agent-panel')") and not bp_requests(reqs))
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
        await page.goto("https://www.spotler.com/en-gb/pricing")
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
        await b.close()

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    asyncio.run(main())
