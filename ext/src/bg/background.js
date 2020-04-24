// Array of tab ids of tabs with the video feature enabled
const enabledTabs = {};
const reservedWindows = {};
var moveRetryTimer;

contentSetting = chrome.contentSettings;
contentSetting.popups.clear({ scope: "regular" });

const broadcastTabState = tabId => {
  chrome.runtime.sendMessage({
    type: "tabState",
    enabled: tabId in enabledTabs,
    tabId: tabId
  });
};

const reserveWindow = (tabId, windowId) => {
  reservedWindows[windowId] = true;
  enabledTabs[tabId].windowId = windowId;
};

const allowPopups = tabId => {
  chrome.tabs.get(tabId, tab => {
    var incognito = tab.incognito;
    var url = tab.url;
    var pattern = /^file:/.test(url) ? url : url.replace(/\/[^\/]*?$/, "/*");
    contentSetting["popups"].set(
      {
        primaryPattern: pattern,
        setting: "allow",
        scope: incognito ? "incognito_session_only" : "regular"
      },
      () => {
        if (chrome.runtime.lastError) {
          console.log(chrome.runtime.lastError.message, pattern);
          return;
        }
      }
    );
  });
};

const moveTabToNewWindow = (tabId, callback) => {
  chrome.tabs.get(tabId, tab => {
    chrome.windows.get(tab.windowId, { populate: true }, window => {
      // Check if already in it's own window with no other tabs,
      // then don't move but callback right away
      if (window.tabs.length === 1) {
        if (tabId in enabledTabs) {
          reserveWindow(tabId, tab.windowId);
        }

        if (typeof callback === "function") {
          callback();
        }
        return;
      }

      if (enabledTabs[tabId]) {
        delete enabledTabs[tabId].windowId;
      }
      const doMove = () => {
        clearTimeout(moveRetryTimer);
        chrome.windows.create(
          {
            focused: true,
            type: "normal",
            tabId: tabId,
            state: "maximized"
          },
          () => {
            if (
              chrome.runtime.lastError &&
              chrome.runtime.lastError.message.indexOf("dragging") !== -1
            ) {
              // Wait until user is done dragging the tab
              moveRetryTimer = setTimeout(doMove, 200);
            } else {
              if (typeof callback === "function") {
                callback();
              }
            }
          }
        );
      };
      doMove();
    });
  });
};

const setBadge = tabId => {
  if (enabledTabs[tabId]) {
    chrome.browserAction.setBadgeText({ text: "ON", tabId: tabId });
    chrome.browserAction.setBadgeBackgroundColor({
      color: [0, 255, 0, 255],
      tabId: tabId
    });
  } else {
    chrome.browserAction.setBadgeText({ text: "", tabId: tabId });
  }
};

const enableForTab = tabId => {
  // Enable now
  enabledTabs[tabId] = {};
  allowPopups(tabId);
  setBadge(tabId);
  // Move to it's own reserved window, because video playback
  // will stop when the tab is not the active tab in its window
  moveTabToNewWindow(tabId, () => {
    chrome.tabs.sendMessage(tabId, { enabled: true });
  });
  broadcastTabState(tabId);
};

const disableForTab = tabId => {
  // Disable now
  chrome.tabs.sendMessage(tabId, { enabled: false });
  delete reservedWindows[enabledTabs[tabId].windowId];
  delete enabledTabs[tabId];
  setBadge(tabId);
  broadcastTabState(tabId);
};

chrome.tabs.onRemoved.addListener(tabId => {
  delete enabledTabs[tabId];
});

chrome.windows.onRemoved.addListener(windowId => {
  delete reservedWindows[windowId];
});

chrome.tabs.onCreated.addListener(tab => {
  if (reservedWindows[tab.windowId]) {
    // This tab is not enabled for the video feature and
    // becomes attached to a window that's reserved for
    // a single tab with the video feature activated.
    // Move this tab to a new window
    moveTabToNewWindow(tab.id);
  }
});

chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
  if (enabledTabs[tabId]) {
    if (enabledTabs[tabId].windowId === undefined) {
      // First time this tab is attached to its new window
      reserveWindow(tabId, attachInfo.newWindowId);
    } else {
      moveTabToNewWindow(tabId);
    }
  } else if (reservedWindows[attachInfo.newWindowId]) {
    // This tab is not enabled for the video feature and
    // becomes attached to a window that's reserved for
    // a single tab with the video feature activated.
    // Move this tab to a new window
    moveTabToNewWindow(tabId);
  }
});

chrome.tabs.onActivated.addListener(activeInfo => {
  setBadge(activeInfo.tabId);
});

//example of using a message handler from the inject scripts
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (!request) {
    return true;
  }

  if (request.type && request.type === "load") {
    if (sender.tab.id in enabledTabs) {
      allowPopups(sender.tab.id);
      sendResponse({ enabled: true });
    }
  } else if (request.type && request.type === "popupLoad") {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const currentTab = tabs[0];
      broadcastTabState(currentTab.id);
    });
  } else if (request.type && request.type === "enable") {
    enableForTab(request.tabId);
  } else if (request.type && request.type === "disable") {
    disableForTab(request.tabId);
  } else if (request.type && request.type === "rerun") {
    chrome.tabs.sendMessage(request.tabId, { rerun: true });
  }

  return true;
});
