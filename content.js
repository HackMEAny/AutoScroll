// console.log("Content script loaded for Facebook Reels AutoScroll.");
let isAutoScrolling = false;
let currentVideo = null;
let videoEndHandler = null;
let timerInterval = null;

// Listen for messages from popup via background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // console.log("Message received in content script:", request);
  if (request.type === "START_AUTO_SCROLL") {
    // console.log("Starting auto-scroll...");
    isAutoScrolling = true;
    chrome.runtime.sendMessage({
      type: "UPDATE_POPUP_STATUS",
      status: "Running",
    });
    startAutoScroll();
  } else if (request.type === "STOP_AUTO_SCROLL") {
    // console.log("Stopping auto-scroll...");
    isAutoScrolling = false;
    chrome.runtime.sendMessage({
      type: "UPDATE_POPUP_STATUS",
      status: "Stopped",
    });
    stopAutoScroll();
  }
});

// Function to format time as MM:SS
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs
    .toString()
    .padStart(2, "0")}`;
}

// Function to update timer in popup
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

// Function to trigger next reel
function triggerNextReel() {
  // Try multiple selectors for the next button
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
    // console.log("Clicking Next button...");
    nextButton.click();
  } else {
    // Fallback: scroll down by window height
    // console.log("Next button not found. Scrolling down...");
    window.scrollBy(0, window.innerHeight);
  }
}

// Function to get the current playing video
function getCurrentVideo() {
  const videos = document.querySelectorAll("video");
  for (const video of videos) {
    if (!video.paused && !video.ended && video.currentTime > 0) {
      return video;
    }
  }
  return null;
}

// Function to handle video end event
function onVideoEnd() {
  // console.log("Video ended. Triggering next reel...");
  if (isAutoScrolling) {
    // Clear timer interval
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }

    // Send timer update to show 00:00
    chrome.runtime.sendMessage({
      type: "UPDATE_TIMER",
      time: "00:00",
      progress: 100,
    });

    triggerNextReel();

    // Reset current video reference
    currentVideo = null;

    // Restart monitoring after a short delay
    setTimeout(() => {
      if (isAutoScrolling) {
        startAutoScroll();
      }
    }, 1000);
  }
}

// Function to monitor video progress
function monitorVideo() {
  if (!isAutoScrolling) return;

  const video = getCurrentVideo();

  if (video && video !== currentVideo) {
    // New video detected
    // console.log("New video detected");
    currentVideo = video;

    // Clear previous timer interval
    if (timerInterval) {
      clearInterval(timerInterval);
    }

    // Remove previous event listener if exists
    if (videoEndHandler) {
      currentVideo.removeEventListener("ended", videoEndHandler);
    }

    // Add event listener for video end
    videoEndHandler = onVideoEnd.bind(this);
    video.addEventListener("ended", videoEndHandler);

    // Start timer updates
    timerInterval = setInterval(updateTimer, 1000);
  }

  // Update timer for current video
  if (currentVideo) {
    updateTimer();
  }

  // Continue monitoring
  if (isAutoScrolling) {
    setTimeout(monitorVideo, 500);
  }
}

// Start the auto-scroll process
function startAutoScroll() {
  if (!isAutoScrolling) return;

  // console.log("Starting auto-scroll monitoring...");
  monitorVideo();
}

// Stop the auto-scroll process
function stopAutoScroll() {
  isAutoScrolling = false;
  currentVideo = null;

  // Clear timer interval
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  // Remove event listeners
  if (videoEndHandler && currentVideo) {
    currentVideo.removeEventListener("ended", videoEndHandler);
  }

  // Send timer reset message
  chrome.runtime.sendMessage({
    type: "UPDATE_TIMER",
    time: "--:--",
    progress: 0,
  });

  // console.log("Auto-scroll stopped.");
}
