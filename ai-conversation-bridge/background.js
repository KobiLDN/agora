let bridgeActive = false;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    bridgeActive: false,
    conversationLog: []
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'setBridgeState') {
    bridgeActive = message.active;
    chrome.storage.local.set({ bridgeActive });
    sendResponse({ success: true });
  }

  if (message.action === 'syncTabs') {
    syncTabs();
    sendResponse({ success: true });
  }

  if (message.action === 'getBridgeState') {
    sendResponse({ active: bridgeActive });
  }
});

async function syncTabs() {
  const tabs = await chrome.tabs.query({});
  let deepseekTabId = null;
  let claudeTabId = null;

  for (const tab of tabs) {
    if (tab.url?.includes('chat.deepseek.com')) {
      deepseekTabId = tab.id;
    }
    if (tab.url?.includes('claude.ai')) {
      claudeTabId = tab.id;
    }
  }

  await chrome.storage.local.set({ deepseekTabId, claudeTabId });
}

setInterval(syncTabs, 10000);

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    syncTabs();
  }
});

chrome.tabs.onRemoved.addListener(() => {
  syncTabs();
});
