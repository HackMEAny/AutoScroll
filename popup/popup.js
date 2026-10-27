/**
 * ReelFlow - Popup Logic
 */

const DEFAULTS = {
  settings: {
    masterEnabled: true,
    skipAds: true,
    scrollDelay: 0.5,
    showHUD: true,
    maxDuration: 0,
    platformSettings: { youtube: true, instagram: true, facebook: true }
  }
};

let currentPeriod = 'today';
let cachedStats = null;
let cachedSettings = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  await loadData();
  bindEvents();
  render();
}

async function loadData() {
  const res = await chrome.storage.local.get(['reelflow_settings', 'reelflow_stats']);
  cachedSettings = res.reelflow_settings || DEFAULTS.settings;
  cachedStats = res.reelflow_stats || { daily: {}, totals: {} };
}

function bindEvents() {
  // Master toggle
  document.getElementById('master-switch').addEventListener('change', (e) => {
    updateSetting('masterEnabled', e.target.checked);
  });

  // Skip ads toggle
  document.getElementById('setting-skip-ads').addEventListener('change', (e) => {
    updateSetting('skipAds', e.target.checked);
  });

  // Delay slider
  const slider = document.getElementById('setting-delay-range');
  slider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    document.getElementById('delay-label').textContent = `${val.toFixed(1)} seconds`;
    updateRangeFill(e.target);
  });
  slider.addEventListener('change', (e) => {
    updateSetting('scrollDelay', parseFloat(e.target.value));
  });

  // Period tabs
  document.querySelectorAll('.time-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.time-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentPeriod = tab.dataset.period;
      render();
    });
  });

  // Platform chips
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const plat = chip.dataset.platform;
      const current = cachedSettings.platformSettings?.[plat] !== false;
      const newSettings = {
        ...cachedSettings,
        platformSettings: { ...cachedSettings.platformSettings, [plat]: !current }
      };
      cachedSettings = newSettings;
      chrome.storage.local.set({ reelflow_settings: newSettings });
      chip.classList.toggle('active', !current);
    });
  });

  // Reset stats
  document.getElementById('btn-reset-stats').addEventListener('click', async () => {
    if (confirm('Reset all ReelFlow statistics? This cannot be undone.')) {
      await chrome.runtime.sendMessage({ type: 'RESET_STATS' });
      await loadData();
      render();
    }
  });

  // Open dashboard
  const openDashboard = () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('dashboard/dashboard.html'));
    }
  };
  document.getElementById('btn-open-dashboard').addEventListener('click', openDashboard);
  document.getElementById('btn-dashboard-link').addEventListener('click', openDashboard);

  // Live update when storage changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.reelflow_stats) {
      cachedStats = changes.reelflow_stats.newValue;
      render();
    }
    if (changes.reelflow_settings) {
      cachedSettings = changes.reelflow_settings.newValue;
      renderControls();
    }
  });
}

function updateSetting(key, value) {
  cachedSettings = { ...cachedSettings, [key]: value };
  chrome.storage.local.set({ reelflow_settings: cachedSettings });
  renderControls();
}

function updateRangeFill(slider) {
  const min = parseFloat(slider.min);
  const max = parseFloat(slider.max);
  const val = parseFloat(slider.value);
  const pct = ((val - min) / (max - min)) * 100;
  slider.style.background = `linear-gradient(90deg, var(--accent-violet) ${pct}%, rgba(100,116,139,0.25) ${pct}%)`;
}

function getPeriodData() {
  const stats = cachedStats || { daily: {}, totals: {} };
  const platforms = ['youtube', 'instagram', 'facebook'];

  if (currentPeriod === 'today') {
    const todayKey = new Date().toISOString().split('T')[0];
    const todayData = stats.daily?.[todayKey] || {};
    const result = {};
    platforms.forEach(p => {
      result[p] = {
        count: todayData[p]?.count || 0,
        time: todayData[p]?.time || 0,
        adsSkipped: todayData[p]?.adsSkipped || 0
      };
    });
    return result;
  } else {
    const result = {};
    platforms.forEach(p => {
      result[p] = {
        count: stats.totals?.[p]?.count || 0,
        time: stats.totals?.[p]?.time || 0,
        adsSkipped: stats.totals?.[p]?.adsSkipped || 0
      };
    });
    return result;
  }
}

