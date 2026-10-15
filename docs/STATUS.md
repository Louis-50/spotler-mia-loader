# Mia chat: status and open items

Last updated: 15 Oct 2026

## Where things live

| What | Where |
|---|---|
| Lazy loader tag (GTM) | this repo, `src/` → `node build.mjs` → `dist/mia-loader.gtm.html`. Current version: **1.5.1** |
| Page table (openers, buttons, teasers, modes) | `config/config.json` on `main`, edited through the n8n form "Mia chat: page settings (marketing)" |
| Bot logic, greetings, AI prompts, email capture | **Botpress Studio** (not in this repo) |
| Detailed log of Botpress edits | `docs/botpress-changes.md` |
| Test plans for the bot | `docs/botpress-test-plan.md`, `docs/botpress-test-plan-2.md` |

## AI / privacy compliance (Russell's request, Oct 2026): done and live

**Lazy loader (tag 1.5.x + page table)**
- Every first message says "Hi, I'm Mia, Spotler's AI assistant…" (NL: "Hoi, ik ben Mia, de AI-assistent van Spotler…"), including campaign pages and the tag's built-in fallback.
- Header "Spotler AI Assistant" / "Spotler AI-assistent", tagline "Your AI marketing assistant." / "Jouw AI-marketingassistent.".
- Permanent footer "AI assistant · Privacy" (NL "AI-assistent · Privacy") in the chat preview, the live Botpress chat and the calendar view. It links to `spotler.com/en-gb/privacy-statement`, `/nl-nl/privacy-statement` or `/privacy-statement`.
- Cookiebot: without preferences consent, nothing is written to browser storage and Botpress isn't loaded until the visitor starts a chat. A later decline removes what was stored before.
- "Today" date line removed (preview and live chat).

**Botpress (published 15 Oct)**
- Greetings (EN-GB, INT, NL) use the AI wording above, with no `{{firstName}}` and no "Spotler Agent".
- Campaign intros (FeedbackPro route C, Mail+ route B) say AI. The Mail+ video was removed. These routes aren't sent by the site any more.
- AI prompts: when asked, the bot says clearly it is an AI ("No, I'm not a person. I'm Mia, Spotler's AI assistant."). It never promises to connect or transfer the visitor or that someone will contact them, and never greets mid-conversation.
- Fixed texts reworded: sales ("contact our sales team"), support ("Our Help Center can help with this…"), pricing ("you can book a short demo call").
- Nova is described as Spotler's AI help assistant.
- Demo email capture: a friendly retry message, 1 retry, and a failure path to the AI so a question gets answered.
- The privacy line from Russell appears before every email request (fixed cards plus an AI-prompt rule), linking to the region's privacy statement.
- Booking confirmation uses the real booking details (owner, date, time, email). The `booking_event` hook stores `user.demoBookedDateFormatted` and `user.demoBookedTime`.
- Bug fix: `user.skipgreeting = 'true'` (text) in the Back_to_INT and Help Center code cards. Before this, the main greeting reappeared mid-conversation.
- Help Center UK CRM link → `https://crm.spotler.help/hc/en-gb`.
- Help Center UK Autonomous1 was accidentally deleted and rebuilt by hand (same instructions and exits; knowledge base set to INT Knowledge Base). Smoke test passed.

**Answers given to Russell**
- AI providers via Botpress: OpenAI (GPT-4.1, GPT-4.1 Mini, GPT-4o for images), Anthropic (Claude, some nodes), Google (Gemini, fallback).
- Other data flows: transcript email to two staff; a Botpress "improvement" integration (receives every AI turn); web search on the visitor's company domain; Leadinfo; HubSpot (demo bookings).

## Open items

**Check after the last Botpress publish**
- [ ] Privacy line + link before the email question on `/en-gb/` and `/nl-nl/` (only INT was tested in the emulator).
- [ ] "Book a demo" straight after opening still shows no greeting.
- [ ] Help Center UK → CRM link opens `crm.spotler.help/hc/en-gb`.
- [ ] Real test booking: the confirmation shows owner, date and time with no gaps (cancel the booking in HubSpot afterwards).
- [ ] Optional: full retest with `docs/botpress-test-plan-2.md` (only smoke tests ran).

**Owed to Russell**
- [ ] Botpress hosting region and conversation retention (from the Botpress DPA or support).
- [ ] What the Botpress "improvement" integration is (third party? privacy page?).
- [ ] Russell: add the chatbot section to the three privacy statement pages.

**Known bugs**
- [ ] "What can Spotler do for me?" → answering "I don't have a website" gives "Sorry, an error occurred" and ends the chat. Standard9 runs the web search even with no website; it needs a branch to the fallback. flow-en-gb Standard1's On Failure path pointed to a missing INT node.
- [ ] Transcript emails go to two named people, not a shared inbox.

**Page table hosting**
- [ ] If the tag reads the page table from `marketing.spotler.com/botpress/config.json`, n8n form edits (which commit to GitHub only) won't reach the site. Either n8n also publishes to the subdomain, or the file is re-uploaded after every change. The subdomain also needs `Access-Control-Allow-Origin` (spotler.com or `*`).

**Minor**
- [ ] Timeouts differ: the tag ends a conversation after 15 min idle (`TIMEOUT_MS`), Botpress after 20 min. Set both to the same value.
- [ ] Mail+ campaign flow has no skip-greeting check (route unused).
- [ ] Only "Today" / "Vandaag" date lines are hidden, not "Yesterday" etc.
- [ ] The Botpress share link still shows the old tagline and "Powered by Spotler AI" (the website overrides both).
- [ ] Help Center NL Connect and CRM cards link to en-gb help pages (no NL pages exist).
