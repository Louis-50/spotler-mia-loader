// n8n workflow "Mia chat: page settings (marketing)", n8n Workflow SDK source.
// The live workflow in n8n is the source of truth. Added there after this file:
// a "Rebuild page list" manual trigger and the "Page list table" group
// (Clear page list -> Build page list -> Save page list, code in
// n8n/build-page-list.js), fed from "Commit to GitHub" after every publish.
import { workflow, node, trigger, sticky, newCredential, ifElse, expr } from '@n8n/workflow-sdk';

const choosePage = trigger({
  type: 'n8n-nodes-base.formTrigger',
  version: 2.6,
  config: {
    name: 'Choose a page',
    position: [0, 300],
    parameters: {
      authentication: 'n8nUserAuth',
      formTitle: 'Mia chat: page settings',
      formDescription: 'Change what the Mia chat says on a spotler.com page. Pick the page first; the next step shows its current settings so you can edit them. Changes go live within a few minutes.',
      formFields: {
        values: [
          { fieldName: 'action', fieldLabel: 'What do you want to do?', fieldType: 'radio', requiredField: true, defaultValue: 'Add or change a page',
            fieldOptions: { values: [{ option: 'Add or change a page' }, { option: 'Remove a page (it goes back to the region default)' }] } },
          { fieldName: 'region', fieldLabel: 'Region', fieldType: 'dropdown', requiredField: true, defaultValue: 'UK (/en-gb pages)',
            fieldOptions: { values: [{ option: 'UK (/en-gb pages)' }, { option: 'Netherlands (/nl-nl pages)' }, { option: 'International (all other pages)' }] } },
          { fieldName: 'url', fieldLabel: 'Page URL', fieldType: 'text', requiredField: true,
            placeholder: 'e.g. /en-gb/pricing or the full link. Use * for the default of the whole region.' },
          { fieldName: 'match', fieldLabel: 'Which URLs?', fieldType: 'dropdown', requiredField: true, defaultValue: 'This exact page only',
            fieldOptions: { values: [{ option: 'This exact page only' }, { option: 'This page and every page under it' }, { option: 'Any URL that contains this text' }] } }
        ]
      },
      options: { appendAttribution: false, buttonLabel: 'Next' }
    }
  },
  output: [{ action: 'Add or change a page', region: 'UK (/en-gb pages)', url: '/en-gb/pricing', match: 'This exact page only', user: { email: 'louis.grieves@spotler.com' } }]
});

const readConfig = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Read current config',
    position: [220, 300],
    parameters: {
      method: 'GET',
      url: 'https://api.github.com/repos/Louis-50/spotler-mia-loader/contents/config/config.json?ref=main',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'githubApi',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: { parameters: [{ name: 'Accept', value: 'application/vnd.github+json' }] }
    },
    credentials: { githubApi: newCredential('GitHub: spotler-mia-loader config') }
  },
  output: [{ sha: 'abc123', content: 'eyJyb3dzIjpbXX0=', encoding: 'base64' }]
});

