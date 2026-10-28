#!/usr/bin/env node
// Pre-publish gate: manifest shape, every referenced file exists, version matches release tag.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const errors = [];

for (const key of ['manifest_version', 'name', 'version', 'description']) {
  if (!manifest[key]) errors.push(`manifest.${key} is missing`);
}
if (manifest.manifest_version !== 3) errors.push('manifest_version must be 3');
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) errors.push(`version "${manifest.version}" is not x.y.z`);
for (const size of [16, 48, 128]) {
  if (!manifest.icons?.[size]) errors.push(`icons.${size} is required`);
}

// Every runtime file the browser will ask for.
const refs = new Set();
const collect = (node) => {
  if (typeof node === 'string') {
    if (node.includes('*')) return; // glob patterns in web_accessible_resources
    if (/\.(js|css|html|png|svg|json)$/i.test(node)) refs.add(node);
  } else if (Array.isArray(node)) node.forEach(collect);
  else if (node && typeof node === 'object') Object.values(node).forEach(collect);
};
collect({
  icons: manifest.icons,
  action: manifest.action,
  options_ui: manifest.options_ui,
  background: manifest.background,
  content_scripts: manifest.content_scripts,
  web_accessible_resources: manifest.web_accessible_resources,
});
for (const file of refs) {
  if (!fs.existsSync(path.join(root, file))) errors.push(`referenced file missing: ${file}`);
}

// A tag that disagrees with the manifest ships a store entry with the wrong version.
const tag = process.env.GITHUB_REF_NAME;
if (tag?.startsWith('v') && tag.slice(1) !== manifest.version) {
  errors.push(`tag ${tag} != manifest version ${manifest.version} — bump manifest.json`);
}

if (errors.length) {
  console.error(errors.map((e) => `  x ${e}`).join('\n'));
  process.exit(1);
}
console.log(`ok - v${manifest.version}, ${refs.size} referenced files present`);
