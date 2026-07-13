// Console renderer — pure view over state pushed from the main process via
// the preload bridge (window.agora). No Node access here.

let latestState = null;

document.addEventListener('DOMContentLoaded', async () => {
  window.agora.onState(render);
  render(await window.agora.getState());

  document.getElementById('toggleBridge').addEventListener('click', () => window.agora.toggleBridge());
  document.getElementById('forwardClaude').addEventListener('click', () => forwardLast('Claude'));
  document.getElementById('forwardDeepseek').addEventListener('click', () => forwardLast('DeepSeek'));
  document.getElementById('shareLog').addEventListener('click', shareLog);
  document.getElementById('debugSnapshot').addEventListener('click', debugSnapshot);
  document.getElementById('exportJson').addEventListener('click', exportJson);
  document.getElementById('exportMd').addEventListener('click', exportMarkdown);
  document.getElementById('clearLog').addEventListener('click', () => window.agora.clearLog());
  document.getElementById('sendUserMessage').addEventListener('click', sendUserMessage);

  for (const site of ['DeepSeek', 'Claude']) {
    document.getElementById(`reload${site}`).addEventListener('click', () => window.agora.reloadSite(site));
    document.getElementById(`devtools${site}`).addEventListener('click', () => window.agora.devtoolsSite(site));
  }

  for (const id of ['turnDelay', 'maxTurns', 'labelMessages', 'interjectTarget']) {
    document.getElementById(id).addEventListener('change', saveSettings);
  }

  document.getElementById('userInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendUserMessage();
    }
  });
});

function render(state) {
  if (!state) return;
  latestState = state;

  const btn = document.getElementById('toggleBridge');
  const status = document.getElementById('bridgeStatus');
  const counter = document.getElementById('turnCounter');
  const s = state.settings || {};

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

  if (s.maxTurns > 0 && state.turnCount > 0) {
    counter.textContent = `Turn ${state.turnCount} / ${s.maxTurns}`;
  } else if (state.bridgeActive && state.turnCount > 0) {
    counter.textContent = `${state.turnCount} turn${state.turnCount === 1 ? '' : 's'}`;
  } else {
    counter.textContent = '';
  }

  // reflect settings without clobbering an input the user is typing in
  for (const [id, value] of [['turnDelay', s.turnDelay], ['maxTurns', s.maxTurns]]) {
    const el = document.getElementById(id);
    if (document.activeElement !== el) el.value = value;
  }
  document.getElementById('labelMessages').checked = s.labelMessages !== false;
  const targetEl = document.getElementById('interjectTarget');
  if (document.activeElement !== targetEl) targetEl.value = s.interjectTarget || 'Claude';

  renderStream(state.conversationLog || []);
}

function renderStream(conversationLog) {
  const stream = document.getElementById('stream');
  document.getElementById('messageCount').textContent =
    `${conversationLog.length} message${conversationLog.length === 1 ? '' : 's'}`;

  if (!conversationLog.length) {
    stream.innerHTML = `<div class="empty-hint">No messages yet.<br>Log in to both panels, then Start Bridge.</div>`;
    delete stream.dataset.sig;
    return;
  }

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
  window.agora.setSettings({
    turnDelay: Math.max(0, parseInt(document.getElementById('turnDelay').value) || 0),
    maxTurns: Math.max(0, parseInt(document.getElementById('maxTurns').value) || 0),
    labelMessages: document.getElementById('labelMessages').checked,
    interjectTarget: document.getElementById('interjectTarget').value
  });
}

function sendUserMessage() {
  const input = document.getElementById('userInput');
  const message = input.value.trim();
  if (!message) return;
  input.value = '';
  window.agora.interject(message, document.getElementById('interjectTarget').value);
}

async function forwardLast(from) {
  const result = await window.agora.forwardLast(from);
  if (result && !result.success) showError(result.error);
}

async function shareLog() {
  const result = await window.agora.shareLog(document.getElementById('interjectTarget').value);
  if (result && !result.success) showError(result.error);
}

async function debugSnapshot() {
  const report = await window.agora.debugSnapshot();
  downloadFile(`agora-debug-${Date.now()}.json`, JSON.stringify(report, null, 2), 'application/json');
}

function showError(text) {
  const banner = document.getElementById('errorBanner');
  banner.textContent = `⚠️ ${text}`;
  banner.classList.add('visible');
  setTimeout(() => banner.classList.remove('visible'), 6000);
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

function exportJson() {
  const log = latestState?.conversationLog || [];
  if (!log.length) return;
  downloadFile(`agora-${Date.now()}.json`, JSON.stringify(log, null, 2), 'application/json');
}

function exportMarkdown() {
  const log = latestState?.conversationLog || [];
  if (!log.length) return;
  const lines = log.map(entry => {
    const date = new Date(entry.timestamp).toISOString();
    return `### ${entry.sender} — ${date}\n\n${entry.message}\n`;
  });
  downloadFile(`agora-${Date.now()}.md`, `# Agora Conversation\n\n${lines.join('\n---\n\n')}`, 'text/markdown');
}
