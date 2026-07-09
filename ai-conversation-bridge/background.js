// All bridge logic lives here so it keeps working after the popup closes.
// State is read from chrome.storage.local on every event because MV3
// service workers can be killed and restarted at any time.

const DEFAULTS = {
  bridgeActive: false,
  conversationLog: [],
  deepseekTabId: null,
  claudeTabId: null,
  settings: { turnDelay: 3, maxTurns: 0 },
  turnCount: 0
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set(DEFAULTS);
});

function getState() {
  return chrome.storage.local.get(DEFAULTS);
}

async function addLogEntry(sender, message) {
  const { conversationLog } = await getState();
  conversationLog.push({ sender, message, timestamp: Date.now() });
  if (conversationLog.length > 100) conversationLog.shift();
  await chrome.storage.local.set({ conversationLog });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'setBridgeState') {
    chrome.storage.local.set({ bridgeActive: message.active, turnCount: 0 });
    sendResponse({ success: true });
  }

  if (message.action === 'syncTabs') {
    syncTabs();
    sendResponse({ success: true });
  }

  if (message.action === 'newMessage') {
    handleNewMessage(message);
    sendResponse({ success: true });
  }

  if (message.action === 'userMessage') {
    handleUserMessage(message.message);
    sendResponse({ success: true });
  }

  if (message.action === 'forwardLast') {
    forwardLastResponse(message.from).then((result) => sendResponse(result));
    return true;
  }

  if (message.action === 'selectorError') {
    addLogEntry('System', `⚠️ Could not find ${message.what} on ${message.site} — its UI may have changed.`);
    sendResponse({ success: true });
  }

  return true;
});

// AI response captured by a content script → log it, then forward to the other AI
async function handleNewMessage(message) {
  await addLogEntry(message.sender, message.message);

  const state = await getState();
  if (!state.bridgeActive) return;

  if (state.settings.maxTurns > 0 && state.turnCount >= state.settings.maxTurns) {
    await chrome.storage.local.set({ bridgeActive: false });
    await addLogEntry('System', `Bridge paused after ${state.settings.maxTurns} turn${state.settings.maxTurns === 1 ? '' : 's'}.`);
    return;
  }

  const delayMs = (state.settings.turnDelay || 0) * 1000;
  setTimeout(() => forwardMessage(message), delayMs);
}

async function forwardMessage(message) {
  const state = await getState();
  if (!state.bridgeActive) return;

  const targetTabId =
    message.sender === 'DeepSeek' ? state.claudeTabId :
    message.sender === 'Claude' ? state.deepseekTabId :
    null;
  if (!targetTabId) return;

  await chrome.storage.local.set({ turnCount: state.turnCount + 1 });
  try {
    await chrome.tabs.sendMessage(targetTabId, {
      action: 'sendMessage',
      message: message.message,
      sender: message.sender
    });
  } catch (e) {
    await addLogEntry('System', `⚠️ Could not deliver to ${message.sender === 'DeepSeek' ? 'Claude' : 'DeepSeek'} tab — try Sync Tabs and reload the page.`);
  }
}

// Manual forward: grab the last AI response from one site and send it to the other.
// Works with the bridge off — used to hand over a finished plan/answer on demand.
async function forwardLastResponse(from) {
  const state = await getState();
  const sourceTabId = from === 'Claude' ? state.claudeTabId : state.deepseekTabId;
  const targetTabId = from === 'Claude' ? state.deepseekTabId : state.claudeTabId;
  const target = from === 'Claude' ? 'DeepSeek' : 'Claude';

  if (!sourceTabId || !targetTabId) {
    return { success: false, error: 'Both tabs must be open — try Sync Tabs.' };
  }

  let text = null;
  try {
    const reply = await chrome.tabs.sendMessage(sourceTabId, { action: 'getLastResponse' });
    text = reply?.text;
  } catch (e) {
    return { success: false, error: `Could not reach the ${from} tab — reload it and try again.` };
  }

  if (!text) {
    return { success: false, error: `No ${from} response found to forward.` };
  }

  await addLogEntry('System', `Manually forwarded last ${from} response to ${target}.`);
  await addLogEntry(from, text);
  try {
    await chrome.tabs.sendMessage(targetTabId, { action: 'sendMessage', message: text, sender: from });
  } catch (e) {
    return { success: false, error: `Could not deliver to the ${target} tab — reload it and try again.` };
  }
  return { success: true };
}

// User interjection from the popup → log once, send to both AIs
async function handleUserMessage(text) {
  await addLogEntry('User', text);
  const state = await getState();

  for (const tabId of [state.deepseekTabId, state.claudeTabId]) {
    if (!tabId) continue;
    try {
      await chrome.tabs.sendMessage(tabId, { action: 'sendMessage', message: text, sender: 'user' });
    } catch (e) {
      // tab gone; syncTabs will clean up
    }
  }
}

async function syncTabs() {
  const tabs = await chrome.tabs.query({});
  let deepseekTabId = null;
  let claudeTabId = null;

  for (const tab of tabs) {
    if (tab.url?.includes('chat.deepseek.com')) deepseekTabId = tab.id;
    if (tab.url?.includes('claude.ai') && !tab.url?.includes('claude.ai/code')) claudeTabId = tab.id;
  }

  await chrome.storage.local.set({ deepseekTabId, claudeTabId });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) syncTabs();
});

chrome.tabs.onRemoved.addListener(() => {
  syncTabs();
});
