document.addEventListener("DOMContentLoaded", () => {
  const statusDiv = document.getElementById("status");
  const timerProgress = document.querySelector(".timer-progress");
  const timerText = document.querySelector(".timer-text");
  const toggleSwitch = document.getElementById("toggleSwitch");
  const darkModeToggle = document.getElementById("darkModeToggle");

  const circumference = 2 * Math.PI * 37; // Radius is 37
  timerProgress.style.strokeDasharray = circumference;
  timerProgress.style.strokeDashoffset = circumference;

  // Function to set the theme
  const setTheme = (theme) => {
    if (theme === "dark-mode") {
      document.body.classList.add("dark-mode");
      darkModeToggle.checked = true;
    } else {
      document.body.classList.remove("dark-mode");
      darkModeToggle.checked = false;
    }
  };

  // Check for saved theme
  chrome.storage.local.get("theme", (data) => {
    if (data.theme) {
      setTheme(data.theme);
    }
  });

  // Request current status when popup opens
  chrome.runtime.sendMessage({ type: "GET_STATUS" });

  // Listen for status updates from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "UPDATE_POPUP_STATUS") {
      const isRunning = message.status === "Running";
      statusDiv.textContent = "Status: " + message.status;
      toggleSwitch.checked = isRunning;
      if (!isRunning) {
        timerText.textContent = "--:--";
        timerProgress.style.strokeDashoffset = circumference;
      }
    } else if (message.type === "UPDATE_TIMER") {
      if (message.progress !== undefined) {
        const progress = message.progress;
        const offset = circumference - (progress / 100) * circumference;

        timerProgress.style.strokeDashoffset = offset;
        timerText.textContent = message.time;

        // Change color based on progress
        if (progress < 25) {
          timerProgress.style.stroke = "#ff4444";
          timerText.style.color = "#ff4444";
        } else if (progress < 50) {
          timerProgress.style.stroke = "#ff8800";
          timerText.style.color = "#ff8800";
        } else {
          timerProgress.style.stroke = "var(--timer-progress-color)";
          timerText.style.color = "var(--text-color)";
        }
      }
    }
  });

  // Handle auto-scroll toggle switch changes
  toggleSwitch.addEventListener("change", () => {
    if (toggleSwitch.checked) {
      chrome.runtime.sendMessage({ type: "START_AUTO_SCROLL" });
    } else {
      chrome.runtime.sendMessage({ type: "STOP_AUTO_SCROLL" });
    }
  });

  // Handle dark mode toggle switch changes
  darkModeToggle.addEventListener("change", () => {
    const theme = darkModeToggle.checked ? "dark-mode" : "";
    setTheme(theme);
    chrome.storage.local.set({ theme: theme });
  });
});
