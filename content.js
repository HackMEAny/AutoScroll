if (typeof window.fbReelsAutoScrollLoaded === "undefined") {
  window.fbReelsAutoScrollLoaded = true;

  let isAutoScrolling = false;
  let currentVideo = null;
  let videoEndHandler = null;
  let timerInterval = null;
  let playbackSpeed = 1.0; // Default playback speed
  let watchDuration = "full"; // Default watch duration (full video)
  let customDurationTimer = null; // Timer for custom duration

  const initialize = () => {
    chrome.storage.local.get(
      ["autoScrollStatus", "playbackSpeed", "watchDuration"],
      (result) => {
        if (result.autoScrollStatus === "Running") {
          isAutoScrolling = true;
          startAutoScroll();
        }
        if (result.playbackSpeed) {
          playbackSpeed = parseFloat(result.playbackSpeed);
          console.log("Loaded playback speed from storage:", playbackSpeed);
        }
        if (result.watchDuration) {
          watchDuration = result.watchDuration;
          console.log("Loaded watch duration from storage:", watchDuration);
        }
      }
    );
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
    } else if (request.type === "SET_PLAYBACK_SPEED") {
      playbackSpeed = parseFloat(request.speed);
      console.log("Setting playback speed to:", playbackSpeed);
      // Apply speed to current video if one is playing
      if (currentVideo) {
        try {
          console.log("Video element:", currentVideo);
          console.log(
            "Video playbackRate property:",
            currentVideo.playbackRate
          );
          console.log(
            "Video playbackRate property writable:",
            Object.getOwnPropertyDescriptor(
              Object.getPrototypeOf(currentVideo),
              "playbackRate"
            )
          );
          currentVideo.playbackRate = playbackSpeed;
          console.log(
            "Applied playback speed to current video:",
            currentVideo.playbackRate
          );
        } catch (error) {
          console.error("Failed to set playback rate:", error);
        }
      }
    } else if (request.type === "SET_WATCH_DURATION") {
      console.log(
        "Received SET_WATCH_DURATION message, duration:",
        request.duration
      );
      watchDuration = request.duration;
      console.log("Set watchDuration to:", watchDuration);
      // Clear any existing custom duration timer
      if (customDurationTimer) {
        console.log("Clearing existing custom duration timer");
        clearTimeout(customDurationTimer);
        customDurationTimer = null;
      }
      // If we have a current video and a custom duration is set, start the timer
      if (currentVideo && watchDuration !== "full") {
        console.log("Starting custom duration timer for current video");
        startCustomDurationTimer();
      } else {
        console.log(
          "Not starting custom duration timer - currentVideo:",
          currentVideo,
          "watchDuration:",
          watchDuration
        );
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
    console.log("triggerNextReel called");
    const nextButtonSelectors = [
      '[aria-label="Next card"]',
      'div[role="button"][tabindex="0"] > div > div > div:nth-child(2)',
      'div[aria-label="Next"]',
      'div[data-name="RightColumn"] div[role="button"]',
    ];
    let nextButton = null;
    for (const selector of nextButtonSelectors) {
      nextButton = document.querySelector(selector);
      console.log("Trying selector:", selector, "found:", nextButton);
      if (nextButton) break;
    }
    if (nextButton) {
      console.log("Clicking next button");
      nextButton.click();
    } else {
      console.log("No next button found, scrolling by window height");
      window.scrollBy(0, window.innerHeight);
    }
  }

  function getCurrentVideo() {
    const videos = document.querySelectorAll("video");
    for (const video of videos) {
      // A more robust check for the currently active video
      const rect = video.getBoundingClientRect();
      if (rect.top >= 0 && rect.bottom <= window.innerHeight && !video.paused) {
        return video;
      }
    }
    return null;
  }

  function onVideoEnd() {
    console.log("onVideoEnd called, isAutoScrolling:", isAutoScrolling);
    if (isAutoScrolling) {
      console.log("Processing video end");
      if (timerInterval) {
        console.log("Clearing timer interval");
        clearInterval(timerInterval);
        timerInterval = null;
      }
      chrome.runtime.sendMessage({
        type: "UPDATE_TIMER",
        time: "00:00",
        progress: 100,
      });
      console.log("Triggering next reel");
      triggerNextReel();
      currentVideo = null;
      // Clear custom duration timer
      if (customDurationTimer) {
        console.log("Clearing custom duration timer");
        clearTimeout(customDurationTimer);
        customDurationTimer = null;
      }
      setTimeout(() => {
        if (isAutoScrolling) {
          console.log("Restarting auto scroll");
          startAutoScroll();
        }
      }, 1000);
    }
  }

  function startCustomDurationTimer() {
    console.log(
      "Starting custom duration timer, watchDuration:",
      watchDuration,
      "currentVideo:",
      currentVideo
    );
    // Clear any existing timer
    if (customDurationTimer) {
      console.log("Clearing existing custom duration timer");
      clearTimeout(customDurationTimer);
      customDurationTimer = null;
    }

    // Only start timer if we have a custom duration (not "full")
    if (watchDuration !== "full" && currentVideo) {
      const durationSeconds = parseInt(watchDuration);
      console.log(
        "Setting custom duration timer for",
        durationSeconds,
        "seconds"
      );
      if (!isNaN(durationSeconds) && durationSeconds > 0) {
        customDurationTimer = setTimeout(() => {
          console.log("Custom duration timer expired, triggering next reel");
          // Trigger next reel when custom duration is reached
          if (isAutoScrolling) {
            onVideoEnd();
          }
        }, durationSeconds * 1000);
      }
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
          // Apply playback speed to the new video
          console.log(
            "Detected new video, applying playback speed:",
            playbackSpeed
          );
          try {
            console.log("Video element:", currentVideo);
            console.log(
              "Video playbackRate property:",
              currentVideo.playbackRate
            );
            console.log(
              "Video playbackRate property writable:",
              Object.getOwnPropertyDescriptor(
                Object.getPrototypeOf(currentVideo),
                "playbackRate"
              )
            );
            currentVideo.playbackRate = playbackSpeed;
            console.log(
              "Playback speed applied, current rate:",
              currentVideo.playbackRate
            );
          } catch (error) {
            console.error("Failed to set playback rate on new video:", error);
          }
          if (timerInterval) clearInterval(timerInterval);
          if (videoEndHandler)
            currentVideo.removeEventListener("ended", videoEndHandler);
          videoEndHandler = onVideoEnd.bind(this);
          video.addEventListener("ended", videoEndHandler);
          timerInterval = setInterval(updateTimer, 1000);

          // Start custom duration timer if needed
          console.log(
            "Checking if custom duration timer should be started, watchDuration:",
            watchDuration
          );
          if (watchDuration !== "full") {
            console.log("Starting custom duration timer for new video");
            startCustomDurationTimer();
          } else {
            console.log(
              "Not starting custom duration timer - watchDuration is 'full'"
            );
          }
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

    if (customDurationTimer) {
      clearTimeout(customDurationTimer);
      customDurationTimer = null;
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
