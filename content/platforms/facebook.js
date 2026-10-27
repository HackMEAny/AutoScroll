/**
 * Facebook Reels Adapter for ReelFlow
 */

class FacebookReelsAdapter {
  constructor(controller) {
    this.controller = controller;
    this.platformId = 'facebook';
    this.lastScrollTime = 0;
  }

  isMatchingUrl() {
    return window.location.hostname.includes('facebook.com') && 
           (window.location.pathname.includes('/reel') || window.location.pathname.includes('/watch'));
  }

  getCurrentReelContainer() {
    const video = this.getVideoElement();
    if (!video) return null;
    return video.closest('[role="dialog"]') || 
           video.closest('[role="main"]') || 
           video.closest('div[data-pagelet]') || 
           video.parentElement;
  }

  getVideoElement() {
    const allVideos = Array.from(document.querySelectorAll('video'));
    // Prioritize playing video in viewport
    const playing = allVideos.find(v => ReelUtils.isInViewport(v) && !v.paused);
    if (playing) return playing;

    // Fallback: visible video closest to center
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

    return closestVideo;
  }

  getVideoIdentifier(video) {
    const match = window.location.pathname.match(/\/reel\/([0-9a-zA-Z_-]+)/);
    if (match && match[1]) {
      return match[1];
    }
    return video?.src || video?.currentSrc || 'fb_' + Date.now();
  }

  isCurrentReelAd() {
    const container = this.getCurrentReelContainer();
    if (!container) return false;

    // Check for Sponsored elements
    const spans = container.querySelectorAll('span, a, div');
    for (const el of spans) {
      const text = el.textContent?.trim().toLowerCase();
      if (text === 'sponsored' || text === 'paid partnership') {
        return true;
      }
    }

    // Check aria-labels
    if (container.querySelector('[aria-label*="Sponsored" i], [aria-label*="Advertiser" i]')) {
      return true;
    }

    return false;
  }

  scrollToNext() {
    const now = Date.now();
    if (now - this.lastScrollTime < 700) return;
    this.lastScrollTime = now;

    // 1. Try FB Next Reel navigation button
    const nextBtn = document.querySelector(
      '[aria-label="Next Reel"], [aria-label="Next video"], [aria-label*="Next" i], [aria-label*="down" i]'
    );
    if (nextBtn && ReelUtils.isInViewport(nextBtn) && typeof nextBtn.click === 'function') {
      nextBtn.click();
      return;
    }

    // 2. Try ArrowDown keyboard shortcut
    ReelUtils.triggerNextKey();

    // 3. Fallback: Scroll window
    window.scrollBy({
      top: window.innerHeight * 0.9,
      behavior: 'smooth'
    });
  }
}

window.FacebookReelsAdapter = FacebookReelsAdapter;
