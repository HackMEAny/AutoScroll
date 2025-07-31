if (typeof window.fbReelsAutoScrollLoaded === "undefined") {
  window.fbReelsAutoScrollLoaded = true;

  let isAutoScrolling = false;
  let currentVideo = null;
  let videoEndHandler = null;
  let timerInterval = null;

  // Listen for messages from popup via background
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "START_AUTO_SCROLL") {
      isAutoScrolling = true;
      chrome.runtime.sendMessage({
        type: "UPDATE_POPUP_STATUS",
        status: "Running",
      });
      startAutoScroll();
    } else if (request.type === "STOP_AUTO_SCROLL") {
      isAutoScrolling = false;
      chrome.runtime.sendMessage({
        type: "UPDATE_POPUP_STATUS",
        status: "Stopped",
      });
      stopAutoScroll();
    }
  });

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
      if (nextButton) {
        break;
      }
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
      if (!video.paused && !video.ended && video.currentTime > 0) {
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

    if (video && video !== currentVideo) {
      currentVideo = video;

      if (timerInterval) {
        clearInterval(timerInterval);
      }

      if (videoEndHandler) {
        currentVideo.removeEventListener("ended", videoEndHandler);
      }

      videoEndHandler = onVideoEnd.bind(this);
      video.addEventListener("ended", videoEndHandler);

      timerInterval = setInterval(updateTimer, 1000);
    }

    if (currentVideo) {
      updateTimer();
    }

    if (isAutoScrolling) {
      setTimeout(monitorVideo, 500);
    }
  }

  function startAutoScroll() {
    if (!isAutoScrolling) return;
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
      type: "UPDATE_TIMER",
      time: "--:--",
      progress: 0,
    });
  }
}
