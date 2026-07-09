let bridgeActive = false;
let conversationLog = [];
let deepseekTabId = null;
let claudeTabId = null;
let turnCount = 0;
let settings = { turnDelay: 3, maxTurns: 0 };

document.addEventListener('DOMContentLoaded', async () => {
  const saved = await chrome.storage.local.get([
    'bridgeActive', 'conversationLog', 'deepseekTabId', 'claudeTabId', 'settings'
  ]);
  bridgeActive = saved.bridgeActive || false;
  conversationLog = saved.conversationLog || [];
  deepseekTabId = saved.deepseekTabId || null;
  claudeTabId = saved.claudeTabId || null;
  if (saved.settings) settings = saved.settings;

  document.getElementById('turnDelay').value = settings.turnDelay;
  document.getElementById('maxTurns').value = settings.maxTurns;

  updateUI();
  checkTabs();
  updateLog();

  document.getElementById('toggleBridge').addEventListener('click', toggleBridge);
  document.getElementById('syncTabs').addEventListener('click', syncTabs);
  document.getElementById('clearLog').addEventListener('click', clearLog);
  document.getElementById('sendUserMessage').addEventListener('click', sendUserMessage);
  document.getElementById('exportJson').addEventListener('click', exportJson);
  document.getElementById('exportMd').addEventListener('click', exportMarkdown);

  // #3 — persist settings on change
  document.getElementById('turnDelay').addEventListener('change', saveSettings);
  document.getElementById('maxTurns').addEventListener('change', saveSettings);

  document.getElementById('userInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendUserMessage();
    }
  });
});

function saveSettings() {
  settings.turnDelay = Math.max(0, parseInt(document.getElementById('turnDelay').value) || 0);
  settings.maxTurns = Math.max(0, parseInt(document.getElementById('maxTurns').value) || 0);
  chrome.storage.local.set({ settings });
}

async function checkTabs() {
  const tabs = await chrome.tabs.query({});
  let deepseekFound = false;
  let claudeFound = false;

  for (const tab of tabs) {
    if (tab.url?.includes('chat.deepseek.com')) { deepseekTabId = tab.id; deepseekFound = true; }
    if (tab.url?.includes('claude.ai')) { claudeTabId = tab.id; claudeFound = true; }
  }

  document.getElementById('deepseekStatus').className = `status-dot ${deepseekFound ? 'online' : 'offline'}`;
  document.getElementById('deepseekLabel').textContent = deepseekFound ? 'Connected' : 'Not found';
  document.getElementById('claudeStatus').className = `status-dot ${claudeFound ? 'online' : 'offline'}`;
  document.getElementById('claudeLabel').textContent = claudeFound ? 'Connected' : 'Not found';

  await chrome.storage.local.set({ deepseekTabId, claudeTabId });
}

async function syncTabs() {
  await checkTabs();
  await chrome.runtime.sendMessage({ action: 'syncTabs' });
}

function toggleBridge() {
  bridgeActive = !bridgeActive;
  if (bridgeActive) turnCount = 0;
  updateUI();
  chrome.storage.local.set({ bridgeActive });
  chrome.runtime.sendMessage({ action: 'setBridgeState', active: bridgeActive });
}

async function sendUserMessage() {
  const input = document.getElementById('userInput');
  const message = input.value.trim();
  if (!message) return;

  input.value = '';
  addLogEntry('User', message);

  if (deepseekTabId) chrome.tabs.sendMessage(deepseekTabId, { action: 'sendMessage', message, sender: 'user' });
  if (claudeTabId) chrome.tabs.sendMessage(claudeTabId, { action: 'sendMessage', message, sender: 'user' });
}

function addLogEntry(sender, message) {
  conversationLog.push({ sender, message, timestamp: Date.now() });
  if (conversationLog.length > 100) conversationLog.shift();
  chrome.storage.local.set({ conversationLog });
  updateLog();
}