const findRow = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Find the page row',
    position: [440, 300],
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: "const f = $('Choose a page').first().json;\nconst pick = (name, label) => String(f[name] ?? f[label] ?? '').trim();\n\nconst REGIONS = { 'UK (/en-gb pages)': 'en-GB', 'Netherlands (/nl-nl pages)': 'nl', 'International (all other pages)': 'int' };\nconst MATCHES = { 'This exact page only': 'exact', 'This page and every page under it': 'prefix', 'Any URL that contains this text': 'contains' };\n\nconst action = /^remove/i.test(pick('action', 'What do you want to do?')) ? 'remove' : 'upsert';\nconst region = REGIONS[pick('region', 'Region')] || 'en-GB';\nlet match = MATCHES[pick('match', 'Which URLs?')] || 'exact';\nlet url = pick('url', 'Page URL');\ntry { if (/^https?:\\/\\//i.test(url)) url = new URL(url).pathname; } catch (e) {}\nurl = url.toLowerCase().split('?')[0].split('#')[0];\nif (url.length > 1 && url !== '*') url = url.replace(/\\/+$/, '');\nif (url === '*' || url === '') { url = '*'; match = 'prefix'; }\n\nconst res = $('Read current config').first().json;\nconst cfg = JSON.parse(Buffer.from(String(res.content || ''), 'base64').toString('utf8'));\nconst same = r => r.region === region && (r.match_type || 'prefix') === match && String(r.url_match).toLowerCase() === url;\nconst existing = cfg.rows.find(same) || null;\n\nconst ex = existing || {};\nconst DISPLAY = { slideout: 'Slide-out panel (default)', half: 'Half card over the hero image', full: 'Full card on the page' };\nconst buttons = (ex.buttons || []).map(b => (b.send && b.send !== b.label) ? b.label + ' => ' + b.send : b.label).join('\\n');\nconst status = existing\n  ? 'Editing the existing settings for ' + url + ' (' + region + '). Change what you need and submit.'\n  : 'No settings yet for ' + url + ' (' + region + '). Fill in what this page should show.';\n\nconst formFields = [\n  { fieldLabel: 'Display', fieldType: 'dropdown', requiredField: true, defaultValue: DISPLAY[ex.mode || 'slideout'],\n    fieldOptions: { values: Object.values(DISPLAY).map(o => ({ option: o })) } },\n  { fieldLabel: 'Opening message', fieldType: 'textarea', defaultValue: ex.opener || '',\n    placeholder: \"A blank line starts a new bubble. A bubble that is just [video] https://... shows a video. Leave empty to use the region's default greeting (slide-out only).\" },\n  { fieldLabel: 'Buttons', fieldType: 'textarea', defaultValue: buttons,\n    placeholder: 'One button per line, up to 6. Write \"Label => message sent\" if the message differs from the label.' },\n  { fieldLabel: 'Teaser bubble text', fieldType: 'text', defaultValue: ex.teaser_text || '', placeholder: 'Slide-out only. Shown next to the pill after 4 seconds.' },\n  { fieldLabel: 'Message sent when the teaser is clicked', fieldType: 'text', defaultValue: ex.teaser_send || '', placeholder: 'Leave empty to send the teaser text itself' },\n  { fieldLabel: 'Headline', fieldType: 'text', defaultValue: ex.headline || '', placeholder: 'Full card only' },\n  { fieldLabel: 'Intro line', fieldType: 'text', defaultValue: ex.intro || '', placeholder: 'Full card only' },\n  { fieldLabel: 'Page key', fieldType: 'text', defaultValue: ex.page || '', placeholder: 'Short name for reporting, e.g. pricing' },\n  { fieldLabel: 'Route (advanced)', fieldType: 'text', defaultValue: ex.route || '', placeholder: 'Leave as it is unless the bot team asks' },\n  { fieldLabel: 'Hero media selector (advanced)', fieldType: 'text', defaultValue: ex.media_selector || '', placeholder: 'Leave empty unless the card picks the wrong image' }\n];\n\nreturn [{ json: { action, region, match_type: match, url_match: url, existing, sha: res.sha, cfg, status, formFields } }];\n" }
  },
  output: [{ action: 'upsert', region: 'en-GB', match_type: 'exact', url_match: '/en-gb/pricing', existing: null, sha: 'abc123', status: 'No settings yet', formFields: [] }]
});

const isRemove = ifElse({
  version: 2.3,
  config: {
    name: 'Removing the page?',
    position: [660, 300],
    parameters: {
      conditions: {
        combinator: 'and',
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ leftValue: expr('{{ $json.action }}'), rightValue: 'remove', operator: { type: 'string', operation: 'equals' } }]
      }
    }
  }
});

const pageSettings = node({
  type: 'n8n-nodes-base.form',
  version: 2.5,
  config: {
    name: 'Page settings',
    position: [880, 400],
    parameters: {
      operation: 'page',
      defineForm: 'json',
      jsonOutput: expr('{{ JSON.stringify($json.formFields) }}'),
      options: {
        formTitle: expr('{{ $json.url_match }} ({{ $json.region }})'),
        formDescription: expr('{{ $json.status }}'),
        buttonLabel: 'Publish',
        appendAttribution: false
      }
    }
  },
  output: [{ 'Display': 'Slide-out panel (default)', 'Opening message': 'Hi!', 'Buttons': 'Book a demo' }]
});

