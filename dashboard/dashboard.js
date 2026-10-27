/**
 * ReelFlow - Analytics Dashboard Logic
 */

let cachedStats = null;
let cachedSettings = null;
let currentRangeDays = 30;

const COLORS = {
  instagram: '#ee2a7b',
  youtube: '#ff0000',
  facebook: '#1877f2'
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  await loadData();
  bindNavigation();
  bindControls();
  renderAll();
}

async function loadData() {
  const res = await chrome.storage.local.get(['reelflow_settings', 'reelflow_stats']);
  cachedSettings = res.reelflow_settings || {
    masterEnabled: true,
    skipAds: true,
    scrollDelay: 0.5,
    showHUD: true,
    maxDuration: 0,
    platformSettings: { youtube: true, instagram: true, facebook: true }
  };
  cachedStats = res.reelflow_stats || { daily: {}, totals: {} };
}

function bindNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');

      const viewId = item.dataset.view;
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      const activeView = document.getElementById(`view-${viewId}`);
      if (activeView) activeView.classList.add('active');

      if (viewId === 'overview') {
        renderCharts();
      }
    });
  });
}

function bindControls() {
  // Range select
  const rangeSelect = document.getElementById('range-select');
  rangeSelect?.addEventListener('change', (e) => {
    currentRangeDays = parseInt(e.target.value, 10);
    renderOverview();
  });

  // Export CSV
  document.getElementById('btn-export')?.addEventListener('click', exportCsv);

  // Settings switches
  const bindSwitch = (id, key, subkey = null) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      if (subkey) {
        cachedSettings[key] = cachedSettings[key] || {};
        cachedSettings[key][subkey] = el.checked;
      } else {
        cachedSettings[key] = el.checked;
      }
      chrome.storage.local.set({ reelflow_settings: cachedSettings });
    });
  };

  bindSwitch('set-master', 'masterEnabled');
  bindSwitch('set-skip-ads', 'skipAds');
  bindSwitch('set-hud', 'showHUD');
  bindSwitch('set-yt', 'platformSettings', 'youtube');
  bindSwitch('set-ig', 'platformSettings', 'instagram');
  bindSwitch('set-fb', 'platformSettings', 'facebook');

  // Sliders
  const delaySlider = document.getElementById('set-delay');
  delaySlider?.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    document.getElementById('set-delay-label').textContent = `${val.toFixed(1)} seconds after reel ends`;
  });
  delaySlider?.addEventListener('change', (e) => {
    cachedSettings.scrollDelay = parseFloat(e.target.value);
    chrome.storage.local.set({ reelflow_settings: cachedSettings });
  });

  const maxSlider = document.getElementById('set-max');
  maxSlider?.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    document.getElementById('set-max-label').textContent = val === 0 ? 'Unlimited' : `Skip after ${val} seconds`;
  });
  maxSlider?.addEventListener('change', (e) => {
    cachedSettings.maxDuration = parseInt(e.target.value, 10);
    chrome.storage.local.set({ reelflow_settings: cachedSettings });
  });

  // Reset
  document.getElementById('btn-reset')?.addEventListener('click', async () => {
    if (confirm('Permanently reset all tracked statistics?')) {
      await chrome.runtime.sendMessage({ type: 'RESET_STATS' });
      await loadData();
      renderAll();
    }
  });

  // Storage updates
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.reelflow_stats) {
        cachedStats = changes.reelflow_stats.newValue;
        renderAll();
      }
      if (changes.reelflow_settings) {
        cachedSettings = changes.reelflow_settings.newValue;
        renderSettings();
      }
    }
  });

  // Redraw charts on resize
  window.addEventListener('resize', () => {
    const activeView = document.querySelector('.view.active');
    if (activeView && activeView.id === 'view-overview') {
      renderCharts();
    }
  });
}

function renderAll() {
  renderOverview();
  renderHistory();
  renderSettings();
}

