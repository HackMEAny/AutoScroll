if (typeof window.fbReelsAutoScrollLoaded === "undefined") {
  window.fbReelsAutoScrollLoaded = true;

  let isAutoScrolling = false;
  let currentVideo = null;
  let videoEndHandler = null;
  let timerInterval = null;

  const initialize = () => {
    chrome.storage.local.get("autoScrollStatus", (result) => {
      if (result.autoScrollStatus === "Running") {
        isAutoScrolling = true;
        startAutoScroll();
      }
    });
  };

  if (document.readyState === "loading") {
    window.addEventListener("load", initialize);
  } else {
    initialize();
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "START_AUTO_SCROLL") {
      if (!isAutoScrolling) {
        isAutoScrolling = true;
        startAutoScroll();
      }
    } else if (request.type === "STOP_AUTO_SCROLL") {
      if (isAutoScrolling) {
        isAutoScrolling = false;
        stopAutoScroll();
      }
    }
  });

  function isSponsored(videoElement) {
    let parent = videoElement.parentElement;
    for (let i = 0; i < 10; i++) {
      if (!parent) return false;
      const sponsoredText = Array.from(
        parent.querySelectorAll("span, div, a")
      ).find((el) => el.textContent.trim() === "Sponsored");
      if (sponsoredText) {
        return true;
      }
      parent = parent.parentElement;
    }
    return false;
  }

  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  }

  function updateTimer() {
    if (currentVideo) {
      const currentTime = currentVideo.currentTime;
      const duration = currentVideo.duration;
      if (!isNaN(duration) && duration > 0) {
        const timeRemaining = duration - currentTime;
        chrome.runtime.sendMessage({
          type: "UPDATE_TIMER",
          time: formatTime(timeRemaining),
          progress: Math.round((currentTime / duration) * 100),
        });
      }
    }
  }

  function triggerNextReel() {
    const nextButtonSelectors = [
      '[aria-label="Next card"]',
      'div[role="button"][tabindex="0"] > div > div > div:nth-child(2)',
      'div[aria-label="Next"]',
      'div[data-name="RightColumn"] div[role="button"]',
    ];
    let nextButton = null;
    for (const selector of nextButtonSelectors) {
      nextButton = document.querySelector(selector);
      if (nextButton) break;
    }
    if (nextButton) {
      nextButton.click();
    } else {
      window.scrollBy(0, window.innerHeight);
    }
  }

  function getCurrentVideo() {
    const videos = document.querySelectorAll("video");
    for (const video of videos) {
      // A more robust check for the currently active video
      const rect = video.getBoundingClientRect();
      if (
        rect.top >= 0 &&
        rect.bottom <= window.innerHeight &&
        video.currentTime > 0 &&
        !video.paused
      ) {
        return video;
      }
    }
    return null;
  }

  function onVideoEnd() {
    if (isAutoScrolling) {
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
      chrome.runtime.sendMessage({
        type: "UPDATE_TIMER",
        time: "00:00",
        progress: 100,
      });
      triggerNextReel();
      currentVideo = null;
      setTimeout(() => {
        if (isAutoScrolling) {
          startAutoScroll();
        }
      }, 1000);
    }
  }

  function monitorVideo() {
    if (!isAutoScrolling) return;

    const video = getCurrentVideo();
    let nextCheckDelay = 500;

    if (video) {
      if (!currentVideo || video.src !== currentVideo.src) {
        if (isSponsored(video)) {
          triggerNextReel();
          nextCheckDelay = 1500; // Wait longer after skipping an ad
        } else {
          currentVideo = video;
          if (timerInterval) clearInterval(timerInterval);
          if (videoEndHandler)
            currentVideo.removeEventListener("ended", videoEndHandler);
          videoEndHandler = onVideoEnd.bind(this);
          video.addEventListener("ended", videoEndHandler);
          timerInterval = setInterval(updateTimer, 1000);
        }
      }
    }

    if (currentVideo) {
      updateTimer();
    }

    setTimeout(monitorVideo, nextCheckDelay);
  }

  function startAutoScroll() {
    if (!isAutoScrolling) return;
    chrome.runtime.sendMessage({
      type: "UPDATE_POPUP_STATUS",
      status: "Running",
    });
    monitorVideo();
  }

  function stopAutoScroll() {
    isAutoScrolling = false;
    currentVideo = null;
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    if (videoEndHandler && currentVideo) {
      currentVideo.removeEventListener("ended", videoEndHandler);
    }
    chrome.runtime.sendMessage({
      type: "UPDATE_POPUP_STATUS",
      status: "Stopped",
    });
    chrome.runtime.sendMessage({
      type: "UPDATE_TIMER",
      time: "--:--",
      progress: 0,
    });
  }
}
