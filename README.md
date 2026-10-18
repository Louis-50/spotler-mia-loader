# Spotler Mia lazy loader

One GTM tag that shows a static copy of the Mia chat on spotler.com. Botpress loads only when a visitor clicks a starter button, sends a typed message or clicks the teaser. The static copy then fades into the live chat once the visitor's message appears there.

Scope and decisions: *Botpress lazy loader: scope* (Claude doc) and Confluence → Botpress phase 2.

Current status, what changed in Botpress and open items: [`docs/STATUS.md`](docs/STATUS.md). Bot test plans: `docs/botpress-test-plan*.md`.

## What's in here

| Path | What it is |
| --- | --- |
| `src/` | Tag source, joined in filename order by the build. `.css` → `CSS.<name>`, `.html` → `HTML.<name>`. ES5 only (GTM Custom HTML). |
| `config/config.json` | The page table: opener, buttons, teaser and mode per URL. Published by n8n; the tag reads it from GitHub (`raw.githubusercontent.com`, live ~5 min after a commit), with jsDelivr as backup. |
| `build.mjs` | Builds `dist/mia-loader.gtm.html`, the file you paste into GTM. |
| `scripts/check-config.mjs` | The same row checks the n8n workflow runs before publishing. |
| `n8n/mia-page-settings.workflow.ts` | Source of the n8n form marketing uses to edit `config.json` (n8n: *Mia chat: page settings (marketing)*, Spotler AI project). |
| `test/` | Headless tests against a mocked Botpress (`python3 test/run_tests.py`). |
| `docs/` | Status and open items, Botpress change log, test plans for the bot |

## Build and release

```bash
npm install
node build.mjs                # → dist/mia-loader.gtm.html (≈82 KB)
python3 test/run_tests.py     # 134 checks against a mocked Botpress (Windows: python or py; needs `pip install playwright` + `playwright install chromium`)
```