function updateLog() {
  const logDiv = document.getElementById('conversationLog');
  const countSpan = document.getElementById('messageCount');

  logDiv.innerHTML = conversationLog.map(entry => {
    const senderClass = entry.sender.toLowerCase();
    return `<div class="log-entry">
      <span class="sender ${senderClass}">${entry.sender}:</span>
      <span class="message">${escapeHtml(entry.message)}</span>
    </div>`;
  }).join('');

  countSpan.textContent = `${conversationLog.length} messages`;
  logDiv.scrollTop = logDiv.scrollHeight;
}

function clearLog() {
  conversationLog = [];
  turnCount = 0;
  chrome.storage.local.set({ conversationLog });
  updateLog();
  updateUI();
}

function updateUI() {
  const btn = document.getElementById('toggleBridge');
  const status = document.getElementById('bridgeStatus');
  const counter = document.getElementById('turnCounter');

  if (bridgeActive) {
    btn.textContent = '⏹️ Stop Bridge';
    btn.className = 'active';
    status.textContent = 'On';
    status.style.color = '#4caf50';
  } else {
    btn.textContent = '🔗 Start Bridge';
    btn.className = '';
    status.textContent = 'Off';
    status.style.color = '#f44336';
  }

  // #3 — show turn counter when bridge is active or has run turns
  if (settings.maxTurns > 0 && turnCount > 0) {
    counter.textContent = `Turn ${turnCount} / ${settings.maxTurns}`;
  } else if (bridgeActive && turnCount > 0) {
    counter.textContent = `${turnCount} turn${turnCount === 1 ? '' : 's'}`;
  } else {
    counter.textContent = '';
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// #1 — surface selector errors from content script
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'newMessage') {
    addLogEntry(message.sender, message.message);
    if (bridgeActive) scheduleForward(message);
  }

  if (message.action === 'selectorError') {
    const banner = document.getElementById('errorBanner');
    banner.textContent = `⚠️ Could not find ${message.what} on ${message.site}. The site's UI may have changed.`;
    banner.classList.add('visible');
    setTimeout(() => banner.classList.remove('visible'), 6000);
  }
});

// #3 — apply turn delay and max-turn limit before forwarding
function scheduleForward(message) {
  const maxTurns = settings.maxTurns;
  if (maxTurns > 0 && turnCount >= maxTurns) {
    bridgeActive = false;
    chrome.storage.local.set({ bridgeActive });
    chrome.runtime.sendMessage({ action: 'setBridgeState', active: false });
    updateUI();
    addLogEntry('System', `Bridge paused after ${maxTurns} turn${maxTurns === 1 ? '' : 's'}.`);
    return;
  }

  const delayMs = (settings.turnDelay || 0) * 1000;
  setTimeout(() => {
    if (!bridgeActive) return;
    turnCount++;
    updateUI();
    forwardMessage(message);
  }, delayMs);
}

function forwardMessage(message) {
  if (message.sender === 'DeepSeek' && claudeTabId) {
    chrome.tabs.sendMessage(claudeTabId, { action: 'sendMessage', message: message.message, sender: 'DeepSeek' });
  } else if (message.sender === 'Claude' && deepseekTabId) {
    chrome.tabs.sendMessage(deepseekTabId, { action: 'sendMessage', message: message.message, sender: 'Claude' });
  }
}

// #4 — export helpers
function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportJson() {
  if (!conversationLog.length) return;
  downloadFile(
    `ai-bridge-${Date.now()}.json`,
    JSON.stringify(conversationLog, null, 2),
    'application/json'
  );
}

function exportMarkdown() {
  if (!conversationLog.length) return;
  const lines = conversationLog.map(entry => {
    const date = new Date(entry.timestamp).toISOString();
    return `### ${entry.sender} — ${date}\n\n${entry.message}\n`;
  });
  downloadFile(
    `ai-bridge-${Date.now()}.md`,
    `# AI Bridge Conversation\n\n${lines.join('\n---\n\n')}`,
    'text/markdown'
  );
}