const applyChange = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Apply and check',
    position: [1100, 300],
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: "const base = $('Find the page row').first().json;\nconst trig = $('Choose a page').first().json;\nlet p = {};\ntry { p = $('Page settings').first().json; } catch (e) { p = {}; }\nconst pick = (label) => String(p[label] ?? '').replace(/\\r\\n/g, '\\n').trim();\n\nconst MODES = { 'Slide-out panel (default)': 'slideout', 'Half card over the hero image': 'half', 'Full card on the page': 'full' };\nconst cfg = JSON.parse(JSON.stringify(base.cfg));\nconst same = r => r.region === base.region && (r.match_type || 'prefix') === base.match_type && String(r.url_match).toLowerCase() === base.url_match;\nconst idx = cfg.rows.findIndex(same);\nconst errors = [];\nlet row = null;\n\nif (base.action === 'remove') {\n  if (idx === -1) errors.push('There are no settings for ' + base.url_match + ' (' + base.region + ') to remove.');\n  else if (base.url_match === '*') errors.push(\"The region's default row can't be removed, only changed.\");\n  else cfg.rows.splice(idx, 1);\n} else {\n  row = { url_match: base.url_match, match_type: base.match_type, region: base.region };\n  const mode = MODES[pick('Display')] || 'slideout';\n  if (mode !== 'slideout' || base.url_match === '*') row.mode = mode;\n  const set = (k, v) => { if (v) row[k] = v; };\n  set('page', pick('Page key'));\n  set('route', pick('Route (advanced)'));\n  set('opener', pick('Opening message'));\n  const buttons = pick('Buttons').split('\\n').map(l => l.trim()).filter(Boolean).map(l => {\n    const i = l.indexOf('=>');\n    const label = (i === -1 ? l : l.slice(0, i)).trim();\n    const send = (i === -1 ? '' : l.slice(i + 2)).trim();\n    return { label, send: send || label };\n  });\n  if (buttons.length) row.buttons = buttons;\n  set('teaser_text', pick('Teaser bubble text'));\n  set('teaser_send', pick('Message sent when the teaser is clicked'));\n  set('headline', pick('Headline'));\n  set('intro', pick('Intro line'));\n  set('media_selector', pick('Hero media selector (advanced)'));\n  if (idx === -1) {\n    const lastOfRegion = cfg.rows.map(r => r.region).lastIndexOf(base.region);\n    cfg.rows.splice(lastOfRegion === -1 ? cfg.rows.length : lastOfRegion + 1, 0, row);\n  } else cfg.rows[idx] = row;\n}\n\n// Same checks as scripts/check-config.mjs in the repo.\nconst REGIONS = ['en-GB', 'int', 'nl'];\nconst LIMITS = { opener: 1200, teaser_text: 200, teaser_send: 300, headline: 200, intro: 400 };\nconst NAMES = { opener: 'the opening message', teaser_text: 'the teaser text', teaser_send: 'the teaser message', headline: 'the headline', intro: 'the intro line' };\nconst seen = new Set();\ncfg.rows.forEach((r, i) => {\n  const at = (r === row ? 'This page' : 'Row ' + (i + 1) + ' (' + (r.url_match || '?') + ')');\n  const url = String(r.url_match || '');\n  if (!url) errors.push(at + ': the URL is empty');\n  else if (url !== '*' && r.match_type !== 'contains' && !url.startsWith('/')) errors.push(at + ': the URL must start with / (or be * for the region default)');\n  if (!REGIONS.includes(r.region)) errors.push(at + ': unknown region');\n  if (r.region === 'en-GB' && url.startsWith('/') && r.match_type !== 'contains' && !url.startsWith('/en-gb')) errors.push(at + ': UK pages must start with /en-gb');\n  if (r.region === 'nl' && url.startsWith('/') && r.match_type !== 'contains' && !url.startsWith('/nl-nl')) errors.push(at + ': Dutch pages must start with /nl-nl');\n  for (const k of Object.keys(LIMITS)) {\n    if (r[k] && String(r[k]).length > LIMITS[k]) errors.push(at + ': ' + NAMES[k] + ' is longer than ' + LIMITS[k] + ' characters');\n    if (r[k] && /<[a-z!/]/i.test(r[k])) errors.push(at + ': ' + NAMES[k] + ' contains HTML, which is not allowed');\n  }\n  (r.buttons || []).forEach((b, j) => {\n    if (!b.label) errors.push(at + ': button ' + (j + 1) + ' has no label');\n    if (b.label && b.label.length > 80) errors.push(at + ': button ' + (j + 1) + ' label is longer than 80 characters');\n    if (/<[a-z!/]/i.test(b.label + ' ' + b.send)) errors.push(at + ': button ' + (j + 1) + ' contains HTML, which is not allowed');\n  });\n  if ((r.buttons || []).length > 6) errors.push(at + ': more than 6 buttons');\n  String(r.opener || '').split(/\\n\\s*\\n/).forEach(b => {\n    const t = b.trim();\n    if (/^\\[video\\]/i.test(t) && !/^\\[video\\]\\s*https:\\/\\/\\S+$/i.test(t)) errors.push(at + ': a [video] bubble needs exactly one https:// link');\n  });\n  if ((r.mode === 'half' || r.mode === 'full') && !r.opener) errors.push(at + ': a half or full card needs its own opening message');\n  const key = r.region + '|' + (r.match_type || 'prefix') + '|' + url.toLowerCase();\n  if (seen.has(key)) errors.push(at + ': two rows for the same URL');\n  seen.add(key);\n});\nfor (const region of new Set(cfg.rows.map(r => r.region))) {\n  if (!cfg.rows.some(r => r.region === region && r.url_match === '*')) errors.push('Region ' + region + ' has no default (*) row');\n}\n\nconst before = JSON.stringify(base.cfg.rows);\nif (!errors.length && JSON.stringify(cfg.rows) === before) errors.push('Nothing changed: this page already has exactly these settings.');\n\nconst who = (trig.user && (trig.user.email || trig.user.name)) || (trig.n8nUser && trig.n8nUser.email) || 'n8n form';\nconst today = new Date().toISOString().slice(0, 10);\nconst m = /^(\\d{4}-\\d{2}-\\d{2})\\.(\\d+)$/.exec(String(base.cfg.version || ''));\ncfg.version = today + '.' + (m && m[1] === today ? Number(m[2]) + 1 : 1);\ncfg.generatedBy = 'n8n Mia page editor (' + who + ')';\n\nconst verb = base.action === 'remove' ? 'Remove' : (base.existing ? 'Change' : 'Add');\nconst message = 'Mia config: ' + verb.toLowerCase() + ' ' + base.region + ' ' + base.match_type + ' ' + base.url_match + ' (via n8n, ' + who + ')';\nconst esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');\nconst summary = verb + ' ' + base.url_match + ' (' + base.region + ', ' + base.match_type + ')';\n\nreturn [{ json: {\n  ok: errors.length === 0,\n  errors,\n  errorsHtml: errors.map(e => '\u2022 ' + esc(e)).join('<br>'),\n  summary,\n  message,\n  sha: base.sha,\n  version: cfg.version,\n  content: Buffer.from(JSON.stringify(cfg, null, 2) + '\\n', 'utf8').toString('base64')\n} }];\n" }
  },
  output: [{ ok: true, errors: [], errorsHtml: '', summary: 'Change /en-gb/pricing (en-GB, exact)', message: 'Mia config: change', sha: 'abc123', version: '2026-10-08.5', content: 'eyJyb3dzIjpbXX0=' }]
});

