// Validates config.json the same way the n8n "Publish chat config" workflow
// does. Usage: node scripts/check-config.mjs config/config.json
// Exit code 1 = refuse to publish.
import { readFileSync } from "node:fs";

const REGIONS = ["en-GB", "int", "nl"];
const MODES = ["slideout", "half", "full", undefined, ""];
const MATCH = ["exact", "prefix", "contains", undefined, ""];
const LIMITS = { opener: 1200, teaser_text: 200, teaser_send: 300, headline: 200, intro: 400 };

export function checkConfig(cfg) {
  const errors = [];
  if (!cfg || !Array.isArray(cfg.rows) || !cfg.rows.length) return ["no rows"];
  if (!cfg.version) errors.push("missing version");
  const seen = new Set();
  cfg.rows.forEach((r, i) => {
    const at = `row ${i + 1} (${r.url_match || "?"})`;
    if (!r.url_match) errors.push(`${at}: url_match is empty`);
    else if (r.url_match !== "*" && r.match_type !== "contains" && !r.url_match.startsWith("/")) errors.push(`${at}: url_match must start with / (or be *)`);
    if (!REGIONS.includes(r.region)) errors.push(`${at}: region must be one of ${REGIONS.join(", ")}`);
    if (r.region === "en-GB" && r.url_match.startsWith("/") && r.match_type !== "contains" && !r.url_match.toLowerCase().startsWith("/en-gb")) errors.push(`${at}: en-GB rows must be under /en-gb`);
    if (r.region === "nl" && r.url_match.startsWith("/") && r.match_type !== "contains" && !r.url_match.toLowerCase().startsWith("/nl-nl")) errors.push(`${at}: nl rows must be under /nl-nl`);
    if (!MODES.includes(r.mode)) errors.push(`${at}: mode must be slideout, half or full`);
    if (!MATCH.includes(r.match_type)) errors.push(`${at}: match_type must be exact, prefix or contains`);
    for (const [k, max] of Object.entries(LIMITS)) {
      if (r[k] && String(r[k]).length > max) errors.push(`${at}: ${k} longer than ${max} characters`);
      if (r[k] && /<[a-z!/]/i.test(r[k])) errors.push(`${at}: ${k} contains HTML`);
    }
    (r.buttons || []).forEach((b, j) => {
      if (!b.label) errors.push(`${at}: button ${j + 1} has no label`);
      if (b.label && b.label.length > 80) errors.push(`${at}: button ${j + 1} label longer than 80`);
    });
    if ((r.buttons || []).length > 4) errors.push(`${at}: more than 4 buttons`);
    if ((r.mode === "half" || r.mode === "full") && !r.opener) errors.push(`${at}: embedded rows need their own opener`);
    const key = `${r.region}|${r.match_type || "prefix"}|${String(r.url_match).toLowerCase()}`;
    if (seen.has(key)) errors.push(`${at}: duplicate of another row`);
    seen.add(key);
  });
  for (const region of new Set(cfg.rows.map(r => r.region))) {
    if (!cfg.rows.some(r => r.region === region && r.url_match === "*")) errors.push(`region ${region}: no default "*" row`);
  }
  return errors;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const errors = checkConfig(JSON.parse(readFileSync(process.argv[2] || "config/config.json", "utf8")));
  if (errors.length) { console.error("Config refused:\n- " + errors.join("\n- ")); process.exit(1); }
  console.log("Config OK");
}
