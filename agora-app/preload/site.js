// Preload for the embedded AI site panels — a direct port of the
// extension's content.js with chrome.runtime messaging swapped for
// ipcRenderer. All the battle-tested DOM logic carries over unchanged:
// selector fallback chains, echo guards, streaming-stability capture,
// structural text extraction. See the extension's issue history (#9-#11,
// #18) for why each piece exists.

const { ipcRenderer } = require('electron');

const SITE = (process.argv.find(a => a.startsWith('--agora-site=')) || '').split('=')[1] || 'unknown';
const isDeepSeek = SITE === 'DeepSeek';
const isClaude = SITE === 'Claude';

ipcRenderer.on('site:inject', (e, text) => injectMessage(text));
ipcRenderer.on('site:debugSnapshot', (e, reqId) => {
  ipcRenderer.send(`site:debugSnapshot:${reqId}`, buildDebugSnapshot());
});
// Fired when the bridge is (re)started: treat everything currently on the
// page as already-seen so pre-existing chat history isn't captured and
// forwarded as if it were new. Runs twice because a site's SPA can finish
// rendering its history a beat after the event arrives.
ipcRenderer.on('site:rebaseline', () => rebaseline());

function normalize(t) {
  return (t || '').replace(/\s+/g, ' ').trim();
}

// ---- echo guard -------------------------------------------------------
// Texts we recently typed into this page. Anything captured that matches
// one is our own injection echoing back — never forward it. A list, not a
// single value: bursts of injections defeated a single-slot guard.
const recentInjections = [];

function rememberInjection(text) {
  recentInjections.push(normalize(text));
  if (recentInjections.length > 10) recentInjections.shift();
}

function isEchoOfInjected(text) {
  const t = normalize(text);
  if (!t) return false;
  return recentInjections.some(inj => {
    if (!inj) return false;
    if (t === inj) return true;
    if (t.includes(inj) && t.length < inj.length + 200) return true;
    if (inj.includes(t)) return true;
    return false;
  });
}

// ---- text extraction --------------------------------------------------
// Prose elements only — raw container textContent also carries screen-reader
// labels ("Claude responded:"), thinking-block summaries, and React
// double-renders.
function getMessageText(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll([
    'button', 'svg', '[aria-hidden="true"]',
    '[class*="sr-only"]', '[class*="screenreader"]',
    'details', 'summary',
    '[class*="thinking"]', '[class*="thought"]',
    '[data-testid*="thinking"]', '[data-testid*="thought"]'
  ].join(',')).forEach(n => n.remove());

  const proseSelector = 'p, li, pre, blockquote, h1, h2, h3, h4';
  const prose = Array.from(clone.querySelectorAll(proseSelector))
    .filter(n => !n.parentElement?.closest(proseSelector));

  let blocks;
  if (prose.length) {
    blocks = prose.map(n => n.textContent?.trim()).filter(Boolean);
  } else {
    blocks = [clone.textContent?.trim() || ''];
  }
  blocks = blocks.filter((b, i) => b !== blocks[i - 1]);

  let text = blocks.join('\n').trim();
  text = text.replace(/^(Claude|DeepSeek) responded:\s*/i, '');
  if (text.length % 2 === 0) {
    const half = text.slice(0, text.length / 2);
    if (half === text.slice(text.length / 2)) text = half.trim();
  }
  return text;
}

// ---- selectors ---------------------------------------------------------
function resolveInputField() {
  if (isDeepSeek) {
    return document.querySelector('textarea[placeholder*="Ask DeepSeek"]')
        || document.querySelector('textarea[placeholder*="输入"]')
        || document.querySelector('textarea[class*="chat"]')
        || document.querySelector('textarea');
  }
  if (isClaude) {
    return document.querySelector('div[contenteditable="true"].ProseMirror')
        || document.querySelector('div[contenteditable="true"][data-placeholder]')
        || document.querySelector('div[contenteditable="true"]')
        || document.querySelector('textarea[placeholder*="Message Claude"]')
        || document.querySelector('textarea[placeholder*="message"]');
  }
  return null;
}