const passed = ifElse({
  version: 2.3,
  config: {
    name: 'Passed the checks?',
    position: [1320, 300],
    parameters: {
      conditions: {
        combinator: 'and',
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ leftValue: expr('{{ $json.ok }}'), rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }]
      }
    }
  }
});

const commit = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Commit to GitHub',
    position: [1540, 200],
    onError: 'continueErrorOutput',
    parameters: {
      method: 'PUT',
      url: 'https://api.github.com/repos/Louis-50/spotler-mia-loader/contents/config/config.json',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'githubApi',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: { parameters: [{ name: 'Accept', value: 'application/vnd.github+json' }] },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ message: $json.message, content: $json.content, sha: $json.sha, branch: "main" }) }}')
    },
    credentials: { githubApi: newCredential('GitHub: spotler-mia-loader config') }
  },
  output: [{ commit: { sha: 'def456', html_url: 'https://github.com/Louis-50/spotler-mia-loader/commit/def456' } }]
});

const purgeNow = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Purge jsDelivr cache',
    position: [1760, 100],
    onError: 'continueRegularOutput',
    parameters: { method: 'GET', url: 'https://purge.jsdelivr.net/gh/Louis-50/spotler-mia-loader@main/config/config.json' }
  },
  output: [{ status: 'finished' }]
});

