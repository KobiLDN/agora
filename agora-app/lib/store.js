// Tiny persistent state store: one JSON file in userData, load-on-start,
// debounced save, change listeners. Replaces chrome.storage.local from the
// extension — but unlike an MV3 service worker, this process doesn't get
// killed at random, so plain in-memory state + periodic flush is safe.

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  bridgeActive: false,
  conversationLog: [],
  settings: { turnDelay: 3, maxTurns: 0, labelMessages: true, interjectTarget: 'Claude' },
  turnCount: 0,
  introSentTo: { DeepSeek: false, Claude: false },
  lastStop: null
};

class Store {
  constructor(userDataDir) {
    this.file = path.join(userDataDir, 'agora-state.json');
    this.listeners = [];
    this.saveTimer = null;
    this.state = { ...structuredClone(DEFAULTS) };
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.state = { ...structuredClone(DEFAULTS), ...raw };
      this.state.settings = { ...DEFAULTS.settings, ...(raw.settings || {}) };
    } catch (e) {
      // first run or corrupt file — start from defaults
    }
  }

  get() {
    return this.state;
  }

  set(patch) {
    Object.assign(this.state, patch);
    this.scheduleSave();
    for (const fn of this.listeners) fn(this.state);
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  addLogEntry(sender, message) {
    const log = this.state.conversationLog;
    log.push({ sender, message, timestamp: Date.now() });
    if (log.length > 200) log.shift();
    this.set({ conversationLog: log });
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 500);
  }

  flush() {
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2));
    } catch (e) {
      console.error('[Agora] Failed to save state:', e.message);
    }
  }
}

module.exports = { Store, DEFAULTS };
