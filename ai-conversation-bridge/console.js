// Agora Console — full-page dashboard (#16). Same storage-driven pattern as
// the popup: background.js owns all bridge logic, this page renders state and
// sends commands. Unlike the popup it survives clicks elsewhere, so it can be
// left open as a live view of the conversation.

const DEFAULT_SETTINGS = { turnDelay: 3, maxTurns: 0, labelMessages: true, interjectTarget: 'Claude' };
let settings = { ...DEFAULT_SETTINGS };

document.addEventListener('DOMContentLoaded', async () => {
  const saved = await chrome.storage.local.get({ settings: DEFAULT_SETTINGS });
  settings = saved.settings;

  document.getElementById('turnDelay').value = settings.turnDelay;
  document.getElementById('maxTurns').value = settings.maxTurns;
  document.getElementById('labelMessages').checked = settings.labelMessages !== false;
  document.getElementById('interjectTarget').value = settings.interjectTarget || 'Claude';
  document.getElementById('interjectTarget').addEventListener('change', saveSettings);

  render();
  checkTabs();
  setInterval(checkTabs, 5000);

  document.getElementById('toggleBridge').addEventListener('click', toggleBridge);
  document.getElementById('launchTabs').addEventListener('click', launchTabs);
  document.getElementById('syncTabs').addEventListener('click', syncTabs);
  document.getElementById('clearLog').addEventListener('click', clearLog);
  document.getElementById('sendUserMessage').addEventListener('click', sendUserMessage);
  document.getElementById('forwardClaude').addEventListener('click', () => forwardLast('Claude'));
  document.getElementById('forwardDeepseek').addEventListener('click', () => forwardLast('DeepSeek'));
  document.getElementById('shareLog').addEventListener('click', shareLog);
  document.getElementById('debugSnapshot').addEventListener('click', debugSnapshot);
  document.getElementById('exportJson').addEventListener('click', exportJson);
  document.getElementById('exportMd').addEventListener('click', exportMarkdown);
  document.getElementById('turnDelay').addEventListener('change', saveSettings);
  document.getElementById('maxTurns').addEventListener('change', saveSettings);
  document.getElementById('labelMessages').addEventListener('change', saveSettings);

  document.getElementById('userInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendUserMessage();
    }
  });
});

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
    settings: DEFAULT_SETTINGS
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

  renderStream(state.conversationLog);
}

function renderStream(conversationLog) {
  const stream = document.getElementById('stream');
  const countEl = document.getElementById('messageCount');
  countEl.textContent = `${conversationLog.length} message${conversationLog.length === 1 ? '' : 's'}`;

  if (!conversationLog.length) {
    stream.innerHTML = `<div class="empty-hint">No messages yet.<br>
      Launch the AI tabs, start the bridge, and the conversation will appear here.</div>`;
    return;
  }

  // Only rebuild when something changed (cheap check: count + last timestamp)
  const sig = `${conversationLog.length}-${conversationLog[conversationLog.length - 1].timestamp}`;
  if (stream.dataset.sig === sig) return;
  stream.dataset.sig = sig;

  stream.innerHTML = '';
  for (const entry of conversationLog) {
    const div = document.createElement('div');
    div.className = `msg ${entry.sender.toLowerCase()}`;

    const meta = document.createElement('div');
    meta.className = 'meta';
    const sender = document.createElement('span');
    sender.className = 'sender';
    sender.textContent = entry.sender;
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = new Date(entry.timestamp).toLocaleTimeString();
    meta.append(sender, time);

    const body = document.createElement('div');
    body.textContent = entry.message;

    div.append(meta, body);
    stream.appendChild(div);
  }
  stream.scrollTop = stream.scrollHeight;
}

function saveSettings() {
  settings.turnDelay = Math.max(0, parseInt(document.getElementById('turnDelay').value) || 0);
  settings.maxTurns = Math.max(0, parseInt(document.getElementById('maxTurns').value) || 0);
  settings.labelMessages = document.getElementById('labelMessages').checked;
  settings.interjectTarget = document.getElementById('interjectTarget').value;
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
    if (tab.url?.includes('claude.ai') && !tab.url?.includes('claude.ai/code')) { claudeTabId = tab.id; claudeFound = true; }
  }

  document.getElementById('deepseekStatus').className = `status-dot ${deepseekFound ? 'online' : 'offline'}`;
  document.getElementById('claudeStatus').className = `status-dot ${claudeFound ? 'online' : 'offline'}`;

  await chrome.storage.local.set({ deepseekTabId, claudeTabId });
  return { deepseekFound, claudeFound };
}

