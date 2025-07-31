chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ autoScrollStatus: "Idle" });
});

let currentStatus = "Idle";

chrome.storage.local.get(["autoScrollStatus"], (result) => {
  if (result.autoScrollStatus) {
    currentStatus = result.autoScrollStatus;
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_AUTO_SCROLL") {
    currentStatus = "Running";
    chrome.storage.local.set({ autoScrollStatus: "Running" }, () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.scripting
            .executeScript({
              target: { tabId: tabs[0].id },
              files: ["content.js"],
            })
            .then(() => {
              chrome.tabs.sendMessage(tabs[0].id, {
                type: "START_AUTO_SCROLL",
              });
            })
            .catch((err) => console.error(err));
        }
      });
      updatePopupStatus("Running");
    });
  } else if (message.type === "STOP_AUTO_SCROLL") {
    currentStatus = "Stopped";
    chrome.storage.local.set({ autoScrollStatus: "Stopped" }, () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
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
        // Popup might not be open
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
        // Popup might not be open
      }
    }
  );
}
