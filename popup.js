document.addEventListener("DOMContentLoaded", () => {
  const statusDiv = document.getElementById("status");
  const timerTextDiv = document.getElementById("timer-text");
  const timerProgress = document.querySelector(".timer-progress");
  const timerText = document.querySelector(".timer-text");

  // Request current status when popup opens
  chrome.runtime.sendMessage({ type: "GET_STATUS" });

  // Listen for status updates from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Popup received message:", message);
    if (message.type === "UPDATE_POPUP_STATUS") {
      statusDiv.textContent = "Status: " + message.status;
      // Remove loading animation when status is received
      if (message.status !== "Loading...") {
        timerProgress.classList.remove("loading");
      }
    } else if (message.type === "UPDATE_TIMER") {
      // Update timer text
      timerTextDiv.textContent = "Timer: " + message.time;

      // Update progress circle
      if (message.progress !== undefined) {
        const progress = message.progress;
        const circumference = 2 * Math.PI * 20; // 20 is the radius
        // Reverse the progress so circle decreases as time decreases
        const reversedProgress = 100 - progress;
        const offset = circumference - (reversedProgress / 100) * circumference;

        timerProgress.style.strokeDasharray = circumference;
        timerProgress.style.strokeDashoffset = offset;
        // Show time remaining instead of percentage
        timerText.textContent = message.time;

        // Change color based on progress (time remaining)
        if (progress < 25) {
          // Less than 25% time remaining - red
          timerProgress.style.stroke = "#ff4444";
          timerText.style.color = "#ff4444";
        } else if (progress < 50) {
          // Less than 50% time remaining - orange
          timerProgress.style.stroke = "#ff8800";
          timerText.style.color = "#ff8800";
        } else {
          // More than 50% time remaining - blue
          timerProgress.style.stroke = "#4285f4";
          timerText.style.color = "#333";
        }

        // Add animation class when timer is active
        if (progress > 0 && progress < 100) {
          timerProgress.classList.remove("loading");
        } else {
          // Add loading animation when not active
          if (message.time === "--:--") {
            timerProgress.classList.add("loading");
          } else {
            timerProgress.classList.remove("loading");
          }
        }
      }
    }
  });

  // Start auto-scroll button
  document.getElementById("startBtn").addEventListener("click", () => {
    console.log("Start button clicked");
    // Send message to background script which will forward to content script
    chrome.runtime.sendMessage({
      type: "START_AUTO_SCROLL",
    });
  });

  // Stop auto-scroll button
  document.getElementById("stopBtn").addEventListener("click", () => {
    console.log("Stop button clicked");
    // Send message to background script which will forward to content script
    chrome.runtime.sendMessage({
      type: "STOP_AUTO_SCROLL",
    });
  });
});
