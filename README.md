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
| `test/` | Headless tests against a mocked Botpress (`python3 test/run_tests.py`). |

## Build and release

```bash
npm install
node build.mjs                # → dist/mia-loader.gtm.html (≈45 KB)
python3 test/run_tests.py     # 33 checks against a mocked Botpress
```

1. In GTM, create a Custom HTML tag "Mia lazy loader" and paste `dist/mia-loader.gtm.html`.
2. Trigger: all pages, with the same consent condition the current Botpress tags use.
3. Add the regions that are switched on (`ENABLED_REGIONS`, default `en-GB`) as **exceptions on the old slide-out tag for that region**, so only one chat loads.
4. Test in GTM Preview: the console shows `[Mia] …` lines (`config from …`, `loading Botpress (new)`, `start event confirmed`, `revealed live chat`).

## Settings (`src/00-settings.js`)

| Setting | Value | Notes |
| --- | --- | --- |
| `TIMEOUT_MS` | 15 min | Must equal the Botpress inactivity timeout |
| `ENABLED_REGIONS` | `["en-GB"]` | Rollout switch; `config.json` can override it with `enabledRegions` |
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

## Not in v1

- Half-page and centre full-page modes (rows with those modes fall back to the slide-out).
- Mobile.
- Moving the NL and INT regions over. NL needs its Dutch default row first.
