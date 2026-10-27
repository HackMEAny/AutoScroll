/**
 * Instagram Reels Adapter for ReelFlow
 * Conservative, rock-solid ad-detection & scroll navigation.
 */

class InstagramReelsAdapter {
  constructor(controller) {
    this.controller = controller;
    this.platformId = 'instagram';
    this.lastScrollTime = 0;
  }

  isMatchingUrl() {
    return window.location.hostname.includes('instagram.com') && 
           (window.location.pathname.includes('/reels') || 
            window.location.pathname.includes('/reel/') || 
            window.location.pathname === '/' || 
            window.location.pathname.startsWith('/explore'));
  }

  getCurrentReelContainer() {
    const video = this.getVideoElement();
    if (!video) return null;
    return video.closest('article') || video.closest('section') || video.closest('div[role="dialog"]') || video.parentElement;
  }

  getVideoElement() {
    const allVideos = Array.from(document.querySelectorAll('video'));
    if (!allVideos.length) return null;

    // Filter to videos in viewport with height > 80px
    const inViewVideos = allVideos.filter(v => {
      const rect = v.getBoundingClientRect();
      const visible = rect.bottom > 50 && rect.top < (window.innerHeight - 50) && rect.height > 80;
      return visible;
    });

    if (!inViewVideos.length) {
      const fallback = allVideos.find(v => {
        const rect = v.getBoundingClientRect();
        return rect.height > 50 && rect.width > 50;
      });
      return fallback || allVideos[0];
    }

    // On Instagram Reels, there is only 1 playing video in view
    const playing = inViewVideos.find(v => !v.paused);
    if (playing) return playing;

    // Otherwise find video closest to vertical center
    const windowCenter = window.innerHeight / 2;
    let closestVideo = inViewVideos[0];
    let minDistance = Infinity;

    for (const v of inViewVideos) {
      const rect = v.getBoundingClientRect();
      const dist = Math.abs((rect.top + rect.height / 2) - windowCenter);
      if (dist < minDistance) {
        minDistance = dist;
        closestVideo = v;
      }
    }

    return closestVideo;
  }

  getVideoIdentifier(video) {
    if (!video) return 'ig_' + Date.now();

    // 1. Check video dataset or internal cache id
    if (video._rf_id) return video._rf_id;

    // 2. Check current URL path
    const match = window.location.pathname.match(/\/reel(?:s)?\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      video._rf_id = match[1];
      return match[1];
    }

    // 3. Anchor link inside article
    const container = this.getCurrentReelContainer();
    if (container) {
      const link = container.querySelector('a[href*="/reel/"]');
      if (link) {
        const m = link.getAttribute('href').match(/\/reel\/([a-zA-Z0-9_-]+)/);
        if (m && m[1]) {
          video._rf_id = m[1];
          return m[1];
        }
      }
    }

    // 4. Stable video src
    if (video.currentSrc || video.src) {
      const srcId = (video.currentSrc || video.src).split('?')[0];
      video._rf_id = srcId;
      return srcId;
    }

    const fallbackId = 'ig_' + Math.random().toString(36).substring(2, 9);
    video._rf_id = fallbackId;
    return fallbackId;
  }

  /**
   * Safe Ad Detection:
   * Only flags when there is 100% indisputable evidence that the reel is sponsored/paid,
   * completely ignoring caption text, comments, and regular usernames.
   */
  isCurrentReelAd() {
    const container = this.getCurrentReelContainer();
    if (!container) return false;

    // 1. Check for explicit Sponsored / Paid partnership aria-labels on container children
    const sponsoredAttr = container.querySelector('[aria-label="Sponsored" i], [aria-label="Paid partnership" i]');
    if (sponsoredAttr) {
      console.log('[ReelFlow:IG] Ad flagged by exact aria-label attribute:', sponsoredAttr);
      return true;
    }

    // 2. Check within the top <header> for a standalone badge whose sole text is "sponsored"
    const header = container.querySelector('header');
    if (header) {
      const spans = header.querySelectorAll('span');
      for (const span of spans) {
        // Must be a leaf node with exact text
        if (span.children.length === 0) {
          const txt = span.textContent?.trim().toLowerCase();
          if (txt === 'sponsored' || txt === 'paid partnership') {
            console.log('[ReelFlow:IG] Ad flagged by header badge:', txt, span);
            return true;
          }
        }
      }
    }

    // 3. Official Instagram ad action bar overlay linking to /ads/
    const adLinks = container.querySelectorAll('a[href^="/ads/"], a[href*="instagram.com/ads/"]');
    if (adLinks.length > 0) {
      console.log('[ReelFlow:IG] Ad flagged by Instagram ads URL:', adLinks[0]);
      return true;
    }

    return false;
  }

  scrollToNext() {
    const now = Date.now();
    if (now - this.lastScrollTime < 600) return;
    this.lastScrollTime = now;

    // Method 1: Target Instagram's next reel navigation button or SVG
    const nextButtons = Array.from(document.querySelectorAll('button, div[role="button"], span[role="button"]'));
    for (const btn of nextButtons) {
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (aria.includes('down') || aria.includes('next')) {
        btn.click();
        return;
      }
      const svg = btn.querySelector('svg');
      if (svg) {
        const svgAria = (svg.getAttribute('aria-label') || '').toLowerCase();
        if (svgAria.includes('down') || svgAria.includes('next')) {
          btn.click();
          return;
        }
      }
    }

    // Method 2: Target the next reel container and scroll it into view
    const currentContainer = this.getCurrentReelContainer();
    if (currentContainer) {
      let nextNode = currentContainer.nextElementSibling;
      while (nextNode && !nextNode.querySelector('video') && nextNode.tagName !== 'ARTICLE') {
        nextNode = nextNode.nextElementSibling;
      }
      if (nextNode) {
        nextNode.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    }

    // Method 3: Mouse Wheel scroll simulation
    const wheelTarget = this.getVideoElement() || currentContainer || document.querySelector('main') || window;
    const wheelEv = new WheelEvent('wheel', {
      deltaY: window.innerHeight || 800,
      deltaMode: 0,
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window
    });
    wheelTarget.dispatchEvent(wheelEv);
    window.dispatchEvent(wheelEv);
    document.dispatchEvent(wheelEv);

    // Method 4: Focus target and trigger native keyboard navigation
    const focusTarget = this.getVideoElement() || document.activeElement || document.body;
    try {
      focusTarget.focus({ preventScroll: true });
    } catch (e) {}

    ['ArrowDown', 'PageDown'].forEach(key => {
      const code = key === 'ArrowDown' ? 40 : 34;
      [window, document, document.body, focusTarget].forEach(target => {
        ['keydown', 'keyup'].forEach(type => {
          try {
            const ev = new KeyboardEvent(type, {
              key: key,
              code: key,
              keyCode: code,
              which: code,
              bubbles: true,
              cancelable: true,
              composed: true,
              view: window
            });
            target.dispatchEvent(ev);
          } catch (e) {}
        });
      });
    });

    // Method 5: Find scroll container and scroll by window.innerHeight
    const scrollContainers = [
      document.querySelector('main div[style*="overflow"]'),
      document.querySelector('main article')?.parentElement,
      document.querySelector('main section')?.parentElement,
      document.querySelector('main'),
      document.scrollingElement || document.documentElement,
      window
    ].filter(Boolean);

    for (const sc of scrollContainers) {
      if (sc === window) {
        window.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
      } else if (sc.scrollHeight > sc.clientHeight) {
        sc.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
        break;
      }
    }
  }
}

window.InstagramReelsAdapter = InstagramReelsAdapter;
