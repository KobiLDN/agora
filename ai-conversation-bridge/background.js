// All bridge logic lives here so it keeps working after the popup closes.
// State is read from chrome.storage.local on every event because MV3
// service workers can be killed and restarted at any time.

const DEFAULTS = {
  bridgeActive: false,
  conversationLog: [],
  deepseekTabId: null,
  claudeTabId: null,
  settings: { turnDelay: 3, maxTurns: 0, labelMessages: true, interjectTarget: 'Claude' },
  turnCount: 0,
  // whether each site has already received the one-time bridge intro
  introSentTo: { DeepSeek: false, Claude: false },
  // forwards waiting out their turn delay — persisted because a bare
  // setTimeout dies with the service worker and the forward is lost
  pendingForwards: [],
  // last AI to emit the mutual-stop token, for the two-turn agreement check
  lastStop: null
};

// ---- Mutual stop (designed collaboratively by the bridged AIs themselves,
// see #17-era session) — lets both AIs agree the conversation has reached a
// natural conclusion instead of looping polite sign-offs until max-turns
// fires. Detection is mechanical (exact token, both sides, within a window)
// rather than inferring "sounds like a goodbye" from free text — the AIs'
// own design rationale: inferred intent is exactly what produced the
// looping sign-offs in the first place.
const STOP_TOKEN = '[STOP_BRIDGE]';
const STOP_WINDOW_MS = 3 * 60 * 1000;

// Caught live (round 1): a plain .includes() check fired while the AIs were
// merely *discussing* the token during design (mid-message mentions, quoted
// in explanation) — the bridge stopped twice before the feature even
// shipped. First fix required the token to be the entire last non-empty
// *line* of the message.
//
// Caught live (round 2): that line-based check can silently fail even when
// an AI formats the sign-off exactly as instructed. getMessageText() reads
// DOM textContent, and a chat UI that renders a markdown soft-break as <br>
// within a single paragraph (rather than a separate <p>) produces no real
// "\n" character in textContent — "closing sentence" and "[STOP_BRIDGE]"
// arrive glued together with zero separator, so "last line" never isolates
// the token at all.
//
// Fix: don't depend on a newline surviving extraction. The token just needs
// to be the literal trailing content of the message, nothing after it — that
// alone still rejects the original false-positive (which had explanatory
// text following the token), without requiring a DOM-fragile line break.
function endsWithStopToken(text) {
  return text.trim().endsWith(STOP_TOKEN);
}

async function checkMutualStop(message) {
  if (!endsWithStopToken(message.message)) return false;

  const { lastStop } = await getState();
  const now = Date.now();

  if (lastStop && lastStop.sender !== message.sender && (now - lastStop.time) < STOP_WINDOW_MS) {
    await chrome.storage.local.set({ bridgeActive: false, lastStop: null });
    await addLogEntry('System', 'Bridge stopped — both AIs signaled agreement.');
    return true;
  }
  await chrome.storage.local.set({ lastStop: { sender: message.sender, time: now } });
  return false;
}

// ---- Reliable delayed forwarding -------------------------------------
// A setTimeout in an MV3 service worker is silently discarded if Chrome
// kills the idle worker before it fires. So every scheduled forward is
// persisted to storage, fired by a short timer while the worker lives,
// re-armed on worker startup, and backstopped by chrome.alarms (which
// can wake a dead worker, at ~30s minimum granularity).

async function schedulePendingForward(message, delayMs) {
  const id = crypto.randomUUID();
  const dueAt = Date.now() + delayMs;
  const { pendingForwards = [] } = await chrome.storage.local.get('pendingForwards');
  pendingForwards.push({ id, message, dueAt });
  await chrome.storage.local.set({ pendingForwards });

  setTimeout(() => firePending(id), delayMs);
  chrome.alarms.create(`forward-${id}`, { delayInMinutes: Math.max(delayMs / 60000, 0.5) });
}

// Remove-then-fire so the timeout and the backstop alarm can't both send
async function firePending(id) {
  const { pendingForwards = [] } = await chrome.storage.local.get('pendingForwards');
  const idx = pendingForwards.findIndex(p => p.id === id);
  if (idx === -1) return;
  const [pending] = pendingForwards.splice(idx, 1);
  await chrome.storage.local.set({ pendingForwards });
  chrome.alarms.clear(`forward-${id}`);
  await forwardMessage(pending.message);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith('forward-')) {
    firePending(alarm.name.slice('forward-'.length));
  }
});

