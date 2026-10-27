/**
 * ReelFlow - Background Service Worker
 * Manages analytics, storage synchronization, and reality-check insights.
 */

const DEFAULT_SETTINGS = {
  masterEnabled: true,
  skipAds: true,
  scrollDelay: 0.5,
  showHUD: true,
  maxDuration: 0,
  platformSettings: {
    youtube: true,
    instagram: true,
    facebook: true
  }
};

const DEFAULT_STATS = {
  daily: {},
  totals: {
    youtube: { count: 0, time: 0, adsSkipped: 0 },
    instagram: { count: 0, time: 0, adsSkipped: 0 },
    facebook: { count: 0, time: 0, adsSkipped: 0 }
  },
  allTimeTotalTime: 0,
  allTimeTotalReels: 0,
  allTimeAdsSkipped: 0
};

// Initialize settings on install
chrome.runtime.onInstalled.addListener(async (details) => {
  const current = await chrome.storage.local.get(['reelflow_settings', 'reelflow_stats']);
  
  if (!current.reelflow_settings) {
    await chrome.storage.local.set({ reelflow_settings: DEFAULT_SETTINGS });
  }

  if (!current.reelflow_stats) {
    await chrome.storage.local.set({ reelflow_stats: DEFAULT_STATS });
  }

  updateBadge();
});

// Helper to get formatted today date key (YYYY-MM-DD)
function getTodayKey() {
  return new Date().toISOString().split('T')[0];
}

// In-memory queue to debounce storage writes and prevent write contention
let pendingUpdates = {
  time: {},
  reels: {},
  ads: {}
};
let flushTimer = null;

function queueUpdate(type, platform, amount = 1) {
  if (!pendingUpdates[type][platform]) {
    pendingUpdates[type][platform] = 0;
  }
  pendingUpdates[type][platform] += amount;

  if (!flushTimer) {
    flushTimer = setTimeout(flushUpdatesToStorage, 1200);
  }
}

async function flushUpdatesToStorage() {
  flushTimer = null;
  const updates = pendingUpdates;
  pendingUpdates = { time: {}, reels: {}, ads: {} };

  try {
    const res = await chrome.storage.local.get(['reelflow_stats']);
    const stats = res.reelflow_stats || JSON.parse(JSON.stringify(DEFAULT_STATS));
    const today = getTodayKey();

    if (!stats.daily) stats.daily = {};
    if (!stats.daily[today]) {
      stats.daily[today] = {
        youtube: { count: 0, time: 0, adsSkipped: 0 },
        instagram: { count: 0, time: 0, adsSkipped: 0 },
        facebook: { count: 0, time: 0, adsSkipped: 0 }
      };
    }
    if (!stats.totals) {
      stats.totals = {
        youtube: { count: 0, time: 0, adsSkipped: 0 },
        instagram: { count: 0, time: 0, adsSkipped: 0 },
        facebook: { count: 0, time: 0, adsSkipped: 0 }
      };
    }

    const platforms = ['youtube', 'instagram', 'facebook'];

    platforms.forEach(plat => {
      if (!stats.daily[today][plat]) {
        stats.daily[today][plat] = { count: 0, time: 0, adsSkipped: 0 };
      }
      if (!stats.totals[plat]) {
        stats.totals[plat] = { count: 0, time: 0, adsSkipped: 0 };
      }

      // Add time
      const addedTime = updates.time[plat] || 0;
      if (addedTime > 0) {
        stats.daily[today][plat].time += addedTime;
        stats.totals[plat].time += addedTime;
        stats.allTimeTotalTime = (stats.allTimeTotalTime || 0) + addedTime;
      }

      // Add reels
      const addedReels = updates.reels[plat] || 0;
      if (addedReels > 0) {
        stats.daily[today][plat].count += addedReels;
        stats.totals[plat].count += addedReels;
        stats.allTimeTotalReels = (stats.allTimeTotalReels || 0) + addedReels;
      }

      // Add ads
      const addedAds = updates.ads[plat] || 0;
      if (addedAds > 0) {
        stats.daily[today][plat].adsSkipped += addedAds;
        stats.totals[plat].adsSkipped += addedAds;
        stats.allTimeAdsSkipped = (stats.allTimeAdsSkipped || 0) + addedAds;
      }
    });

    await chrome.storage.local.set({ reelflow_stats: stats });
    updateBadge(stats);
  } catch (err) {
    console.error('[ReelFlow Background] Failed to save stats:', err);
  }
}

// Update the extension action badge with today's reel count
async function updateBadge(stats) {
  try {
    if (!stats) {
      const res = await chrome.storage.local.get(['reelflow_stats']);
      stats = res.reelflow_stats;
    }
    const today = getTodayKey();
    const todayData = stats?.daily?.[today] || {};
    const totalTodayReels = (todayData.youtube?.count || 0) + 
                            (todayData.instagram?.count || 0) + 
                            (todayData.facebook?.count || 0);

    if (totalTodayReels > 0) {
      chrome.action.setBadgeText({ text: totalTodayReels > 999 ? '999+' : String(totalTodayReels) });
      chrome.action.setBadgeBackgroundColor({ color: '#8b5cf6' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  } catch (e) {
    // Chrome action might not be ready
  }
}

// Listen for messages from content scripts or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  const validPlatforms = ['youtube', 'instagram', 'facebook'];
  const platform = validPlatforms.includes(message.platform) ? message.platform : 'youtube';

  switch (message.type) {
    case 'LOG_TIME':
      queueUpdate('time', platform, Math.max(1, Number(message.seconds) || 1));
      sendResponse({ status: 'queued' });
      break;

    case 'LOG_REEL':
      queueUpdate('reels', platform, 1);
      sendResponse({ status: 'queued' });
      break;

    case 'LOG_AD_SKIPPED':
      queueUpdate('ads', platform, 1);
      sendResponse({ status: 'queued' });
      break;

    case 'FLUSH_NOW':
      flushUpdatesToStorage().then(() => sendResponse({ status: 'flushed' }));
      return true; // Keep message channel open for async

    case 'RESET_STATS':
      chrome.storage.local.set({ reelflow_stats: DEFAULT_STATS }).then(() => {
        updateBadge();
        sendResponse({ status: 'reset_complete' });
      });
      return true;

    default:
      sendResponse({ status: 'unknown_type' });
      break;
  }
});
