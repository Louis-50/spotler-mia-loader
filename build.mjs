// Builds dist/mia-loader.gtm.html: one paste-ready GTM Custom HTML tag.
// Source files in src/ are joined in filename order; .css files become
// CSS.<name>, .html files become HTML.<name>. Output is ES5 (GTM-safe).
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { minify } from "terser";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const files = readdirSync("src").sort();
const key = f => f.replace(/^\d+-/, "").replace(/\.(css|html|js)$/, "");
const minCss = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ")
  .replace(/\s*([{}:;,>])\s*/g, "$1").replace(/;}/g, "}").trim();
const minHtml = s => s.replace(/<!--[\s\S]*?-->/g, "").replace(/>\s+</g, "><").replace(/\s{2,}/g, " ").trim();

let css = {}, html = {}, js = [];
for (const f of files) {
  const src = readFileSync("src/" + f, "utf8");
  if (f.endsWith(".css")) css[key(f)] = minCss(src);
  else if (f.endsWith(".html")) html[key(f)] = minHtml(src);
  else if (f.endsWith(".js")) js.push(`/* ---- ${f} ---- */\n` + src);
}

const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
const banner = `/* Spotler Mia lazy loader v${pkg.version} · built ${stamp} · source: github.com/Louis-50/spotler-mia-loader */`;
const body = `(function () {\n"use strict";\nvar CSS = ${JSON.stringify(css)};\nvar HTML = ${JSON.stringify(html)};\n${js.join("\n")}\n})();`;

// Rough GTM-safety check: no ES6 syntax in our own source.
const es6 = /(^|[^\w.])(let|const|class)\s|=>|`/m;
for (const f of files.filter(f => f.endsWith(".js"))) {
  const src = readFileSync("src/" + f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "").replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''");
  if (es6.test(src)) throw new Error(`ES6 syntax in src/${f}: GTM Custom HTML needs ES5`);
}

const min = await minify(body, { ecma: 5, compress: { passes: 2 }, mangle: true, format: { ascii_only: true } });
if (!min.code) throw new Error("minify failed");

mkdirSync("dist", { recursive: true });
writeFileSync("dist/mia-loader.gtm.html", `<script>\n${banner}\n${min.code}\n</script>\n`);
writeFileSync("dist/mia-loader.debug.html", `<script>\n${banner}\n${body}\n</script>\n`);
writeFileSync("dist/mia-loader.js", `${banner}\n${min.code}\n`);
const kb = n => (n / 1024).toFixed(1) + " KB";
console.log(`built ${files.length} source files → dist/mia-loader.gtm.html (${kb(min.code.length)} minified, ${kb(body.length)} readable)`);
