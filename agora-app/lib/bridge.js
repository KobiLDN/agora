// The relay engine — a direct port of the extension's background.js, minus
// every MV3 workaround it needed (chrome.alarms backstops, persisted pending
// forwards, storage-read-per-event). An Electron main process is a normal
// long-running Node process, so plain setTimeout and in-memory state are
// reliable here.

const { ipcMain } = require('electron');

const STOP_TOKEN = '[STOP_BRIDGE]';
const STOP_WINDOW_MS = 3 * 60 * 1000;
const DEDUPE_WINDOW_MS = 60 * 1000;
const SHARE_LOG_MAX_CHARS = 15000;

const PAUSE_WORDS = ['stop', 'pause', 'halt'];
const RESUME_WORDS = ['resume', 'continue', 'start'];

function detectCommand(text) {
  const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 4) return null;
  if (words.some(w => PAUSE_WORDS.includes(w))) return 'pause';
  if (words.some(w => RESUME_WORDS.includes(w))) return 'resume';
  return null;
}

// Token must be the literal trailing content of the message — mentions
// elsewhere never trigger (see extension issue #18's three rounds of this).
function endsWithStopToken(text) {
  return text.trim().endsWith(STOP_TOKEN);
}

class Bridge {
  /**
   * @param store lib/store.js Store instance
   * @param sendToSite (siteName, text) => boolean — inject text into a site view
   * @param otherSite (siteName) => siteName
   */
  constructor(store, sendToSite, otherSite) {
    this.store = store;
    this.sendToSite = sendToSite;
    this.otherSite = otherSite;
    this.wireIpc();
  }

  wireIpc() {
    ipcMain.on('site:newMessage', (e, { sender, message }) => {
      this.handleNewMessage(sender, message);
    });

    ipcMain.on('site:selectorError', (e, { site, what }) => {
      this.store.addLogEntry('System', `⚠️ Could not find ${what} on ${site} — its UI may have changed.`);
    });

    ipcMain.on('console:toggleBridge', () => {
      const { bridgeActive } = this.store.get();
      this.store.set({
        bridgeActive: !bridgeActive,
        turnCount: 0,
        introSentTo: { DeepSeek: false, Claude: false },
        lastStop: null
      });
    });

    ipcMain.on('console:interject', (e, { message, target }) => {
      this.handleUserMessage(message, target);
    });

    ipcMain.handle('console:forwardLast', (e, from) => this.forwardLastResponse(from));
    ipcMain.handle('console:shareLog', (e, target) => this.shareLog(target));

    ipcMain.on('console:setSettings', (e, settings) => {
      this.store.set({ settings: { ...this.store.get().settings, ...settings } });
    });

    ipcMain.on('console:clearLog', () => {
      this.store.set({ conversationLog: [], turnCount: 0 });
    });
  }

  labelText(from, target, text) {
    const state = this.store.get();
    if (!state.settings.labelMessages) return text;

    let intro = '';
    if (!state.introSentTo[target]) {
      intro = `[Bridge notice: You are in a relayed conversation with another AI, ${from}. ` +
              `Messages prefixed [${from}] are written by that AI, not by a human. ` +
              `A human moderator supervises and may interject; their messages are prefixed [Human]. ` +
              `When you and the other AI have both independently reached a genuine natural ` +
              `conclusion — not just a lull, and not proactively suggesting it end — end your ` +
              `ENTIRE message with the literal token ${STOP_TOKEN} as the very last characters, ` +
              `with nothing else after it. Merely mentioning the token elsewhere in a message ` +
              `will NOT trigger anything — only trailing use does. IMPORTANT: if you notice you ` +
              `and the other AI are just repeating "agreed" / "nothing more to add" back and ` +
              `forth with no new content, that repetition IS the natural conclusion — use the ` +
              `token right then instead of continuing to trade acknowledgments.]\n\n`;
      this.store.set({ introSentTo: { ...state.introSentTo, [target]: true } });
    }
    return `${intro}[${from}]: ${text}`;
  }

  checkMutualStop(sender, message) {
    if (!endsWithStopToken(message)) return false;

    const { lastStop } = this.store.get();
    const now = Date.now();

    if (lastStop && lastStop.sender !== sender && (now - lastStop.time) < STOP_WINDOW_MS) {
      this.store.set({ bridgeActive: false, lastStop: null });
      this.store.addLogEntry('System', 'Bridge stopped — both AIs signaled agreement.');
      return true;
    }
    this.store.set({ lastStop: { sender, time: now } });
    return false;
  }

