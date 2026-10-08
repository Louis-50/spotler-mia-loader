// The config just published by the form, or (manual rebuild) the one read from GitHub.
let content = '';
try { content = $('Read config for page list').first().json.content; } catch (e) {}
if (!content) { try { content = $('Apply and check').first().json.content; } catch (e) {} }
const cfg = JSON.parse(Buffer.from(String(content || ''), 'base64').toString('utf8'));

const REGION = { 'en-GB': 'UK', nl: 'Netherlands', int: 'International' };
const COVERS = { exact: 'This page only', prefix: 'This page and pages under it', contains: 'Any URL containing this' };
const TYPE = { full: 'Full embed', half: 'Half embed', slideout: 'Custom slide-out' };
const ORDER = { 'Full embed': 0, 'Half embed': 1, 'Custom slide-out': 2, 'Slide-out': 3 };
const regions = ['en-GB', 'nl', 'int'];

const defaults = {};
cfg.rows.forEach(r => { if (r.url_match === '*') defaults[r.region] = r; });

const out = cfg.rows.map(r => {
  const isDefault = r.url_match === '*';
  const type = isDefault ? 'Slide-out' : TYPE[r.mode || 'slideout'];
  const fallback = defaults[r.region] || {};
  return {
    region: REGION[r.region] || r.region,
    page: isDefault ? 'Other pages' : r.url_match,
    covers: isDefault ? 'Every page without its own row' : COVERS[r.match_type || 'prefix'],
    type,
    opening_message: r.opener || 'Standard opening',
    buttons: r.buttons && r.buttons.length ? r.buttons.map(b => b.label).join(' | ') : (r.opener ? '' : 'Standard buttons'),
    teaser: type === 'Full embed' || type === 'Half embed' ? '' : (r.teaser_text || fallback.teaser_text || ''),
    page_key: r.page || '',
    config_version: String(cfg.version || ''),
    _sort: [regions.indexOf(r.region), ORDER[type], isDefault ? '' : r.url_match]
  };
});
out.sort((a, b) => a._sort[0] - b._sort[0] || a._sort[1] - b._sort[1] || String(a._sort[2]).localeCompare(String(b._sort[2])));
return out.map(({ _sort, ...row }) => ({ json: row }));
