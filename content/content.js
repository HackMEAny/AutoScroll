/**
 * ReelFlow - Main Content Script Orchestrator
 */

(function () {
  'use strict';

  // Prevent multiple initializations in same frame
  if (window.__ReelFlowInitialized) return;
  window.__ReelFlowInitialized = true;

  class ReelFlowContentController {
    constructor() {
      this.adapter = null;
      this.currentVideo = null;
      this.currentVideoId = null;
      this.videoPlayStartTime = 0;
      this.activeWatchSeconds = 0;
      this.hasCountedCurrentReel = false;
      this.isScrolling = false;
      this.scrollTimer = null;
      this.heartbeatTimer = null;
      this.lastVideoTime = 0;

      // Settings state
      this.settings = {
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

      // Live stats for HUD
      this.sessionStats = {
        reelsWatched: 0,
        secondsSpent: 0
      };

      this.hudEl = null;
      this.isCollapsed = false;

      this.init();
    }

    init() {
      this.detectPlatform();
      if (!this.adapter) return;

      this.loadSettings();
      this.setupStorageListener();
      this.createHUD();
      this.startMonitoring();
      this.startTimeTracker();

      // YouTube / SPA navigation listener
      window.addEventListener('yt-navigate-finish', () => {
        this.currentVideoId = null;
        this.currentVideo = null;
        this.isScrolling = false;
        if (this.scrollTimer) {
          clearTimeout(this.scrollTimer);
          this.scrollTimer = null;
        }
      });
      window.addEventListener('popstate', () => {
        this.currentVideoId = null;
      });
    }

    detectPlatform() {
      const hostname = window.location.hostname;
      if (hostname.includes('youtube.com')) {
        this.adapter = new window.YouTubeShortsAdapter(this);
      } else if (hostname.includes('instagram.com')) {
        this.adapter = new window.InstagramReelsAdapter(this);
      } else if (hostname.includes('facebook.com')) {
        this.adapter = new window.FacebookReelsAdapter(this);
      }
    }

    async loadSettings() {
      try {
        const stored = await chrome.storage.local.get(['reelflow_settings', 'reelflow_stats']);
        if (stored.reelflow_settings) {
          this.settings = { ...this.settings, ...stored.reelflow_settings };
        }
        if (stored.reelflow_stats) {
          const todayKey = new Date().toISOString().split('T')[0];
          const todayData = stored.reelflow_stats.daily?.[todayKey] || {};
          const platData = todayData[this.adapter.platformId] || { count: 0, time: 0 };
          this.sessionStats.reelsWatched = platData.count || 0;
          this.sessionStats.secondsSpent = platData.time || 0;
        }
      } catch (e) {
        console.warn('[ReelFlow] Could not load initial settings:', e);
      }
    }

    setupStorageListener() {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') {
          if (changes.reelflow_settings) {
            this.settings = { ...this.settings, ...changes.reelflow_settings.newValue };
            this.updateHUD();
          }
          if (changes.reelflow_stats) {
            const todayKey = new Date().toISOString().split('T')[0];
            const todayData = changes.reelflow_stats.newValue?.daily?.[todayKey] || {};
            const platData = todayData[this.adapter?.platformId] || { count: 0, time: 0 };
            this.sessionStats.reelsWatched = platData.count || 0;
            this.sessionStats.secondsSpent = platData.time || 0;
            this.updateHUD();
          }
        }
      });
    }

    isPlatformEnabled() {
      if (!this.settings.masterEnabled) return false;
      const pid = this.adapter?.platformId;
      return this.settings.platformSettings?.[pid] !== false;
    }

    createHUD() {
      if (document.getElementById('reelflow-hud-root')) return;

      const root = document.createElement('div');
      root.id = 'reelflow-hud-root';
      root.innerHTML = `
        <div class="rf-hud-container" id="rf-hud-container">
          <div class="rf-badge-logo" title="ReelFlow Active">
            <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-9l6 4.5-6 4.5z"/></svg>
          </div>
          <div class="rf-status-indicator" id="rf-status-indicator" title="Active"></div>
          <div class="rf-info-text">
            <div class="rf-title-row">
              <span id="rf-status-label">AutoScroll ON</span>
            </div>
            <div class="rf-stats-row">
              <span class="rf-stat-item">Reels: <strong id="rf-reels-count">0</strong></span>
              <span class="rf-stat-item">Wasted: <strong id="rf-time-spent">0m</strong></span>
            </div>
          </div>
          <div class="rf-hud-actions">
            <button class="rf-btn-icon" id="rf-btn-toggle" title="Pause / Resume AutoScroll">
              <svg id="rf-icon-pause" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            </button>
            <button class="rf-btn-icon" id="rf-btn-skip" title="Skip to Next Reel">
              <svg viewBox="0 0 24 24"><path d="M7 6v12l8.5-6L7 6zm9 0v12h2V6h-2z"/></svg>
            </button>
            <button class="rf-btn-icon" id="rf-btn-minimize" title="Collapse / Expand HUD">
              <svg viewBox="0 0 24 24"><path d="M19 13H5v-2h14v2z"/></svg>
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(root);
      this.hudEl = root;

      const btnToggle = root.querySelector('#rf-btn-toggle');
      btnToggle?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleAutoScroll();
      });

      const btnSkip = root.querySelector('#rf-btn-skip');
      btnSkip?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.triggerScroll('Manual user skip');
      });

      const btnMinimize = root.querySelector('#rf-btn-minimize');
      const container = root.querySelector('#rf-hud-container');
      btnMinimize?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.isCollapsed = !this.isCollapsed;
        container?.classList.toggle('collapsed', this.isCollapsed);
      });

      container?.addEventListener('click', () => {
        if (this.isCollapsed) {
          this.isCollapsed = false;
          container.classList.remove('collapsed');
        }
      });

      this.updateHUD();
    }

    showToast(message) {
      if (!this.hudEl) return;
      const toast = document.createElement('div');
      toast.className = 'rf-toast';
      toast.textContent = message;
      this.hudEl.appendChild(toast);
      setTimeout(() => toast.remove(), 2600);
    }

    toggleAutoScroll() {
      this.settings.masterEnabled = !this.settings.masterEnabled;
      chrome.storage.local.get(['reelflow_settings'], (res) => {
        const s = res.reelflow_settings || {};
        s.masterEnabled = this.settings.masterEnabled;
        chrome.storage.local.set({ reelflow_settings: s });
      });
      this.updateHUD();
    }

    updateHUD() {
      if (!this.hudEl) return;

      const enabled = this.isPlatformEnabled();
      this.hudEl.style.display = this.settings.showHUD ? 'block' : 'none';

      const statusIndicator = this.hudEl.querySelector('#rf-status-indicator');
      const statusLabel = this.hudEl.querySelector('#rf-status-label');
      const reelsCount = this.hudEl.querySelector('#rf-reels-count');
      const timeSpent = this.hudEl.querySelector('#rf-time-spent');
      const iconPause = this.hudEl.querySelector('#rf-icon-pause');

      if (statusIndicator) {
        statusIndicator.className = 'rf-status-indicator ' + (enabled ? '' : 'paused');
      }
      if (statusLabel) {
        statusLabel.textContent = enabled ? 'AutoScroll ON' : 'AutoScroll PAUSED';
      }
      if (reelsCount) {
        reelsCount.textContent = this.sessionStats.reelsWatched;
      }
      if (timeSpent) {
        timeSpent.textContent = ReelUtils.formatTime(this.sessionStats.secondsSpent);
      }
      if (iconPause) {
        iconPause.innerHTML = enabled 
          ? '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>'
          : '<path d="M8 5v14l11-7z"/>';
      }
    }

    startMonitoring() {
      setInterval(() => {
        this.checkCurrentReel();
      }, 350);
    }

    checkCurrentReel() {
      if (!this.adapter?.isMatchingUrl()) return;

      const video = this.adapter.getVideoElement();
      if (!video) return;

      const videoId = this.adapter.getVideoIdentifier(video);

      // New video detected
      if (videoId !== this.currentVideoId) {
        this.onNewVideoDetected(video, videoId);
      }

      // Check for ads immediately if ad skipping is enabled
      // Guard: On Instagram, only check ad after video has loaded duration (>0) to avoid false positives on unrendered headers
      if (this.isPlatformEnabled() && this.settings.skipAds) {
        if (this.adapter.isCurrentReelAd()) {
          this.handleAdDetected();
          return;
        }
      }

      // Check video progress for auto-scroll
      if (this.isPlatformEnabled() && !this.isScrolling) {
        this.checkVideoCompletion(video);
      }
    }

    onNewVideoDetected(video, videoId) {
      console.log(`[ReelFlow] 🎬 New video detected [${this.adapter.platformId}]:`, videoId, {
        duration: video.duration,
        currentTime: video.currentTime,
        paused: video.paused
      });
      this.currentVideo = video;
      this.currentVideoId = videoId;
      this.hasCountedCurrentReel = false;
      this.videoPlayStartTime = Date.now();
      this.activeWatchSeconds = 0;
      this.isScrolling = false;
      this.lastVideoTime = 0;
      if (this.scrollTimer) {
        clearTimeout(this.scrollTimer);
        this.scrollTimer = null;
      }

      // Disable video loop if browser allows it, so native 'ended' fires reliably
      try {
        video.loop = false;
      } catch (e) {}

      // Attach ended listener
      video.onended = () => {
        if (this.isPlatformEnabled()) {
          console.log('[ReelFlow] Event: video.ended triggered');
          this.queueScroll('Video ended naturally');
        }
      };

      // Handle video loop detection for both YouTube Shorts and Instagram Reels
      video.ontimeupdate = () => {
        if (!this.isPlatformEnabled() || this.isScrolling) return;

        // Loop detection: currentTime wrapped from > 80% duration back to < 0.6s
        if (this.lastVideoTime > 1.5 && video.duration > 2) {
          const wasNearEnd = (video.duration - this.lastVideoTime) <= 0.8;
          const isAtStart = video.currentTime < 0.6;
          if (wasNearEnd && isAtStart) {
            console.log(`[ReelFlow] 🔄 Loop detected: wasNearEnd (${this.lastVideoTime.toFixed(1)}/${video.duration.toFixed(1)}) -> now (${video.currentTime.toFixed(1)})`);
            this.queueScroll('Video loop detected');
            return;
          }
        }
        this.lastVideoTime = video.currentTime;
      };
    }

    handleAdDetected() {
      if (this.isScrolling) return;
      this.isScrolling = true;

      console.warn(`[ReelFlow] 🚫 Ad detected on [${this.adapter.platformId}]! Triggering skip.`);

      // Indicator in HUD
      const indicator = this.hudEl?.querySelector('#rf-status-indicator');
      if (indicator) indicator.className = 'rf-status-indicator skipping';
      this.showToast('Skipping Sponsored Ad');

      // Send stat
      chrome.runtime.sendMessage({
        type: 'LOG_AD_SKIPPED',
        platform: this.adapter.platformId
      });

      // Quick scroll past the ad with retries in case Instagram's snap container resists
      this.adapter.scrollToNext();

      // Retry scroll at 250ms and 500ms to guarantee scrolling through sticky ad carousels
      setTimeout(() => {
        if (this.adapter.isCurrentReelAd()) {
          console.log('[ReelFlow] Ad still in view, retrying scroll (attempt 2)...');
          this.adapter.scrollToNext();
        }
      }, 250);

      setTimeout(() => {
        if (this.adapter.isCurrentReelAd()) {
          console.log('[ReelFlow] Ad still in view, retrying scroll (attempt 3)...');
          this.adapter.scrollToNext();
        }
        this.isScrolling = false;
        this.updateHUD();
      }, 700);
    }

    checkVideoCompletion(video) {
      if (!video || isNaN(video.duration) || video.duration <= 0) return;

      // Option to cap maximum watch duration (e.g. if user set 45s cap)
      if (this.settings.maxDuration > 0 && video.currentTime >= this.settings.maxDuration) {
        console.log('[ReelFlow] Max watch duration exceeded:', this.settings.maxDuration);
        this.queueScroll(`Max duration limit reached (${this.settings.maxDuration}s)`);
        return;
      }

      // Check remaining playback time (threshold lowered to 0.45s so slow frames don't miss it)
      const remaining = video.duration - video.currentTime;
      if (remaining <= 0.45 && video.currentTime > 1.2) {
        console.log(`[ReelFlow] Reached completion threshold: remaining=${remaining.toFixed(2)}s`);
        this.queueScroll('Video reached end threshold');
        return;
      }

      // Loop detection fallback inside checkVideoCompletion in case ontimeupdate was swallowed
      if (this.lastVideoTime > 1.5 && video.duration > 2) {
        const wasNearEnd = (video.duration - this.lastVideoTime) <= 1.0;
        const isAtStart = video.currentTime < 0.8;
        if (wasNearEnd && isAtStart) {
          console.log(`[ReelFlow] Loop detected (fallback): lastTime=${this.lastVideoTime.toFixed(1)}, currTime=${video.currentTime.toFixed(1)}`);
          this.queueScroll('Video loop detected');
          return;
        }
      }
      this.lastVideoTime = video.currentTime;
    }

    queueScroll(reason) {
      if (this.isScrolling || this.scrollTimer) return;

      const delay = Math.max(0.1, Number(this.settings.scrollDelay) || 0.5);
      console.log(`[ReelFlow] ⏳ Queuing auto-scroll in ${delay}s. Reason: "${reason}"`);

      this.scrollTimer = setTimeout(() => {
        this.triggerScroll(reason);
      }, delay * 1000);
    }

    triggerScroll(reason) {
      if (this.isScrolling) return;
      this.isScrolling = true;
      if (this.scrollTimer) {
        clearTimeout(this.scrollTimer);
        this.scrollTimer = null;
      }

      console.log(`[ReelFlow] 🚀 Executing scrollToNext. Reason: "${reason}"`);
      this.adapter.scrollToNext();

      setTimeout(() => {
        this.isScrolling = false;
      }, 800);
    }

    startTimeTracker() {
      // Periodic tracker: check active viewing every 1 second
      setInterval(() => {
        const isTabActive = !document.hidden;
        const video = this.currentVideo;
        const isPlaying = video && !video.paused && !video.ended && ReelUtils.isInViewport(video);

        if (isTabActive && isPlaying && this.adapter?.isMatchingUrl()) {
          this.activeWatchSeconds++;
          this.sessionStats.secondsSpent++;

          // If watched >= 2.5 seconds and not yet counted as a watched reel
          if (!this.hasCountedCurrentReel && this.activeWatchSeconds >= 2.5) {
            this.hasCountedCurrentReel = true;
            this.sessionStats.reelsWatched++;

            chrome.runtime.sendMessage({
              type: 'LOG_REEL',
              platform: this.adapter.platformId,
              reelId: this.currentVideoId
            });
          }

          // Send heartbeat every 3 seconds to background
          if (this.activeWatchSeconds % 3 === 0) {
            chrome.runtime.sendMessage({
              type: 'LOG_TIME',
              platform: this.adapter.platformId,
              seconds: 3
            });
          }

          this.updateHUD();
        }
      }, 1000);
    }
  }

  // Initialize once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new ReelFlowContentController());
  } else {
    new ReelFlowContentController();
  }
})();