function formatDuration(seconds) {
  seconds = Math.max(0, Math.floor(seconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDurationLong(seconds) {
  seconds = Math.max(0, Math.floor(seconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function renderOverview() {
  const totals = cachedStats.totals || {
    youtube: { count: 0, time: 0, adsSkipped: 0 },
    instagram: { count: 0, time: 0, adsSkipped: 0 },
    facebook: { count: 0, time: 0, adsSkipped: 0 }
  };

  const totalTime = (totals.youtube.time || 0) + (totals.instagram.time || 0) + (totals.facebook.time || 0);
  const totalReels = (totals.youtube.count || 0) + (totals.instagram.count || 0) + (totals.facebook.count || 0);
  const totalAds = (totals.youtube.adsSkipped || 0) + (totals.instagram.adsSkipped || 0) + (totals.facebook.adsSkipped || 0);

  document.getElementById('kpi-total-time').textContent = formatDuration(totalTime);
  document.getElementById('kpi-total-reels').textContent = totalReels.toLocaleString();
  document.getElementById('kpi-total-ads').textContent = totalAds.toLocaleString();

  // Daily average
  const dailyKeys = Object.keys(cachedStats.daily || {});
  const daysCount = Math.max(1, dailyKeys.length);
  const dailyAvgSeconds = totalTime / daysCount;
  document.getElementById('kpi-daily-avg').textContent = formatDuration(dailyAvgSeconds);

  // Reality check
  const realityText = getRealityText(totalTime, totalReels);
  document.getElementById('sidebar-reality').textContent = realityText;

  renderCharts();
  renderInsights(totalTime, totalReels, totals);
}

function getRealityText(totalSeconds, totalReels) {
  if (totalSeconds < 60) return "You haven't scrolled much yet. Keep up the productive habits!";
  const minutes = Math.floor(totalSeconds / 60);
  const pages = Math.round(minutes * 0.8);
  const books = (minutes / 400).toFixed(1);

  if (books >= 1.0) {
    return `In this time you could have read ${books} full books!`;
  }
  return `You've watched ${totalReels} reels. You could have read ~${pages} pages of a book instead.`;
}

function renderInsights(totalTime, totalReels, totals) {
  const list = document.getElementById('insights-list');
  if (!list) return;

  const platforms = [
    { name: 'Instagram Reels', time: totals.instagram?.time || 0, color: COLORS.instagram },
    { name: 'YouTube Shorts', time: totals.youtube?.time || 0, color: COLORS.youtube },
    { name: 'Facebook Reels', time: totals.facebook?.time || 0, color: COLORS.facebook }
  ];

  platforms.sort((a, b) => b.time - a.time);
  const top = platforms[0];
  const topPct = totalTime > 0 ? Math.round((top.time / totalTime) * 100) : 0;

  const cards = [];

  if (totalTime > 0) {
    cards.push({
      emoji: '🏆',
      title: `${top.name} takes the crown`,
      desc: `You spend ${topPct}% of your short-form watch time on ${top.name}.`
    });
  }

  const avgSecPerReel = totalReels > 0 ? Math.round(totalTime / totalReels) : 0;
  if (avgSecPerReel > 0) {
    cards.push({
      emoji: '⏱️',
      title: 'Attention Span',
      desc: `You spend an average of ${avgSecPerReel} seconds per reel before scrolling.`
    });
  }

  const adsSkipped = (totals.youtube?.adsSkipped || 0) + (totals.instagram?.adsSkipped || 0) + (totals.facebook?.adsSkipped || 0);
  if (adsSkipped > 0) {
    const savedMinutes = Math.round((adsSkipped * 15) / 60);
    cards.push({
      emoji: '⚡',
      title: 'Ad Time Saved',
      desc: `Skipped ${adsSkipped} ads, saving ~${savedMinutes} minutes of commercial fluff.`
    });
  }

  if (cards.length === 0) {
    cards.push({
      emoji: '✨',
      title: 'Clean Slate',
      desc: 'Start watching shorts or reels with ReelFlow active to uncover your habit insights.'
    });
  }

  list.innerHTML = cards.map(c => `
    <div class="insight-card">
      <div class="insight-emoji">${c.emoji}</div>
      <div>
        <h4>${c.title}</h4>
        <p>${c.desc}</p>
      </div>
    </div>
  `).join('');
}

function renderCharts() {
  renderStackedBarChart();
  renderDonutChart();
}

function renderStackedBarChart() {
  const canvas = document.getElementById('history-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // Handle high-DPI displays
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = rect.height;

  // Generate date labels for currentRangeDays
  const days = [];
  const now = new Date();
  for (let i = currentRangeDays - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().split('T')[0]);
  }

  const daily = cachedStats.daily || {};
  const dayData = days.map(key => {
    const item = daily[key] || {};
    return {
      date: key,
      ig: item.instagram?.time || 0,
      yt: item.youtube?.time || 0,
      fb: item.facebook?.time || 0,
      total: (item.instagram?.time || 0) + (item.youtube?.time || 0) + (item.facebook?.time || 0)
    };
  });

  const maxTotal = Math.max(60, ...dayData.map(d => d.total));
  const padding = { top: 20, right: 20, bottom: 35, left: 45 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  ctx.clearRect(0, 0, width, height);

  // Y-Axis grid lines
  const gridLines = 4;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.fillStyle = '#64748b';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'right';

  for (let i = 0; i <= gridLines; i++) {
    const y = padding.top + (chartH / gridLines) * i;
    const value = maxTotal - (maxTotal / gridLines) * i;

    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();

    ctx.fillText(formatDuration(value), padding.left - 8, y + 4);
  }

  // Bars
  const barWidth = Math.max(3, Math.min(22, (chartW / dayData.length) - 4));
  const step = chartW / dayData.length;

  dayData.forEach((d, idx) => {
    const x = padding.left + idx * step + (step - barWidth) / 2;
    let currentY = padding.top + chartH;

    const drawSegment = (val, color) => {
      if (val <= 0) return;
      const h = (val / maxTotal) * chartH;
      ctx.fillStyle = color;
      ctx.fillRect(x, currentY - h, barWidth, h);
      currentY -= h;
    };

    drawSegment(d.ig, COLORS.instagram);
    drawSegment(d.yt, COLORS.youtube);
    drawSegment(d.fb, COLORS.facebook);

    // X-Axis labels (skip every N days depending on range)
    const stride = currentRangeDays <= 7 ? 1 : currentRangeDays <= 14 ? 2 : 5;
    if (idx % stride === 0 || idx === dayData.length - 1) {
      const parts = d.date.split('-');
      const label = `${parts[1]}/${parts[2]}`;
      ctx.fillStyle = '#64748b';
      ctx.textAlign = 'center';
      ctx.fillText(label, x + barWidth / 2, height - padding.bottom + 18);
    }
  });
}

function renderDonutChart() {
  const canvas = document.getElementById('donut-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const totals = cachedStats.totals || {};
  const igTime = totals.instagram?.time || 0;
  const ytTime = totals.youtube?.time || 0;
  const fbTime = totals.facebook?.time || 0;
  const total = igTime + ytTime + fbTime;

  document.getElementById('donut-total').textContent = formatDuration(total);

  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const radius = 72;
  const lineWidth = 20;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (total === 0) {
    // Empty ring placeholder
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    return;
  }

  const slices = [
    { val: igTime, color: COLORS.instagram, name: 'Instagram Reels' },
    { val: ytTime, color: COLORS.youtube, name: 'YouTube Shorts' },
    { val: fbTime, color: COLORS.facebook, name: 'Facebook Reels' }
  ];

  let startAngle = -Math.PI / 2;

  slices.forEach(s => {
    if (s.val <= 0) return;
    const sliceAngle = (s.val / total) * 2 * Math.PI;

    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, startAngle + sliceAngle);
    ctx.strokeStyle = s.color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'butt';
    ctx.stroke();

    startAngle += sliceAngle;
  });

  // Legend
  const legend = document.getElementById('donut-legend');
  if (legend) {
    legend.innerHTML = slices.map(s => {
      const pct = total > 0 ? Math.round((s.val / total) * 100) : 0;
      return `
        <div class="donut-row">
          <div class="donut-label">
            <span class="legend-dot" style="background: ${s.color}"></span>
            <span>${s.name}</span>
          </div>
          <div class="donut-value">
            <span>${formatDuration(s.val)}</span>
            <small style="color: var(--text-dim); margin-left: 6px;">(${pct}%)</small>
          </div>
        </div>
      `;
    }).join('');
  }
}

function renderHistory() {
  const tbody = document.getElementById('history-tbody');
  if (!tbody) return;

  const daily = cachedStats.daily || {};
  const dates = Object.keys(daily).sort().reverse();

  if (dates.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No history recorded yet.</td></tr>';
    return;
  }

  tbody.innerHTML = dates.map(date => {
    const d = daily[date];
    const igTime = d.instagram?.time || 0;
    const ytTime = d.youtube?.time || 0;
    const fbTime = d.facebook?.time || 0;
    const totalTime = igTime + ytTime + fbTime;
    const totalReels = (d.instagram?.count || 0) + (d.youtube?.count || 0) + (d.facebook?.count || 0);

    return `
      <tr>
        <td><strong>${date}</strong></td>
        <td>${formatDurationLong(igTime)}</td>
        <td>${formatDurationLong(ytTime)}</td>
        <td>${formatDurationLong(fbTime)}</td>
        <td>${totalReels.toLocaleString()}</td>
        <td><strong>${formatDurationLong(totalTime)}</strong></td>
      </tr>
    `;
  }).join('');
}

function renderSettings() {
  const s = cachedSettings;
  const setCheck = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.checked = !!val;
  };

  setCheck('set-master', s.masterEnabled);
  setCheck('set-skip-ads', s.skipAds);
  setCheck('set-hud', s.showHUD);
  setCheck('set-yt', s.platformSettings?.youtube !== false);
  setCheck('set-ig', s.platformSettings?.instagram !== false);
  setCheck('set-fb', s.platformSettings?.facebook !== false);

  const delay = document.getElementById('set-delay');
  if (delay) {
    delay.value = s.scrollDelay;
    document.getElementById('set-delay-label').textContent = `${Number(s.scrollDelay).toFixed(1)} seconds after reel ends`;
  }

  const max = document.getElementById('set-max');
  if (max) {
    max.value = s.maxDuration;
    document.getElementById('set-max-label').textContent = s.maxDuration === 0 ? 'Unlimited' : `Skip after ${s.maxDuration} seconds`;
  }
}

function exportCsv() {
  const daily = cachedStats.daily || {};
  const dates = Object.keys(daily).sort();

  let csv = 'Date,Instagram_Time_Sec,Instagram_Reels,YouTube_Time_Sec,YouTube_Reels,Facebook_Time_Sec,Facebook_Reels,Total_Time_Sec,Total_Reels\n';

  dates.forEach(date => {
    const d = daily[date];
    const igT = d.instagram?.time || 0;
    const igC = d.instagram?.count || 0;
    const ytT = d.youtube?.time || 0;
    const ytC = d.youtube?.count || 0;
    const fbT = d.facebook?.time || 0;
    const fbC = d.facebook?.count || 0;
    const totalT = igT + ytT + fbT;
    const totalC = igC + ytC + fbC;

    csv += `${date},${igT},${igC},${ytT},${ytC},${fbT},${fbC},${totalT},${totalC}\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `reelflow-analytics-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