const published = node({
  type: 'n8n-nodes-base.form',
  version: 2.5,
  config: {
    name: 'Published',
    position: [1980, 100],
    parameters: {
      operation: 'completion',
      respondWith: 'text',
      completionTitle: 'Published',
      completionMessage: expr('{{ $("Apply and check").first().json.summary }} is saved (config version {{ $("Apply and check").first().json.version }}). It shows on the site within a few minutes; open the page in a private window to check.')
    }
  },
  output: [{}]
});

const waitForCdn = node({
  type: 'n8n-nodes-base.wait',
  version: 1.1,
  config: {
    name: 'Wait for GitHub',
    position: [1760, 300],
    parameters: { resume: 'timeInterval', amount: 90, unit: 'seconds' }
  },
  output: [{}]
});

const purgeAgain = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Purge jsDelivr again',
    position: [1980, 300],
    onError: 'continueRegularOutput',
    parameters: { method: 'GET', url: 'https://purge.jsdelivr.net/gh/Louis-50/spotler-mia-loader@main/config/config.json' }
  },
  output: [{ status: 'finished' }]
});

const commitFailed = node({
  type: 'n8n-nodes-base.form',
  version: 2.5,
  config: {
    name: 'Could not publish',
    position: [1760, 500],
    parameters: {
      operation: 'completion',
      respondWith: 'text',
      completionTitle: 'Not published',
      completionMessage: 'GitHub refused the change. Most often someone else published a change at the same moment: open the form again and resubmit. If it keeps failing, ask Louis.'
    }
  },
  output: [{}]
});

const rejected = node({
  type: 'n8n-nodes-base.form',
  version: 2.5,
  config: {
    name: 'Not published: fix and retry',
    position: [1540, 500],
    parameters: {
      operation: 'completion',
      respondWith: 'showText',
      responseText: expr('<div style="font-family:Arial,sans-serif;max-width:640px;margin:40px auto;color:#202127"><h2 style="color:#002a4d">Not published</h2><p>Nothing on the site changed. Please fix this and submit the form again:</p><p>{{ $json.errorsHtml }}</p></div>')
    }
  },
  output: [{}]
});

const note = sticky('## Mia chat: page settings\nMarketing edits `config/config.json` in GitHub (Louis-50/spotler-mia-loader) through this form. The GTM tag reads that file from jsDelivr.\n\n1. The form asks for a page, then shows its current settings.\n2. **Apply and check** runs the same checks as `scripts/check-config.mjs`; nothing is published if one fails.\n3. The change is committed to `main` and the jsDelivr cache is purged (again after 90s, once GitHub has caught up).\n\nSetup: add a fine-grained GitHub token (this repo only, Contents read + write) as the **GitHub: spotler-mia-loader config** credential. The form needs an n8n login.', [readConfig, findRow, applyChange], { color: 5 });

export default workflow('mia-page-editor', 'Mia chat: page settings (marketing)')
  .add(choosePage)
  .to(readConfig)
  .to(findRow)
  .to(isRemove
    .onTrue(applyChange)
    .onFalse(pageSettings.to(applyChange)))
  .add(applyChange)
  .to(passed
    .onTrue(commit)
    .onFalse(rejected))
  .add(commit)
  .to(purgeNow.to(published))
  .add(commit)
  .to(waitForCdn.to(purgeAgain))
  .add(commit.onError(commitFailed))
  .add(note);