// Worker (re)started: re-arm timers for anything still pending — overdue
// entries fire immediately
(async () => {
  const { pendingForwards = [] } = await chrome.storage.local.get('pendingForwards');
  for (const p of pendingForwards) {
    setTimeout(() => firePending(p.id), Math.max(0, p.dueAt - Date.now()));
  }
})();
// -----------------------------------------------------------------------

// Prefix injected text so the receiving AI knows who is talking.
// The first message to each site also carries a one-time explanation.
async function labelText(from, target, text, state) {
  if (!state.settings.labelMessages) return text;

  let intro = '';
  if (!state.introSentTo[target]) {
    intro = `[Bridge notice: You are in a relayed conversation with another AI, ${from}. ` +
            `Messages prefixed [${from}] are written by that AI, not by a human. ` +
            `A human moderator supervises and may interject; their messages are prefixed [Human]. ` +
            `When you and the other AI have both independently reached a genuine natural ` +
            `conclusion — not just a lull, and not proactively suggesting it end — end your ` +
            `ENTIRE message with the literal token ${STOP_TOKEN} as the very last characters, ` +
            `with nothing else after it (a preceding line break helps clarity but isn't required). ` +
            `Merely mentioning or discussing the token earlier in a message will NOT trigger ` +
            `anything — only trailing use does. Once both sides end a message that way, the ` +
            `bridge will stop automatically.]\n\n`;
    const introSentTo = { ...state.introSentTo, [target]: true };
    await chrome.storage.local.set({ introSentTo });
  }
  return `${intro}[${from}]: ${text}`;
}

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
    chrome.storage.local.set({
      bridgeActive: message.active,
      turnCount: 0,
      // fresh session → re-send the intro to each site
      introSentTo: { DeepSeek: false, Claude: false },
      // drop anything still queued from the previous session
      pendingForwards: [],
      lastStop: null
    });
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
    handleUserMessage(message.message, message.target);
    sendResponse({ success: true });
  }

  if (message.action === 'forwardLast') {
    forwardLastResponse(message.from).then((result) => sendResponse(result));
    return true;
  }

  if (message.action === 'shareLog') {
    shareLog(message.target).then((result) => sendResponse(result));
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
  // Dedupe: the observer can capture the same message from two DOM nodes
  // (wrapper + inner both match the selectors), producing identical entries
  // ~0.5s apart that then get forwarded twice
  const { conversationLog } = await getState();
  const cutoff = Date.now() - 60000;
  const isDuplicate = conversationLog.some(e =>
    e.sender === message.sender &&
    e.timestamp > cutoff &&
    e.message === message.message
  );
  if (isDuplicate) return;

  await addLogEntry(message.sender, message.message);

  if (await checkMutualStop(message)) return;

  const state = await getState();
  if (!state.bridgeActive) return;

  if (state.settings.maxTurns > 0 && state.turnCount >= state.settings.maxTurns) {
    await chrome.storage.local.set({ bridgeActive: false });
    await addLogEntry('System', `Bridge paused after ${state.settings.maxTurns} turn${state.settings.maxTurns === 1 ? '' : 's'}.`);
    return;
  }

  const delayMs = (state.settings.turnDelay || 0) * 1000;
  await schedulePendingForward(message, delayMs);
}