function formatDuration(seconds) {
  seconds = Math.max(0, Math.floor(seconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function formatShort(seconds) {
  seconds = Math.max(0, Math.floor(seconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}

function getRealityCheck(totalSeconds, totalReels) {
  if (totalSeconds < 60 && totalReels === 0) {
    return 'No doomscrolling yet. Keep it that way!';
  }
  const minutes = totalSeconds / 60;
  const pagesRead = Math.round(minutes * 0.8);
  const books = (minutes / 480).toFixed(1);
  const kmRun = (minutes / 6).toFixed(1);
  const episodes = Math.floor(minutes / 22);

  const checks = [];
  if (pagesRead >= 5) checks.push(`You could have read ~${pagesRead} pages of a book.`);
  if (totalReels >= 20) checks.push(`${totalReels} reels = ${episodes} sitcom episodes.`);
  if (minutes >= 30) checks.push(`That's ~${kmRun} km you could have run!`);
  if (totalSeconds >= 3600) checks.push(`Nearly ${books} of a full book read.`);

  if (checks.length === 0) {
    return `${totalReels} reels watched. You could've read ${pagesRead} book pages!`;
  }
  return checks[Math.floor(Math.random() * checks.length)];
}

function render() {
  renderControls();
  renderStats();
  renderPlatforms();
}

function renderControls() {
  const s = cachedSettings;

  document.getElementById('master-switch').checked = s.masterEnabled;
  document.getElementById('setting-skip-ads').checked = s.skipAds;

  const statusEl = document.getElementById('master-status-text');
  statusEl.textContent = s.masterEnabled ? 'Active & Scrolling' : 'Paused';
  statusEl.classList.toggle('off', !s.masterEnabled);

  const slider = document.getElementById('setting-delay-range');
  slider.value = s.scrollDelay;
  document.getElementById('delay-label').textContent = `${Number(s.scrollDelay).toFixed(1)} seconds`;
  updateRangeFill(slider);

  ['youtube', 'instagram', 'facebook'].forEach(p => {
    const chip = document.querySelector(`.chip[data-platform="${p}"]`);
    if (chip) chip.classList.toggle('active', s.platformSettings?.[p] !== false);
  });
}

function renderStats() {
  const data = getPeriodData();
  const totalTime = data.youtube.time + data.instagram.time + data.facebook.time;
  const totalReels = data.youtube.count + data.instagram.count + data.facebook.count;
  const totalAds = data.youtube.adsSkipped + data.instagram.adsSkipped + data.facebook.adsSkipped;

  document.getElementById('val-time-wasted').textContent = formatDuration(totalTime);
  document.getElementById('val-reels-count').textContent = totalReels.toLocaleString();
  document.getElementById('val-ads-skipped').textContent = totalAds.toLocaleString();

  document.getElementById('reality-check-pill').textContent = getRealityCheck(totalTime, totalReels);
}

function renderPlatforms() {
  const data = getPeriodData();
  const totalTime = data.youtube.time + data.instagram.time + data.facebook.time;

  // Determine top platform
  let topPlat = null;
  let maxTime = 0;
  ['youtube', 'instagram', 'facebook'].forEach(p => {
    if (data[p].time > maxTime) { maxTime = data[p].time; topPlat = p; }
  });

  const names = { youtube: 'YouTube', instagram: 'Instagram', facebook: 'Facebook' };
  const badge = document.getElementById('top-platform-badge');
  badge.textContent = topPlat && maxTime > 0 ? `Most: ${names[topPlat]}` : 'No data yet';

  const mapping = {
    instagram: { time: 'ig-time', pct: 'ig-percent', bar: 'ig-bar' },
    youtube: { time: 'yt-time', pct: 'yt-percent', bar: 'yt-bar' },
    facebook: { time: 'fb-time', pct: 'fb-percent', bar: 'fb-bar' }
  };

  Object.keys(mapping).forEach(p => {
    const m = mapping[p];
    const time = data[p].time;
    const pct = totalTime > 0 ? Math.round((time / totalTime) * 100) : 0;
    document.getElementById(m.time).textContent = formatShort(time);
    document.getElementById(m.pct).textContent = `${pct}%`;
    document.getElementById(m.bar).style.width = `${pct}%`;
  });
}
