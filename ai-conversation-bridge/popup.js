// The popup is only a viewer/controller. All bridge logic (forwarding,
// turn limits, logging) runs in background.js so it keeps working after
// this popup closes. State lives in chrome.storage.local; we re-render
// whenever it changes.

let settings = { turnDelay: 3, maxTurns: 0 };

document.addEventListener('DOMContentLoaded', async () => {
  const saved = await chrome.storage.local.get({
    settings: { turnDelay: 3, maxTurns: 0 }
  });
  settings = saved.settings;

  document.getElementById('turnDelay').value = settings.turnDelay;
  document.getElementById('maxTurns').value = settings.maxTurns;

  render();
  checkTabs();

  document.getElementById('toggleBridge').addEventListener('click', toggleBridge);
  document.getElementById('syncTabs').addEventListener('click', syncTabs);
  document.getElementById('clearLog').addEventListener('click', clearLog);
  document.getElementById('sendUserMessage').addEventListener('click', sendUserMessage);
  document.getElementById('exportJson').addEventListener('click', exportJson);
  document.getElementById('exportMd').addEventListener('click', exportMarkdown);
  document.getElementById('turnDelay').addEventListener('change', saveSettings);
  document.getElementById('maxTurns').addEventListener('change', saveSettings);

  document.getElementById('userInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendUserMessage();
    }
  });
});

// Re-render whenever the background worker updates state
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.conversationLog || changes.bridgeActive || changes.turnCount) {
    render();
  }
});

async function render() {
  const state = await chrome.storage.local.get({
    bridgeActive: false,
    conversationLog: [],
    turnCount: 0,
    settings: { turnDelay: 3, maxTurns: 0 }
  });
  settings = state.settings;

  const btn = document.getElementById('toggleBridge');
  const status = document.getElementById('bridgeStatus');
  const counter = document.getElementById('turnCounter');

  if (state.bridgeActive) {
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

  if (settings.maxTurns > 0 && state.turnCount > 0) {
    counter.textContent = `Turn ${state.turnCount} / ${settings.maxTurns}`;
  } else if (state.bridgeActive && state.turnCount > 0) {
    counter.textContent = `${state.turnCount} turn${state.turnCount === 1 ? '' : 's'}`;
  } else {
    counter.textContent = '';
  }

  renderLog(state.conversationLog);
}

function renderLog(conversationLog) {
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

function saveSettings() {
  settings.turnDelay = Math.max(0, parseInt(document.getElementById('turnDelay').value) || 0);
  settings.maxTurns = Math.max(0, parseInt(document.getElementById('maxTurns').value) || 0);
  chrome.storage.local.set({ settings });
}

async function checkTabs() {
  const tabs = await chrome.tabs.query({});
  let deepseekFound = false;
  let claudeFound = false;
  let deepseekTabId = null;
  let claudeTabId = null;

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

async function toggleBridge() {
  const { bridgeActive } = await chrome.storage.local.get({ bridgeActive: false });
  await chrome.runtime.sendMessage({ action: 'setBridgeState', active: !bridgeActive });
  render();
}

async function sendUserMessage() {
  const input = document.getElementById('userInput');
  const message = input.value.trim();
  if (!message) return;

  input.value = '';
  // Background logs it once and delivers to both tabs
  chrome.runtime.sendMessage({ action: 'userMessage', message });
}

function clearLog() {
  chrome.storage.local.set({ conversationLog: [], turnCount: 0 });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Selector errors also land in the log via background.js; show the banner
// too if the popup happens to be open when one fires
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'selectorError') {
    const banner = document.getElementById('errorBanner');
    banner.textContent = `⚠️ Could not find ${message.what} on ${message.site}. The site's UI may have changed.`;
    banner.classList.add('visible');
    setTimeout(() => banner.classList.remove('visible'), 6000);
  }
});

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

async function exportJson() {
  const { conversationLog } = await chrome.storage.local.get({ conversationLog: [] });
  if (!conversationLog.length) return;
  downloadFile(
    `ai-bridge-${Date.now()}.json`,
    JSON.stringify(conversationLog, null, 2),
    'application/json'
  );
}

async function exportMarkdown() {
  const { conversationLog } = await chrome.storage.local.get({ conversationLog: [] });
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