async function forwardMessage(message) {
  const state = await getState();
  if (!state.bridgeActive) return;

  const target = message.sender === 'DeepSeek' ? 'Claude' : message.sender === 'Claude' ? 'DeepSeek' : null;
  const targetTabId = target === 'Claude' ? state.claudeTabId : target === 'DeepSeek' ? state.deepseekTabId : null;
  if (!targetTabId) return;

  await chrome.storage.local.set({ turnCount: state.turnCount + 1 });
  try {
    await chrome.tabs.sendMessage(targetTabId, {
      action: 'sendMessage',
      message: await labelText(message.sender, target, message.message, state),
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
    await chrome.tabs.sendMessage(targetTabId, {
      action: 'sendMessage',
      message: await labelText(from, target, text, state),
      sender: from
    });
  } catch (e) {
    return { success: false, error: `Could not deliver to the ${target} tab — reload it and try again.` };
  }
  return { success: true };
}

// Voice commands: a short interject like "stop" / "okay pause" controls the
// bridge itself, not just the conversation. Only trigger on short messages
// (≤ 4 words) so "let's stop discussing X and move on" doesn't false-fire.
const PAUSE_WORDS = ['stop', 'pause', 'halt'];
const RESUME_WORDS = ['resume', 'continue', 'start'];

function detectCommand(text) {
  const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 4) return null;
  if (words.some(w => PAUSE_WORDS.includes(w))) return 'pause';
  if (words.some(w => RESUME_WORDS.includes(w))) return 'resume';
  return null;
}

// User interjection from the popup/console → log once, deliver to the chosen
// target. Broadcasting to both AIs made both reply at once, spawning two
// parallel forwarding chains that tangled the conversation (diagnosed by the
// bridged AIs themselves reviewing this code) — so normal interjects go to
// ONE side and reach the other through the ordinary relay path. Voice
// commands still go to both: the bridge is paused/reset at that moment, so
// no reply chains can start, and both AIs should know why it stopped.
async function handleUserMessage(text, target) {
  await addLogEntry('User', text);

  const command = detectCommand(text);
  if (command === 'pause') {
    // stop the bridge and drop in-flight turns so nothing lands after the pause
    await chrome.storage.local.set({ bridgeActive: false, pendingForwards: [] });
    const alarms = await chrome.alarms.getAll();
    for (const a of alarms) {
      if (a.name.startsWith('forward-')) chrome.alarms.clear(a.name);
    }
    await addLogEntry('System', 'Bridge paused by voice command.');
  } else if (command === 'resume') {
    await chrome.storage.local.set({ bridgeActive: true, turnCount: 0 });
    await addLogEntry('System', 'Bridge resumed by voice command.');
  }

  const state = await getState();
  const outgoing = state.settings.labelMessages ? `[Human]: ${text}` : text;

  const resolved = command ? 'Both' : (target || state.settings.interjectTarget || 'Claude');
  const targets = [];
  if (resolved === 'Both' || resolved === 'DeepSeek') targets.push(state.deepseekTabId);
  if (resolved === 'Both' || resolved === 'Claude') targets.push(state.claudeTabId);

  for (const tabId of targets) {
    if (!tabId) continue;
    try {
      await chrome.tabs.sendMessage(tabId, { action: 'sendMessage', message: outgoing, sender: 'user' });
    } catch (e) {
      // tab gone; syncTabs will clean up
    }
  }
}

// Injects the bridge's conversation log directly into an AI's chat input,
// so the AIs can read the bridge's-eye view (attribution, timestamps, System
// entries) without the user downloading and re-uploading the export.
// The payload is NOT added to the log itself — that would snowball on the
// next share — only a short System entry recording that a share happened.
const SHARE_LOG_MAX_CHARS = 15000;

async function shareLog(target) {
  const state = await getState();
  const log = state.conversationLog;
  if (!log.length) return { success: false, error: 'Log is empty — nothing to share.' };

  let body = log
    .map(e => `[${new Date(e.timestamp).toLocaleTimeString()}] ${e.sender}: ${e.message}`)
    .join('\n\n');
  if (body.length > SHARE_LOG_MAX_CHARS) {
    body = '…(earlier messages truncated)…\n\n' + body.slice(-SHARE_LOG_MAX_CHARS);
  }

  const outgoing =
    `[Human moderator: sharing the bridge's conversation log below for your reference — ` +
    `this is the extension's own record (with attribution and timestamps), not a new ` +
    `conversational turn. Acknowledge briefly; no need to re-analyze every entry.]\n\n${body}`;

  const resolved = target || 'Both';
  const targets = [];
  if (resolved === 'Both' || resolved === 'DeepSeek') targets.push(['DeepSeek', state.deepseekTabId]);
  if (resolved === 'Both' || resolved === 'Claude') targets.push(['Claude', state.claudeTabId]);

  const delivered = [];
  for (const [name, tabId] of targets) {
    if (!tabId) continue;
    try {
      await chrome.tabs.sendMessage(tabId, { action: 'sendMessage', message: outgoing, sender: 'user' });
      delivered.push(name);
    } catch (e) {
      // tab gone; syncTabs will clean up
    }
  }

  if (!delivered.length) {
    return { success: false, error: 'No reachable AI tab — try Sync Tabs and reload the pages.' };
  }
  await addLogEntry('System', `Log shared with ${delivered.join(' and ')} (${log.length} messages).`);
  return { success: true };
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
