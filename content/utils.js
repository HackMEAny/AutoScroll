/**
 * ReelFlow - Common Utilities for Content Scripts
 */

const ReelUtils = {
  // Dispatches synthetic down arrow key event to trigger next reel
  triggerNextKey() {
    const target = document.activeElement || document.body;
    const events = ['keydown', 'keypress', 'keyup'];
    
    events.forEach(type => {
      const event = new KeyboardEvent(type, {
        key: 'ArrowDown',
        code: 'ArrowDown',
        keyCode: 40,
        which: 40,
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window
      });
      target.dispatchEvent(event);
      document.dispatchEvent(event);
      window.dispatchEvent(event);
    });
  },

  // Dispatches PageDown or custom key event
  triggerKey(key, code, keyCode) {
    const target = document.activeElement || document.body;
    ['keydown', 'keyup'].forEach(type => {
      const event = new KeyboardEvent(type, {
        key: key,
        code: code,
        keyCode: keyCode,
        which: keyCode,
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window
      });
      target.dispatchEvent(event);
      document.dispatchEvent(event);
      window.dispatchEvent(event);
    });
  },

  // Checks if an element is currently visible in viewport
  isInViewport(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const windowHeight = window.innerHeight || document.documentElement.clientHeight;
    const windowWidth = window.innerWidth || document.documentElement.clientWidth;

    // Check vertical overlap of at least 50%
    const vertInView = (rect.top <= windowHeight) && ((rect.top + rect.height) >= 0);
    const horInView = (rect.left <= windowWidth) && ((rect.left + rect.width) >= 0);
    const visibleSize = rect.height > 50 && rect.width > 50;
    
    // Check computed style
    const style = window.getComputedStyle(element);
    const isDisplayed = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';

    return vertInView && horInView && visibleSize && isDisplayed;
  },

  // Formats seconds into HH:MM:SS or MM:SS
  formatTime(totalSeconds) {
    totalSeconds = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    }
    return `${minutes}m ${seconds}s`;
  },

  // Checks if text contains common sponsored / ad markers
  isAdText(text) {
    if (!text || typeof text !== 'string') return false;
    const lower = text.toLowerCase().trim();
    const adKeywords = [
      'sponsored',
      'paid partnership',
      'promoted',
      'advertisement',
      'install now',
      'shop now',
      'download now',
      'learn more'
    ];
    return adKeywords.some(keyword => lower === keyword || lower.startsWith(keyword + ' ') || lower.includes(' ' + keyword));
  },

  // Debounce helper
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }
};

window.ReelUtils = ReelUtils;
