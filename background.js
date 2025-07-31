chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ autoScrollStatus: "Idle" });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_AUTO_SCROLL") {
    chrome.storage.local.set({ autoScrollStatus: "Running" }, () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs[0];
        if (activeTab && activeTab.id) {
          // Ensure the content script is injected and then send the start message.
          chrome.scripting
            .executeScript({
              target: { tabId: activeTab.id },
              files: ["content.js"],
            })
            .then(() => {
              chrome.tabs.sendMessage(activeTab.id, {
                type: "START_AUTO_SCROLL",
              });
            })
            .catch((err) => console.error("Failed to inject script: ", err));
        }
      });
      updatePopupStatus("Running");
    });
  } else if (message.type === "STOP_AUTO_SCROLL") {
    chrome.storage.local.set({ autoScrollStatus: "Stopped" }, () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].id) {
          chrome.tabs.sendMessage(tabs[0].id, { type: "STOP_AUTO_SCROLL" });
        }
      });
      updatePopupStatus("Stopped");
    });
  } else if (message.type === "UPDATE_TIMER") {
    updatePopupTimer(message.time, message.progress);
  } else if (message.type === "GET_STATUS") {
    chrome.storage.local.get(["autoScrollStatus"], (result) => {
      updatePopupStatus(result.autoScrollStatus || "Idle");
    });
  } else if (message.type === "UPDATE_POPUP_STATUS") {
    updatePopupStatus(message.status);
  }
});

function updatePopupStatus(status) {
  chrome.runtime.sendMessage(
    {
      type: "UPDATE_POPUP_STATUS",
      status: status,
    },
    () => {
      if (chrome.runtime.lastError) {
        // Popup might not be open, ignore.
      }
    }
  );
}

function updatePopupTimer(time, progress) {
  chrome.runtime.sendMessage(
    {
      type: "UPDATE_TIMER",
      time: time,
      progress: progress,
    },
    () => {
      if (chrome.runtime.lastError) {
        // Popup might not be open, ignore.
      }
    }
  );
}
