#!/usr/bin/env node
// Renders popup.html and dashboard.html with sample stats and saves README screenshots.
// No browser deps: talks CDP to a local headless Chromium.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'docs', 'screenshots');
const PORT = 9333;

const day = (offset) => {
  const d = new Date(Date.now() - offset * 86400000);
  return d.toISOString().split('T')[0];
};

const daily = {};
for (let i = 29; i >= 0; i--) {
  daily[day(i)] = {
    youtube: { count: 40 + ((i * 13) % 55), time: 900 + ((i * 271) % 1800), adsSkipped: 4 + (i % 7) },
    instagram: { count: 25 + ((i * 9) % 40), time: 600 + ((i * 197) % 1500), adsSkipped: 2 + (i % 5) },
    facebook: { count: 10 + ((i * 7) % 25), time: 300 + ((i * 113) % 900), adsSkipped: i % 4 },
  };
}

const stats = {
  daily,
  totals: {
    youtube: { count: 742, time: 19860, adsSkipped: 63 },
    instagram: { count: 488, time: 12940, adsSkipped: 41 },
    facebook: { count: 214, time: 5720, adsSkipped: 18 },
  },
  allTimeTotalTime: 38520,
  allTimeTotalReels: 1444,
  allTimeAdsSkipped: 122,
};

const settings = {
  masterEnabled: true,
  skipAds: true,
  scrollDelay: 0.5,
  showHUD: true,
  maxDuration: 0,
  platformSettings: { youtube: true, instagram: true, facebook: true },
};

const shim = `
  const __data = {
    reelflow_settings: ${JSON.stringify(settings)},
    reelflow_stats: ${JSON.stringify(stats)},
  };
  window.chrome = {
    storage: {
      local: {
        get: async () => structuredClone(__data),
        set: async (patch) => Object.assign(__data, patch),
      },
      onChanged: { addListener: () => {} },
    },
    runtime: {
      id: 'preview',
      sendMessage: async () => ({ ok: true }),
      getURL: (p) => p,
      openOptionsPage: () => {},
      onMessage: { addListener: () => {} },
    },
    tabs: { query: async () => [], create: async () => ({}) },
  };
`;

const targets = [
  { file: 'popup/popup.html', out: 'popup.png', width: 380, height: 800 },
  { file: 'dashboard/dashboard.html', out: 'dashboard.png', width: 1440, height: 1000 },
];

const rpc = (() => {
  let id = 0;
  const pending = new Map();
  let ws;
  return {
    connect(url) {
      ws = new WebSocket(url);
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (rpc.onEvent) rpc.onEvent(e);
        if (msg.id && pending.has(msg.id)) {
          const { resolve, reject } = pending.get(msg.id);
          pending.delete(msg.id);
          msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
        }
      };
      return new Promise((res, rej) => {
        ws.onopen = res;
        ws.onerror = rej;
      });
    },
    send(method, params = {}, sessionId) {
      const msg = { id: ++id, method, params };
      if (sessionId) msg.sessionId = sessionId;
      ws.send(JSON.stringify(msg));
      return new Promise((resolve, reject) => pending.set(msg.id, { resolve, reject }));
    },
    close: () => ws.close(),
  };
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const chrome = spawn(
    'chromium',
    ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-sandbox', '--hide-scrollbars',
      '--force-device-scale-factor=2', '--user-data-dir=/tmp/opencode/shots-profile', 'about:blank'],
    { stdio: 'ignore' },
  );

  let version;
  for (let i = 0; i < 50 && !version; i++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    } catch { await sleep(100); }
  }
  if (!version) throw new Error('chromium did not start');

  await rpc.connect(version.webSocketDebuggerUrl);

  for (const t of targets) {
    const { targetId } = await rpc.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await rpc.send('Target.attachToTarget', { targetId, flatten: true });
    await rpc.send('Page.enable', {}, sessionId);
    await rpc.send('Emulation.setDeviceMetricsOverride',
      { width: t.width, height: t.height, deviceScaleFactor: 2, mobile: false }, sessionId);
    await rpc.send('Page.addScriptToEvaluateOnNewDocument', { source: shim }, sessionId);

    const loaded = new Promise((resolve) => {
      const onMsg = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.method === 'Page.loadEventFired' && msg.sessionId === sessionId) resolve();
      };
      rpc.onEvent = onMsg;
    });
    await rpc.send('Page.navigate', { url: `file://${path.join(root, t.file)}` }, sessionId);
    await loaded;
    await sleep(600);

    const shot = await rpc.send('Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: true, fromSurface: true }, sessionId);
    const file = path.join(outDir, t.out);
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    console.log(`${t.out} ${t.width}x${t.height} -> ${file}`);
    await rpc.send('Target.closeTarget', { targetId });
  }

  rpc.close();
  chrome.kill();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
