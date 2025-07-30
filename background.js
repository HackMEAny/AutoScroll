chrome.runtime.onInstalled.addListener(() => {
  // console.log("Facebook Reels AutoScroll Extension installed.");
});

// Use chrome.storage to persist status across sessions
let currentStatus = "Idle";

// Initialize storage when background script loads
chrome.storage.local.get(["autoScrollStatus"], (result) => {
  if (result.autoScrollStatus) {
    currentStatus = result.autoScrollStatus;
    // console.log("Initialized currentStatus from storage:", currentStatus);
  } else {
    // console.log("No status found in storage, using default:", currentStatus);
  }
});

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // console.log("Background script received:", message);

  if (message.type === "START_AUTO_SCROLL") {
    currentStatus = "Running";
    // Save status to storage
    chrome.storage.local.set({ autoScrollStatus: "Running" });
    // Forward to content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { type: "START_AUTO_SCROLL" });
    });
    // Update popup
    updatePopupStatus("Running");
  } else if (message.type === "STOP_AUTO_SCROLL") {
    currentStatus = "Stopped";
    // Save status to storage
    chrome.storage.local.set({ autoScrollStatus: "Stopped" });
    // Forward to content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { type: "STOP_AUTO_SCROLL" });
    });
    // Update popup
    updatePopupStatus("Stopped");
  } else if (message.type === "UPDATE_POPUP_STATUS") {
    currentStatus = message.status;
    // Save status to storage
    chrome.storage.local.set({ autoScrollStatus: message.status });
    updatePopupStatus(message.status);
  } else if (message.type === "UPDATE_TIMER") {
    // Forward timer updates to popup
    updatePopupTimer(message.time, message.progress);
  } else if (message.type === "GET_STATUS") {
    // console.log("GET_STATUS request received, currentStatus:", currentStatus);
    // Always get the latest status from storage to ensure accuracy
    chrome.storage.local.get(["autoScrollStatus"], (result) => {
      // console.log("Storage result:", result);
      if (result.autoScrollStatus) {
        // console.log("Sending status from storage:", result.autoScrollStatus);
        updatePopupStatus(result.autoScrollStatus);
      } else {
        // console.log("Sending current status:", currentStatus);
        updatePopupStatus(currentStatus);
      }
    });
  }
});

// Function to update popup status
function updatePopupStatus(status) {
  // Send message directly to the popup
  chrome.runtime.sendMessage(
    {
      type: "UPDATE_POPUP_STATUS",
      status: status,
    },
    () => {
      // Ignore errors
      if (chrome.runtime.lastError) {
        // Popup might not be open
      }
    }
  );
}

// Function to update popup timer
function updatePopupTimer(time, progress) {
  chrome.runtime.sendMessage(
    {
      type: "UPDATE_TIMER",
      time: time,
      progress: progress,
    },
    () => {
      // Ignore errors
      if (chrome.runtime.lastError) {
        // Popup might not be open
      }
    }
  );
}
