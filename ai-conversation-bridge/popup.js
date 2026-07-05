let bridgeActive = false;
let conversationLog = [];
let deepseekTabId = null;
let claudeTabId = null;

document.addEventListener('DOMContentLoaded', async () => {
  const saved = await chrome.storage.local.get(['bridgeActive', 'conversationLog', 'deepseekTabId', 'claudeTabId']);
  bridgeActive = saved.bridgeActive || false;
  conversationLog = saved.conversationLog || [];
  deepseekTabId = saved.deepseekTabId || null;
  claudeTabId = saved.claudeTabId || null;

  updateUI();
  checkTabs();
  updateLog();

  document.getElementById('toggleBridge').addEventListener('click', toggleBridge);
  document.getElementById('syncTabs').addEventListener('click', syncTabs);
  document.getElementById('clearLog').addEventListener('click', clearLog);
  document.getElementById('sendUserMessage').addEventListener('click', sendUserMessage);

  document.getElementById('userInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendUserMessage();
    }
  });
});

async function checkTabs() {
  const tabs = await chrome.tabs.query({});

  let deepseekFound = false;
  let claudeFound = false;

  for (const tab of tabs) {
    if (tab.url?.includes('chat.deepseek.com')) {
      deepseekTabId = tab.id;
      deepseekFound = true;
    }
    if (tab.url?.includes('claude.ai')) {
      claudeTabId = tab.id;
      claudeFound = true;
    }
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
  updateUI();
  chrome.storage.local.set({ bridgeActive });
  chrome.runtime.sendMessage({
    action: 'setBridgeState',
    active: bridgeActive
  });
}

async function sendUserMessage() {
  const input = document.getElementById('userInput');
  const message = input.value.trim();
  if (!message) return;

  input.value = '';
  addLogEntry('User', message);

  if (deepseekTabId) {
    chrome.tabs.sendMessage(deepseekTabId, {
      action: 'sendMessage',
      message,
      sender: 'user'
    });
  }

  if (claudeTabId) {
    chrome.tabs.sendMessage(claudeTabId, {
      action: 'sendMessage',
      message,
      sender: 'user'
    });
  }
}

function addLogEntry(sender, message) {
  conversationLog.push({ sender, message, timestamp: Date.now() });
  if (conversationLog.length > 100) {
    conversationLog.shift();
  }
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
  chrome.storage.local.set({ conversationLog });
  updateLog();
}

function updateUI() {
  const btn = document.getElementById('toggleBridge');
  const status = document.getElementById('bridgeStatus');

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
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'newMessage') {
    addLogEntry(message.sender, message.message);

    if (bridgeActive) {
      forwardMessage(message);
    }
  }
});

function forwardMessage(message) {
  if (message.sender === 'DeepSeek' && claudeTabId) {
    chrome.tabs.sendMessage(claudeTabId, {
      action: 'sendMessage',
      message: message.message,
      sender: 'DeepSeek'
    });
  } else if (message.sender === 'Claude' && deepseekTabId) {
    chrome.tabs.sendMessage(deepseekTabId, {
      action: 'sendMessage',
      message: message.message,
      sender: 'Claude'
    });
  }
}
