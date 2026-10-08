# Spotler Mia lazy loader

One GTM tag that shows a static copy of the Mia chat on spotler.com. Botpress loads only when a visitor clicks a starter button, sends a typed message or clicks the teaser. The static copy then fades into the live chat once the visitor's message appears there.

Scope and decisions: *Botpress lazy loader: scope* (Claude doc) and Confluence → Botpress phase 2.

## What's in here

| Path | What it is |
| --- | --- |
| `src/` | Tag source, joined in filename order by the build. `.css` → `CSS.<name>`, `.html` → `HTML.<name>`. ES5 only (GTM Custom HTML). |
| `config/config.json` | The page table: opener, buttons, teaser and mode per URL. Published by n8n; the tag reads it from jsDelivr. |
| `build.mjs` | Builds `dist/mia-loader.gtm.html`, the file you paste into GTM. |
| `scripts/check-config.mjs` | The same row checks the n8n workflow runs before publishing. |
| `n8n/mia-page-settings.workflow.ts` | Source of the n8n form marketing uses to edit `config.json` (n8n: *Mia chat: page settings (marketing)*, Spotler AI project). |
| `test/` | Headless tests against a mocked Botpress (`python3 test/run_tests.py`). |

## Build and release

```bash
npm install
node build.mjs                # → dist/mia-loader.gtm.html (≈63 KB)
python3 test/run_tests.py     # 72 checks against a mocked Botpress
```

1. In GTM, create a Custom HTML tag "Mia lazy loader" and paste `dist/mia-loader.gtm.html`.
2. Trigger: all pages, with the same consent condition the current Botpress tags use.
3. Pause the old tags for every region switched on (`ENABLED_REGIONS`: `en-GB`, `nl`, `int`) in the **same** publish: the UK, NL and INT slide-outs and both UK campaign tags. Only one Botpress chat can load per page; the new tag stands down if it finds another `#bp-embedded-webchat`.
4. Test in GTM Preview: the console shows `[Mia] …` lines (`config from …`, `loading Botpress (new)`, `start event confirmed`, `revealed live chat`).

## Settings (`src/00-settings.js`)

| Setting | Value | Notes |
| --- | --- | --- |
| `TIMEOUT_MS` | 15 min | Must equal the Botpress inactivity timeout |
| `ENABLED_REGIONS` | `["en-GB", "nl", "int"]` | Rollout switch. Emergency off-switch without a GTM publish: add `"enabledRegions": ["en-GB"]` to `config.json` (lists the regions that stay on) |
| `LEGACY_EXCLUDE` | the campaign pages | Pages still served by the old campaign tags; the new tag stays off them until v2 |
| `INJECT_URL` | webchat v3.7 | All regions on one version |
| `LABELS` | per region | Header title, pill and footer text (naming still undecided) |
| `DEFAULT_ROWS` | per region | Used only when `config.json` can't be loaded |

## Page table (`config.json`)

Each row: `url_match`, `match_type` (`exact` · `prefix` · `contains`), `region`, `mode` (`slideout` · `half` · `full`), `page`, `route`, `opener`, `buttons` (`[{label, send}]`, up to 4), `teaser_text`, `teaser_send`, `headline`, `intro`.

- The most specific match wins: exact, then the longest prefix or contains, then the region's `*` row.
- A row only needs the columns it changes. Blank columns come from the region's `*` row.
- A blank line in `opener` starts a new bubble. The buttons attach to the last bubble.

## How a conversation works

- **First page:** the static shell renders. No Botpress requests are made.
- **Button click or typed message:** the shell shows the message and a typing indicator. The tag then:
  1. loads Botpress;
  2. sets `proactiveClickAt` (the skip-greeting gate);
  3. on the new conversation, sends `{type:"language", language, region, startPage, startUrl, pageKey, source, opener}`, then the message;
  4. fades to the live chat once the message renders there.
- **Next page:** while the conversation is live, Botpress loads straight away and the slide-out shows the history.
- **15 minutes idle, or Restart:** the tag clears only the Botpress `conversationId` (the user is kept) and the shell returns. The next message starts a new conversation.
- **`page` and `route`:** these are only sent for rows that set a `route`, so the existing Studio gates behave exactly as today.
- **dataLayer events:** `spotler_mia_start` (`miaSource`, `miaRegion`, `miaPage`), `spotler_mia_ready`, `spotler_mia_end` (`miaEndReason`).

## Modes

| Mode | Where | Devices | Notes |
| --- | --- | --- | --- |
| `slideout` | Default for every page without a row | Desktop 1200px+, no phones/tablets | Panel, pill, teaser, page squeeze. If the squeezed header doesn't fit, "About us" is hidden first, then the banner gets smaller (logo, padding, then menu text) until it does. If the top bar links wrap, their right margin (then their gaps) shrinks until they sit on one row |
| `half` | Rows set to `half` (FeedbackPro) | 1024px+, no phones/tablets | Card overlays the hero image; copy untouched. `media_selector` overrides the image pick |
| `full` | Rows set to `full` (Mail+) | All devices: the only mode on mobile | Hero hidden; `headline`, `intro` and a large card go after it. `media_selector` picks the hero media |

- A mode the device can't show means no chat on that page.
- One live conversation per visitor shows in whichever container the page uses: a chat started on a campaign card continues in the slide-out on the next page (desktop).
- `opener` bubbles can be a video: a bubble that is exactly `[video] https://…` renders a video player (no Botpress needed to play it).
- Up to 6 buttons per row.

## Regions

| Region | URLs | Language event | Notes |
| --- | --- | --- | --- |
| `en-GB` | `/en-gb/…` | `en-GB` | |
| `nl` | `/nl-nl/…` | `nl` | Dutch panel labels; Botpress's own strings ("Today", "Delivered", tagline) stay English, as in the live chat. Teaser sits beside the pill |
| `int` | everything else | `int` | |
| — | `/de-de`, `/en-de`, `/es-es`, `/sv-se`, `/en-au` and any other `/xx-xx` | — | No chat, as today |

Moving to a page in another region ends the conversation and shows that region's shell.

## Editing the page table (marketing)

The n8n form *Mia chat: page settings (marketing)* (n8n login required) does it without git:

1. Pick the region, the page URL and which URLs it covers. The next step shows that page's current settings, prefilled.
2. Edit and publish. The workflow runs the same checks as `scripts/check-config.mjs`; if one fails, nothing is published and the form lists what to fix.
3. It commits `config/config.json` to `main` (the commit message names who changed what) and purges jsDelivr, so the change shows within a few minutes.

After every publish it also refills the n8n data table *Mia chat pages* (Spotler AI project): one row per full embed, half embed and custom slide-out with its opening message, buttons and teaser, plus one "Other pages" slide-out row per region with the standard opening. The workflow's *Rebuild page list* button refills it by hand (e.g. after editing `config.json` in git).

It needs a fine-grained GitHub token (this repo only, Contents read and write) as the n8n credential *GitHub: spotler-mia-loader config*. Hand edits to `config.json` still work; purge jsDelivr after pushing them.

## Not done yet

- `/en-gb/services` (the old Mail+ test home) gets the slide-out once the old Mail+ tag is paused; add a `full` row if it should keep the card.