1. In GTM, create a Custom HTML tag "Mia lazy loader" and paste `dist/mia-loader.gtm.html`. The build warns if `BOT_ID` or `CLIENT_ID` isn't a Botpress id: don't paste that build. The live build needs `CONFIG_BRANCH: "main"` (the staging build reads `v1.5`); the n8n form only publishes to `main`.
2. Trigger: all pages. The tag reads Cookiebot itself (see *Consent*), so it needs no consent condition of its own; Cookiebot must load before it (page `<head>`).
3. Pause the old tags for every region switched on (`ENABLED_REGIONS`: all eight locales) in the **same** publish: the UK, NL and INT slide-outs, both UK campaign tags and the *Leadinfo → Botpress Hand-over* tag (v128; the tag now does its job, and its `updateUser` would overwrite the tag's user data). Keep *Leadinfo - Data Layer Push* (v121). Only one Botpress chat can load per page; the new tag stands down if it finds another `#bp-embedded-webchat`.
4. Test in GTM Preview: the console shows `[Mia] …` lines (`config from …`, `loading Botpress (new)`, `start event confirmed`, `revealed live chat`, `page event sent`, `end event sent`).

**Rollback** to the Studio bot: paste the previous tag back into GTM (the last Studio build is v1.5.1: `git show 1ee582d:dist/mia-loader.gtm.html`; or GTM's own version history). Switching only `BOT_ID` / `CLIENT_ID` back to the Studio ids (kept in a comment) is not enough: the Studio bot reads the v1 contract (`type:"language"`, `proactiveClickAt`) that v1.6 no longer sends.

## Settings (`src/00-settings.js`)

| Setting | Value | Notes |
| --- | --- | --- |
| `TIMEOUT_MS` | 15 min | Must equal the Botpress inactivity timeout |
| `BOT_ID`, `CLIENT_ID` | mia-dev (ADK) | The bot and its webchat client (dashboard → bot → Webchat → Share). The tag loads `inject.js` and calls `botpress.init` itself; no bot config script is loaded. The Studio ids are kept in a comment; see *Rollback* |
| `ENABLED_REGIONS` | all eight locales | Rollout switch. Emergency off-switch without a GTM publish: add `"enabledRegions": ["en-GB"]` to `config.json` (lists the regions that stay on; locale by locale at the switch) |
| `LEADINFO_*` | `leadinfo_company`, consent `marketing` | Where the company comes from and the Cookiebot category it needs. `LEADINFO_REQUIRE_CONSENT: false` if Legal rules no consent is needed |
| `LEGACY_EXCLUDE` | `[]` | Pages the tag stays off (none now: the campaign pages are rows in `config.json`) |
| `CONFIG_BRANCH` | `"v1.5"` (staging build) | The git branch `config.json` is read from; `CONFIG_URLS` is built from it. The staging build reads `v1.5` (campaign column, new-locale rows). **At the switch, merge `v1.5` and set it back to `"main"`** before the live build |
| `CONFIG_URLS` | GitHub raw, then jsDelivr, on `CONFIG_BRANCH` | Where the page table is read from (see *Page table*) |
| `INJECT_URL` | webchat v3.7 | All regions on one version |
| `LABELS` | per region | Header title, tagline, pill, placeholder, the "AI assistant · Privacy" footer and its privacy link, calendar texts |
| `BOT_TEXT` | English | The strings in the bot's own Botpress config script, swapped for `LABELS` in the live chat |
| `DEFAULT_ROWS` | per region | Used only when `config.json` can't be loaded (AI-disclosure openers too) |

## Page table (`config.json`)

Each row: `url_match`, `match_type` (`exact` · `prefix` · `contains`), `region`, `mode` (`slideout` · `half` · `full`), `page`, `campaign`, `opener`, `buttons` (`[{label, send}]`, up to 6), `teaser_text`, `teaser_send`, `headline`, `intro`.

- `campaign`: the bot's campaign profile (`mailplus`, `feedbackpro`), set on the Mail+ and FeedbackPro rows. It replaces the Studio `route` column, which tag v1.6 no longer reads. Tag v1.4.1/v1.5.1 (live, reading `config.json` from `main`) ignores `campaign` and rows for regions it doesn't know, so the file stays compatible with both.
- The new locales' `*` rows are copies of the INT row (English) until marketing writes local copy.

- The most specific match wins: exact, then the longest prefix or contains, then the region's `*` row.
- A row only needs the columns it changes. Blank columns come from the region's `*` row.
- A blank line in `opener` starts a new bubble. The buttons attach to the last bubble.
- Loading: the tag waits up to 1.5 s for the live file, else uses the browser's saved copy (or `DEFAULT_ROWS` on a first visit). A live file that lands later still takes over the teaser and opener on that page, unless the visitor is typing or chatting.
- Every first message must say Mia is an AI ("Hi, I'm Mia, Spotler's AI assistant…"): EU AI Act transparency.

## How a conversation works

- **First page:** the static shell renders. No Botpress requests are made.
- **Button click or typed message:** the shell shows the message and a typing indicator. The tag then:
  1. loads Botpress;
  2. on `webchat:initialized`, writes `updateUser({ data: { locale, pageKey, campaign } })` (the ordering guard: the bot may see the message before the start event);
  3. on the new conversation, sends the start event, then the message;
  4. fades to the live chat once the message renders there.
- **Next page:** while the conversation is live, Botpress loads straight away, the slide-out shows the history and the tag sends a `page` event.
- **15 minutes idle, or Restart:** the tag sends an `end` event, clears only the Botpress `conversationId` (the user is kept) and the shell returns. The next message starts a new conversation (`restartConversation()`, user data again, a new start event). A closed tab sends nothing; the bot's own 15-minute expiry covers it.
- **dataLayer events:** `spotler_mia_start` (`miaSource`, `miaRegion`, `miaPage`), `spotler_mia_ready`, `spotler_mia_end` (`miaEndReason`).
- **Webchat init:** the tag's `botpress.init` configuration must carry `version: "v2"`, or webchat v3.7 parses it as a legacy config, ignores `embeddedChatId` and falls back to a floating button. Server-side webchat settings (the bot's dashboard / `adk integrations configure webchat`) do not reach a direct init; only `allowedOrigins` matters, because the server enforces it.

## Website contract v2 (tag → bot)

All through `window.botpress.sendEvent(payload)`; the bot (ADK, `src/lib/website-events.ts`) never replies to them. The full contract is section 1 of the bot's `docs/build-spec.md`.

| Event | When | Payload |
| --- | --- | --- |
| `start` | Once per conversation, right before the first message | `{type:"start", version:2, locale, startPage, startUrl, pageKey, source, opener, campaign, companyDomain, companyName}`. `locale` is one of `int`, `en-GB`, `nl`, `de-DE`, `en-DE`, `es-ES`, `sv-SE`, `en-AU`; `pageKey` is `default` without a row; `source` is `button`, `typed`, `teaser` (or `open` for the mic with nothing typed); `opener` is the first bubble, max 500 characters |
| `page` | Each later page view while the conversation is live | `{type:"page", page, url, pageKey, title}` |
| `leadinfo` | The company becomes readable after the start (consent given later, or it arrives on a later page); once per company per conversation | `{type:"leadinfo", companyDomain, companyName}` |
| `end` | Before the tag ends a conversation | `{type:"end", reason:"timeout" \| "restart"}` |
| `demoBooked` | HubSpot reports a booking | unchanged, see *Demo calendar* |

The v1 `language` event and `proactiveClickAt` / `proactiveTopic` are gone (the bot never greets).

**Leadinfo:** GTM's *Leadinfo - Data Layer Push* tag pushes `{event:"leadinfo_company", company_domain, company_name}` on every page. The tag reads the last such entry only with Cookiebot `marketing` consent (no Cookiebot means no consent, as in the old hand-over tag). Known at the start: on the start event; otherwise a `leadinfo` event on `CookiebotOnAccept`, on a later page or on the 30-second check.

## Modes

| Mode | Where | Devices | Notes |
| --- | --- | --- | --- |
| `slideout` | Default for every page without a row | Desktop 1200px+, no phones/tablets | Panel, pill, teaser, page squeeze. If the squeezed header doesn't fit, "Success stories" is hidden first, then the banner gets smaller (logo, padding, then menu text) until it does. If the top bar links wrap, their right margin (then their gaps) shrinks until they sit on one row |
| `half` | Rows set to `half` (FeedbackPro) | 1024px+, no phones/tablets | Card overlays the hero image; copy untouched. `media_selector` overrides the image pick. A page without a hero picture beside the headline (at least 240×240, not behind it) gets the slide-out instead |
| `full` | Rows set to `full` (Mail+) | All devices: the only mode on mobile | Hero hidden; `headline`, `intro` and a large card go after it. `media_selector` picks the hero media |

- A mode the device can't show means no chat on that page. A half or full card that finds no place on the page falls back to the slide-out.
- One live conversation per visitor shows in whichever container the page uses: a chat started on a campaign card continues in the slide-out on the next page (desktop).
- `opener` bubbles can be a video: a bubble that is exactly `[video] https://…` renders a video player (no Botpress needed to play it).
- Up to 6 buttons per row.

## Regions

| Region | URLs | `locale` sent | Notes |
| --- | --- | --- | --- |
| `en-GB` | `/en-gb/…` | `en-GB` | |
| `nl` | `/nl-nl/…` | `nl` | Dutch in the preview and the live chat: the tag passes its labels to `botpress.init` and swaps Botpress's fixed strings ("Delivered" → "Afgeleverd"). Teaser sits beside the pill |
| `de-DE` | `/de-de/…` | `de-DE` | German labels and built-in row |
| `en-DE` | `/en-de/…` | `en-DE` | INT labels and built-in row |
| `es-ES` | `/es-es/…` | `es-ES` | Spanish labels and built-in row |
| `sv-SE` | `/sv-se/…` | `sv-SE` | Swedish labels and built-in row |
| `en-AU` | `/en-au/…` | `en-AU` | INT labels and built-in row |
| `int` | everything else | `int` | |
| — | any other `/xx-xx` | — | No chat |

The region id is the `region` value in `config.json`. The new locales' privacy link is the INT page until each locale's own is confirmed.

Moving to a page in another region ends the conversation and shows that region's shell.

## AI disclosure, privacy and consent

- **Header and footer:** "Spotler AI Assistant" / "Your AI marketing assistant." and a permanent footer "AI assistant · Privacy" (NL "AI-assistent · Privacy") in the preview, the live chat and the calendar view. Privacy links to `spotler.com/en-gb/privacy-statement`, `/nl-nl/privacy-statement` or `/privacy-statement`.
- **Live chat:** the tag calls `botpress.init` once, after every `botpress.on()` listener is attached, with `botId`, `clientId`, `selector` and a `configuration` of `version: "v2"`, `embeddedChatId: "bp-embedded-webchat"`, `botName`, `botDescription`, `composerPlaceholder` and `footer` from `LABELS`, `botAvatar` (the shell's `AVATAR_URL`), `storageLocation: "localStorage"`, `proactiveMessageEnabled: false`, `conversationHistory: true`, and the shell's theme (`color: "#002A4D"`, `themeMode: "light"`, `variant` and `headerVariant` `"solid"`, `radius: 4` = the shell's 24px bubbles, `fontFamily: "inter"`). A shadow-DOM pass swaps what Botpress doesn't expose and hides the "Today" date line.
- **Consent:** with Cookiebot on the page and no *preferences* consent, nothing is written to browser storage before a chat starts. The page table isn't saved, panel state stays in memory, and the panel waits behind the pill instead of opening by itself. Starting a chat keeps the chat's own state (`spotler_mia_live`, Botpress's `bp-webchat-*`). A later decline removes what was saved. Pages without Cookiebot behave as before.
- **Bot side:** AI answers, hand-off wording and the privacy line before email requests live in the bot (Studio for v1.5.1, the ADK bot `mia-dev` / `mia-live` from v1.6). See `docs/STATUS.md`.

## Demo calendar

The bot's `showHubSpotCalendar` custom event opens HubSpot's scheduler inside the chat (the slide-out widens for HubSpot's two columns; half and full cards host it in place), with Cancel, page-scroll lock and the footer note. After a booking the tag sends `{type:"demoBooked", userEmail, ownerName, meetingDateFormatted, meetingTime, …}` to the bot and returns to the chat. HubSpot only starts loading once the panel has its final width, so it shows two columns from the first view.

## Editing the page table (marketing)

The n8n form *Mia chat: page settings (marketing)* (n8n login required) does it without git:

1. Pick the region, the page URL and which URLs it covers. The next step shows that page's current settings, prefilled.
2. Edit and publish. The workflow runs the same checks as `scripts/check-config.mjs`; if one fails, nothing is published and the form lists what to fix.
3. It commits `config/config.json` to `main` (the commit message names who changed what) and purges the jsDelivr backup. The change shows on the site within about 5 minutes.

After every publish it also refills the n8n data table *Mia chat pages* (Spotler AI project): one row per full embed, half embed and custom slide-out with its opening message, buttons and teaser, plus one "Other pages" slide-out row per region with the standard opening. The workflow's *Rebuild page list* button refills it by hand (e.g. after editing `config.json` in git).

It needs a fine-grained GitHub token (this repo only, Contents read and write) as the n8n credential *GitHub: spotler-mia-loader config*. Hand edits to `config.json` pushed to `main` work the same way.

## Not done yet

See the open items in [`docs/STATUS.md`](docs/STATUS.md).