  handleNewMessage(sender, message) {
    // Dedupe: the observer can capture the same message from two DOM nodes
    const cutoff = Date.now() - DEDUPE_WINDOW_MS;
    const isDuplicate = this.store.get().conversationLog.some(e =>
      e.sender === sender && e.timestamp > cutoff && e.message === message
    );
    if (isDuplicate) return;

    this.store.addLogEntry(sender, message);

    if (this.checkMutualStop(sender, message)) return;

    const state = this.store.get();
    if (!state.bridgeActive) return;

    if (state.settings.maxTurns > 0 && state.turnCount >= state.settings.maxTurns) {
      this.store.set({ bridgeActive: false });
      this.store.addLogEntry('System', `Bridge paused after ${state.settings.maxTurns} turn${state.settings.maxTurns === 1 ? '' : 's'}.`);
      return;
    }

    const delayMs = (state.settings.turnDelay || 0) * 1000;
    setTimeout(() => this.forwardMessage(sender, message), delayMs);
  }

  forwardMessage(sender, message) {
    const state = this.store.get();
    if (!state.bridgeActive) return;

    const target = this.otherSite(sender);
    if (!target) return;

    this.store.set({ turnCount: state.turnCount + 1 });
    const delivered = this.sendToSite(target, this.labelText(sender, target, message));
    if (!delivered) {
      this.store.addLogEntry('System', `⚠️ Could not deliver to the ${target} panel — is it loaded?`);
    }
  }

  // User interjection → deliver to the chosen target; the other AI hears it
  // through the normal relay path (broadcasting to both spawns two parallel
  // reply chains — diagnosed by the bridged AIs themselves, extension #17)
  handleUserMessage(text, target) {
    this.store.addLogEntry('User', text);

    const command = detectCommand(text);
    if (command === 'pause') {
      this.store.set({ bridgeActive: false });
      this.store.addLogEntry('System', 'Bridge paused by voice command.');
    } else if (command === 'resume') {
      this.store.set({ bridgeActive: true, turnCount: 0 });
      this.store.addLogEntry('System', 'Bridge resumed by voice command.');
    }

    const state = this.store.get();
    const outgoing = state.settings.labelMessages ? `[Human]: ${text}` : text;

    const resolved = command ? 'Both' : (target || state.settings.interjectTarget || 'Claude');
    const targets = resolved === 'Both' ? ['DeepSeek', 'Claude'] : [resolved];
    for (const name of targets) {
      this.sendToSite(name, outgoing);
    }
  }

  // Manual forward: hand the last captured response from one AI to the other.
  // Works with the bridge off. The message is already in the log (capture
  // always logs), so only a System note is added.
  forwardLastResponse(from) {
    const log = this.store.get().conversationLog;
    const entry = [...log].reverse().find(e => e.sender === from);
    if (!entry) {
      return { success: false, error: `No ${from} response found to forward.` };
    }

    const target = this.otherSite(from);
    const delivered = this.sendToSite(target, this.labelText(from, target, entry.message));
    if (!delivered) {
      return { success: false, error: `Could not deliver to the ${target} panel — is it loaded?` };
    }
    this.store.addLogEntry('System', `Manually forwarded last ${from} response to ${target}.`);
    return { success: true };
  }

  shareLog(target) {
    const log = this.store.get().conversationLog;
    if (!log.length) return { success: false, error: 'Log is empty — nothing to share.' };

    let body = log
      .map(e => `[${new Date(e.timestamp).toLocaleTimeString()}] ${e.sender}: ${e.message}`)
      .join('\n\n');
    if (body.length > SHARE_LOG_MAX_CHARS) {
      body = '…(earlier messages truncated)…\n\n' + body.slice(-SHARE_LOG_MAX_CHARS);
    }

    const outgoing =
      `[Human moderator: sharing the bridge's conversation log below for your reference — ` +
      `this is the app's own record (with attribution and timestamps), not a new ` +
      `conversational turn. Acknowledge briefly; no need to re-analyze every entry.]\n\n${body}`;

    const resolved = target || 'Both';
    const targets = resolved === 'Both' ? ['DeepSeek', 'Claude'] : [resolved];
    const delivered = targets.filter(name => this.sendToSite(name, outgoing));

    if (!delivered.length) {
      return { success: false, error: 'No reachable AI panel.' };
    }
    this.store.addLogEntry('System', `Log shared with ${delivered.join(' and ')} (${log.length} messages).`);
    return { success: true };
  }
}

module.exports = { Bridge, STOP_TOKEN };
