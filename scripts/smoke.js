#!/usr/bin/env node
// Loads the unpacked extension in a real browser and checks the service worker starts.
// Usage: node scripts/smoke.js [chrome|chromium|brave|path]
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const name = process.argv[2] || 'google-chrome-stable';
const port = 9450 + Math.floor(Math.random() * 200);
const profile = `/tmp/opencode/smoke-${name.replace(/\W/g, '')}-${port}`;
// Browsers ship their own extensions that also run a background.js; match ours by its manifest path.
const workerPath = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).background.service_worker;
const isOurs = (t) => t.type === 'service_worker' && t.url.endsWith(`/${workerPath}`);

const chrome = spawn(name, [
  '--headless=new', '--no-sandbox', '--no-first-run', `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`, `--load-extension=${root}`, `--disable-extensions-except=${root}`,
  // Branded Chrome 137+ ignores --load-extension unless this feature is off.
  '--disable-features=DisableLoadExtensionCommandLineSwitch',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (p) => (await fetch(`http://127.0.0.1:${port}${p}`)).json();

async function main() {
  let targets = [];
  for (let i = 0; i < 60 && !targets.length; i++) {
    try { targets = await get('/json/list'); } catch { await sleep(250); }
    if (targets.length && !targets.some(isOurs)) {
      targets = []; // worker not up yet
    }
  }

  const worker = targets.find(isOurs);
  if (!worker) throw new Error(`extension service worker never started in ${name}`);

  const id = worker.url.split('/')[2];
  const version = (await get('/json/version')).Browser;

  // Popup must render as a real extension page, not an error page.
  const popup = await (await fetch(`http://127.0.0.1:${port}/json/new?chrome-extension://${id}/popup/popup.html`, { method: 'PUT' })).json();
  let title = '';
  for (let i = 0; i < 40 && !/reelflow/i.test(title); i++) {
    await sleep(250);
    const pages = await get('/json/list');
    title = pages.find((t) => t.id === popup.id)?.title || '';
  }
  if (!/reelflow/i.test(title)) throw new Error(`popup did not render (title: "${title}")`);

  console.log(`PASS  ${version}  extension ${id}  worker + popup ok`);
}

main()
  .catch((e) => {
    const hint = /chrome-stable|msedge/.test(name)
      ? ' (branded Chrome/Edge ignore --load-extension; use chromium/brave or test by hand)'
      : '';
    console.error(`FAIL  ${name}: ${e.message}${hint}`);
    process.exitCode = 1;
  })
  .finally(() => {
    chrome.kill();
    setTimeout(() => fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }), 500);
  });