// Must be called AFTER text is injected — Claude only adds the send button
// to the DOM once the input has content.
function resolveSendButton() {
  if (isDeepSeek) {
    return document.querySelector('button[aria-label*="Send"]')
        || document.querySelector('button[type="submit"]')
        || document.querySelector('button[class*="send"]')
        || document.querySelector('button:has(svg[class*="send"])');
  }
  if (isClaude) {
    return document.querySelector('button[aria-label="Send message"]')
        || document.querySelector('button[aria-label*="Send"]')
        || document.querySelector('button[data-testid="send-button"]')
        || document.querySelector('fieldset button[type="button"]:has(svg)');
  }
  return null;
}

function warnSelectorFailure(what) {
  console.warn(`[Agora] Could not find ${what} on ${SITE}.`);
  ipcRenderer.send('site:selectorError', { site: SITE, what });
}

// ---- injection ---------------------------------------------------------
function setInputText(inputField, message) {
  if (inputField.tagName === 'DIV' && inputField.contentEditable === 'true') {
    inputField.focus();
    document.getSelection().selectAllChildren(inputField);
    const inserted = document.execCommand('insertText', false, message);
    if (!inserted) {
      inputField.textContent = message;
      inputField.dispatchEvent(new InputEvent('input', { bubbles: true, data: message, inputType: 'insertText' }));
    }
  } else {
    inputField.value = message;
    inputField.dispatchEvent(new Event('input', { bubbles: true }));
    inputField.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function pressEnter(inputField) {
  const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
  inputField.dispatchEvent(new KeyboardEvent('keydown', opts));
  inputField.dispatchEvent(new KeyboardEvent('keyup', opts));
}

function injectMessage(message) {
  const inputField = resolveInputField();
  if (!inputField) {
    warnSelectorFailure('input field');
    return;
  }

  rememberInjection(message);
  setInputText(inputField, message);

  setTimeout(() => {
    const sendButton = resolveSendButton();
    if (sendButton && !sendButton.disabled) {
      sendButton.click();
    } else {
      pressEnter(inputField);
    }
  }, 600);
}

// ---- capture -----------------------------------------------------------
function isGenerating() {
  if (isDeepSeek) {
    // NB: no generic [class*="loading"] — DeepSeek keeps permanently
    // "loading"-classed elements in its DOM
    return !!(
      document.querySelector('button[aria-label*="Stop"]') ||
      document.querySelector('button[class*="stop"]')
    );
  }
  if (isClaude) {
    return !!(
      document.querySelector('[data-is-streaming="true"]') ||
      document.querySelector('button[aria-label*="Stop"]') ||
      document.querySelector('button[data-testid="stop-button"]') ||
      document.querySelector('button[aria-label*="stop"]')
    );
  }
  return false;
}

function getMessageNodes() {
  if (isClaude) {
    const nodes = document.querySelectorAll('[data-is-streaming]');
    if (nodes.length) return nodes;
  }
  return document.querySelectorAll(
    '[data-testid*="message"], [class*="message"], [class*="chat-item"]'
  );
}

function isAIMessage(el) {
  if (isClaude && el.hasAttribute('data-is-streaming')) return true;
  return !el.querySelector('[class*="user"]') &&
         !el.querySelector('[data-testid*="user"]') &&
         !el.closest('[data-testid*="user"]') &&
         !el.closest('[class*="user"]');
}

// Wait until the element's text stops changing (two consecutive polls
// identical) AND the site no longer reports generation in progress
function waitForStableText(el, callback, maxWaitMs = 180000) {
  const start = Date.now();
  let prev = null;
  let stablePolls = 0;

  const poll = setInterval(() => {
    const text = normalize(el.textContent);

    if (text && text === prev && !isGenerating()) {
      stablePolls++;
      if (stablePolls >= 2) {
        clearInterval(poll);
        callback(getMessageText(el));
        return;
      }
    } else {
      stablePolls = 0;
    }
    prev = text;

    if (Date.now() - start > maxWaitMs) {
      clearInterval(poll);
      console.warn(`[Agora] Timed out waiting for response to stabilize (isGenerating=${isGenerating()}).`);
      callback(getMessageText(el));
    }
  }, 750);
}

// Mark every message currently on the page as seen, so nothing already
// present gets forwarded. Runs at t=0 and again shortly after, to catch
// history the SPA renders slightly late.
function rebaseline() {
  const mark = () => getMessageNodes().forEach(n => {
    if (!n.dataset.agoraSeen) n.dataset.agoraSeen = 'baseline';
  });
  mark();
  setTimeout(mark, 1500);
}

function observeResponses() {
  // anything already on the page predates this session — never forward it
  getMessageNodes().forEach(n => {
    if (!n.dataset.agoraSeen) n.dataset.agoraSeen = 'preexisting';
  });

  const observer = new MutationObserver(() => {
    // scan backwards for the newest unseen AI message with actual text —
    // last-node-only broke on DeepSeek's trailing junk nodes
    const nodes = getMessageNodes();
    const floor = Math.max(0, nodes.length - 10);

    for (let i = nodes.length - 1; i >= floor; i--) {
      const el = nodes[i];
      if (el.dataset.agoraSeen) break;
      if (el.dataset.agoraPending) return;
      if (!isAIMessage(el) || !normalize(el.textContent)) continue;

      el.dataset.agoraPending = 'true';
      waitForStableText(el, (finalText) => {
        delete el.dataset.agoraPending;
        if (el.dataset.agoraSeen) return;
        if (!finalText) {
          el.dataset.agoraSeen = 'empty';
          return;
        }
        if (isEchoOfInjected(finalText)) {
          el.dataset.agoraSeen = 'echo';
          return;
        }
        el.dataset.agoraSeen = 'true';
        console.debug(`[Agora] Captured response (${finalText.length} chars).`);
        ipcRenderer.send('site:newMessage', { sender: SITE, message: finalText });
      });
      return;
    }
  });

  const targetNode = document.querySelector('#root') || document.body;
  if (!targetNode) return;
  observer.observe(targetNode, { childList: true, subtree: true, characterData: true });
}

window.addEventListener('load', () => {
  observeResponses();
});

// ---- diagnostics -------------------------------------------------------
function describeNode(el) {
  if (!el) return null;
  return {
    tag: el.tagName?.toLowerCase(),
    id: el.id || undefined,
    classes: (el.className && typeof el.className === 'string')
      ? el.className.slice(0, 120) : undefined,
    attrs: {
      'data-testid': el.getAttribute?.('data-testid') || undefined,
      'aria-label': el.getAttribute?.('aria-label') || undefined,
      'data-is-streaming': el.getAttribute?.('data-is-streaming') || undefined,
      placeholder: el.getAttribute?.('placeholder') || undefined
    },
    textPreview: (el.textContent || '').trim().slice(0, 80) || undefined
  };
}

function buildDebugSnapshot() {
  const nodes = Array.from(getMessageNodes());
  return {
    site: SITE,
    url: window.location.href,
    timestamp: new Date().toISOString(),
    inputField: describeNode(resolveInputField()),
    sendButton: describeNode(resolveSendButton()),
    isGenerating: isGenerating(),
    messageNodeCount: nodes.length,
    lastNodes: nodes.slice(-3).map(n => ({
      ...describeNode(n),
      agoraSeen: n.dataset.agoraSeen || undefined,
      agoraPending: n.dataset.agoraPending || undefined,
      isAIMessage: isAIMessage(n)
    })),
    recentInjectionCount: recentInjections.length,
    lastInjectionPreview: recentInjections[recentInjections.length - 1]?.slice(0, 80) || null
  };
}
