/**
 * YouTube Shorts Adapter for ReelFlow
 */

class YouTubeShortsAdapter {
  constructor(controller) {
    this.controller = controller;
    this.platformId = 'youtube';
    this.lastVideoSrc = null;
    this.lastScrollTime = 0;
  }

  isMatchingUrl() {
    return window.location.hostname.includes('youtube.com') && 
           (window.location.pathname.startsWith('/shorts') || window.location.pathname.includes('/shorts/'));
  }

  getCurrentReelContainer() {
    // 1. YouTube Shorts custom element with is-active attribute
    let container = document.querySelector('ytd-reel-video-renderer[is-active]');
    if (container) return container;

    // 2. Active element with class or property
    container = document.querySelector('ytd-reel-video-renderer.ytd-shorts[is-active]') ||
                document.querySelector('ytd-shorts [is-active]');
    if (container) return container;

    // 3. Find reel-video-renderer containing the currently playing video in viewport
    const videos = Array.from(document.querySelectorAll('ytd-reel-video-renderer video, ytd-shorts video, video'));
    for (const v of videos) {
      if (ReelUtils.isInViewport(v) && (!v.paused || v.currentTime > 0)) {
        return v.closest('ytd-reel-video-renderer') || v.closest('ytd-shorts') || v.parentElement;
      }
    }

    return document.querySelector('ytd-reel-video-renderer');
  }

  getVideoElement() {
    // Priority 1: Video inside active reel renderer
    const activeRenderer = document.querySelector('ytd-reel-video-renderer[is-active]');
    if (activeRenderer) {
      const vid = activeRenderer.querySelector('video.video-stream, video');
      if (vid) return vid;
    }

    // Priority 2: Playing video in viewport
    const allVideos = Array.from(document.querySelectorAll('video'));
    const playing = allVideos.find(v => ReelUtils.isInViewport(v) && !v.paused && v.duration > 0);
    if (playing) return playing;

    // Priority 3: Video closest to center of screen
    const windowCenter = window.innerHeight / 2;
    let closestVideo = null;
    let minDistance = Infinity;

    for (const v of allVideos) {
      if (ReelUtils.isInViewport(v)) {
        const rect = v.getBoundingClientRect();
        const dist = Math.abs((rect.top + rect.height / 2) - windowCenter);
        if (dist < minDistance) {
          minDistance = dist;
          closestVideo = v;
        }
      }
    }

    return closestVideo || allVideos[0];
  }

  getVideoIdentifier(video) {
    const match = window.location.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      return match[1];
    }
    const container = this.getCurrentReelContainer();
    if (container && container.id) {
      return container.id;
    }
    return video?.src || video?.currentSrc || 'yt_' + Date.now();
  }

  isCurrentReelAd() {
    const container = this.getCurrentReelContainer();
    if (!container) return false;

    // Check YouTube specific ad markers
    const adSelectors = [
      'ytd-ad-slot-renderer',
      '.ytd-ad-slot-renderer',
      '#ad-badge',
      '.badge-shape-wiz--ad',
      '.ytd-reel-player-overlay-renderer ytd-ad-slot-renderer',
      'ytd-reel-player-header-renderer .badge-shape-wiz',
      '[aria-label*="Sponsored" i]',
      '[aria-label*="Advertisement" i]'
    ];

    for (const selector of adSelectors) {
      const el = container.querySelector(selector);
      if (el && ReelUtils.isInViewport(el)) return true;
    }

    // Check visible text markers in overlay
    const overlay = container.querySelector('#overlay, .ytd-reel-player-overlay-renderer');
    if (overlay) {
      const badges = overlay.querySelectorAll('.yt-core-attributed-string, span, div');
      for (const b of badges) {
        if (ReelUtils.isAdText(b.textContent)) {
          return true;
        }
      }
    }

    return false;
  }

  scrollToNext() {
    const now = Date.now();
    if (now - this.lastScrollTime < 700) return; // Prevent spamming
    this.lastScrollTime = now;

    // 1. Try YouTube Shorts native down/next navigation button
    const selectors = [
      '#navigation-button-down ytd-button-renderer button',
      '#navigation-button-down button',
      'ytd-shorts #navigation-button-down button',
      'ytd-shorts-player-controls #navigation-button-down button',
      'button[aria-label="Next video"]',
      'button[aria-label*="Next" i]',
      'button[aria-label*="next short" i]'
    ];

    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn && typeof btn.click === 'function' && ReelUtils.isInViewport(btn)) {
        btn.click();
        return;
      }
    }

    // 2. Try native shortcut: YouTube Shorts listens for 'j' (next item) and 'ArrowDown' / 'PageDown'
    const target = document.activeElement || document.body;
    ['j', 'ArrowDown', 'PageDown'].forEach(key => {
      const keyCode = key === 'ArrowDown' ? 40 : key === 'PageDown' ? 34 : 74;
      ['keydown', 'keyup'].forEach(type => {
        const ev = new KeyboardEvent(type, {
          key: key,
          code: key === 'j' ? 'KeyJ' : key,
          keyCode: keyCode,
          which: keyCode,
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window
        });
        target.dispatchEvent(ev);
        document.dispatchEvent(ev);
        window.dispatchEvent(ev);
      });
    });

    // 3. Programmatic container scroll fallback
    const shortsContainer = document.querySelector('#shorts-container, ytd-shorts, #page-manager ytd-shorts');
    if (shortsContainer && shortsContainer.scrollHeight > shortsContainer.clientHeight) {
      shortsContainer.scrollBy({
        top: window.innerHeight * 0.95,
        behavior: 'smooth'
      });
    } else {
      window.scrollBy({
        top: window.innerHeight * 0.95,
        behavior: 'smooth'
      });
    }
  }
}

window.YouTubeShortsAdapter = YouTubeShortsAdapter;