// Opens any missing AI tab in a separate window so it can be parked out of
// the way while this console stays the main view
async function launchTabs() {
  const { deepseekFound, claudeFound } = await checkTabs();
  const urls = [];
  if (!deepseekFound) urls.push('https://chat.deepseek.com');
  if (!claudeFound) urls.push('https://claude.ai/new');

  if (urls.length) {
    await chrome.windows.create({ url: urls, focused: false });
    // give the tabs a moment to register, then re-detect
    setTimeout(checkTabs, 3000);
  }
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
  chrome.runtime.sendMessage({
    action: 'userMessage',
    message,
    target: document.getElementById('interjectTarget').value
  });
}

async function shareLog() {
  await checkTabs();
  const target = document.getElementById('interjectTarget').value;
  const result = await chrome.runtime.sendMessage({ action: 'shareLog', target });
  if (result && !result.success) showError(result.error);
}

async function forwardLast(from) {
  await checkTabs();
  const result = await chrome.runtime.sendMessage({ action: 'forwardLast', from });
  if (result && !result.success) showError(result.error);
}

function clearLog() {
  chrome.storage.local.set({ conversationLog: [], turnCount: 0 });
  document.getElementById('stream').dataset.sig = '';
}

function showError(text) {
  const banner = document.getElementById('errorBanner');
  banner.textContent = `⚠️ ${text}`;
  banner.classList.add('visible');
  setTimeout(() => banner.classList.remove('visible'), 6000);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'selectorError') {
    showError(`Could not find ${message.what} on ${message.site}. The site's UI may have changed.`);
  }
});

// Collects DOM diagnostics from both AI tabs plus bridge state into one
// JSON report the user can hand to Claude Code for troubleshooting
async function debugSnapshot() {
  await checkTabs();
  const state = await chrome.storage.local.get({
    bridgeActive: false,
    turnCount: 0,
    settings: DEFAULT_SETTINGS,
    pendingForwards: [],
    deepseekTabId: null,
    claudeTabId: null,
    introSentTo: {}
  });

  const report = {
    generatedAt: new Date().toISOString(),
    bridgeState: {
      bridgeActive: state.bridgeActive,
      turnCount: state.turnCount,
      settings: state.settings,
      pendingForwardCount: state.pendingForwards.length,
      introSentTo: state.introSentTo,
      deepseekTabId: state.deepseekTabId,
      claudeTabId: state.claudeTabId
    },
    tabs: {}
  };

  for (const [name, tabId] of [['DeepSeek', state.deepseekTabId], ['Claude', state.claudeTabId]]) {
    if (!tabId) {
      report.tabs[name] = { error: 'tab not found' };
      continue;
    }
    try {
      report.tabs[name] = await chrome.tabs.sendMessage(tabId, { action: 'debugSnapshot' });
    } catch (e) {
      report.tabs[name] = { error: `unreachable (${e.message}) — reload the tab so the content script loads` };
    }
  }

  downloadFile(`agora-debug-${Date.now()}.json`, JSON.stringify(report, null, 2), 'application/json');
}

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
  downloadFile(`ai-bridge-${Date.now()}.json`, JSON.stringify(conversationLog, null, 2), 'application/json');
}

async function exportMarkdown() {
  const { conversationLog } = await chrome.storage.local.get({ conversationLog: [] });
  if (!conversationLog.length) return;
  const lines = conversationLog.map(entry => {
    const date = new Date(entry.timestamp).toISOString();
    return `### ${entry.sender} — ${date}\n\n${entry.message}\n`;
  });
  downloadFile(`ai-bridge-${Date.now()}.md`, `# AI Bridge Conversation\n\n${lines.join('\n---\n\n')}`, 'text/markdown');
}
