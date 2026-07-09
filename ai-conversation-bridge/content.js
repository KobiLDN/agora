const isDeepSeek = window.location.href.includes('chat.deepseek.com');
// claude.ai/code is Claude Code (a different product) — not a chat we can bridge
const isClaude = window.location.href.includes('claude.ai') &&
                 !window.location.href.includes('claude.ai/code');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'sendMessage') {
    injectMessage(message.message);
    sendResponse({ success: true });
  }

  if (message.action === 'getLastResponse') {
    sendResponse({ text: getLastAIResponse() });
  }
});

function normalize(t) {
  return (t || '').replace(/\s+/g, ' ').trim();
}

// Extracts just the response prose from a message node — Claude's raw
// textContent also contains the thinking-block summary ("Deliberated
// between…"), copy/edit button labels, and sometimes a doubled render.
function getMessageText(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll([
    'button',
    'svg',
    '[aria-hidden="true"]',
    'details',
    'summary',
    '[class*="thinking"]',
    '[class*="thought"]',
    '[data-testid*="thinking"]',
    '[data-testid*="thought"]'
  ].join(',')).forEach(n => n.remove());

  let text = clone.textContent?.trim() || '';

  // captured text sometimes arrives exactly doubled (two renders of the
  // same message inside one node) — collapse it
  if (text.length % 2 === 0) {
    const half = text.slice(0, text.length / 2);
    if (half === text.slice(text.length / 2)) text = half.trim();
  }
  return text;
}

// The last text we typed into this page. Anything we capture that matches it
// is our own injection echoing back — never forward it (this caused the
// "hall of mirrors" loop where DeepSeek received its own words nested deeper
// each round).
let lastInjectedText = '';

function isEchoOfInjected(text) {
  if (!lastInjectedText) return false;
  const t = normalize(text);
  if (t === lastInjectedText) return true;
  // captured bubble = injected text plus a little UI chrome ("Edit", "Copy")
  if (t.includes(lastInjectedText) && t.length < lastInjectedText.length + 200) return true;
  // captured bubble = partially rendered injected text
  if (lastInjectedText.includes(t)) return true;
  return false;
}

// Claude marks assistant responses with data-is-streaming — when present,
// those nodes are the only reliable message list (user bubbles never carry it)
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

// Returns the text of the most recent AI message on the page, or null
function getLastAIResponse() {
  const messages = getMessageNodes();
  for (let i = messages.length - 1; i >= 0; i--) {
    const el = messages[i];
    if (!isAIMessage(el)) continue;
    const text = getMessageText(el);
    if (text && !isEchoOfInjected(text)) return text;
  }
  return null;
}

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

// NOTE: must be called AFTER text is injected — on Claude the send button
// is only added to the DOM once the input has content.
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
  const site = isDeepSeek ? 'DeepSeek' : 'Claude';
  console.warn(`[AI Bridge] Could not find ${what} on ${site}. The site's UI may have changed — see issue #1.`);
  chrome.runtime.sendMessage({ action: 'selectorError', site, what });
  indicator.style.background = '#dc3545';
  indicator.textContent = `⚠️ AI Bridge: ${what} not found`;
  setTimeout(() => {
    indicator.style.background = '#4a6cf7';
    indicator.textContent = '🤖 AI Bridge Connected';
  }, 4000);
}

function setInputText(inputField, message) {
  if (inputField.tagName === 'DIV' && inputField.contentEditable === 'true') {
    // ProseMirror/React editors ignore plain textContent changes;
    // insertText goes through the browser's editing pipeline they listen to
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

  lastInjectedText = normalize(message);
  setInputText(inputField, message);

  // Give the site's framework a beat to register the input and render the send button
  setTimeout(() => {
    const sendButton = resolveSendButton();
    if (sendButton && !sendButton.disabled) {
      sendButton.click();
    } else {
      // Fall back to submitting with Enter — works on both sites
      pressEnter(inputField);
    }
  }, 600);
}

// #2 — wait for streaming to finish before forwarding the response
function isGenerating() {
  if (isDeepSeek) {
    // NB: no generic [class*="loading"] here — DeepSeek keeps permanently
    // "loading"-classed elements in its DOM, which made this always true and
    // blocked forwarding entirely. Text stability is the main guard instead.
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

// Waits until the element's text has stopped changing (two consecutive polls
// identical, ~1.5s apart) AND the site no longer reports generation in
// progress. Site "is generating" selectors alone proved unreliable — DeepSeek
// responses were captured mid-stream and forwarded truncated ("So let…").
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
      console.warn(`[AI Bridge] Timed out waiting for response to stabilize (isGenerating=${isGenerating()}).`);
      callback(getMessageText(el));
    }
  }, 750);
}

function observeResponses() {
  let capturing = false;

  const observer = new MutationObserver(() => {
    if (capturing) return;

    const messages = getMessageNodes();
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.dataset.aiBridgeSeen) return;
    if (!isAIMessage(lastMessage)) return;

    capturing = true;
    console.debug('[AI Bridge] New AI message node detected, waiting for it to stabilize…');
    waitForStableText(lastMessage, (finalText) => {
      capturing = false;
      if (!finalText || lastMessage.dataset.aiBridgeSeen) return;
      if (isEchoOfInjected(finalText)) {
        // our own injected text rendered as a chat bubble — ignore it
        console.debug('[AI Bridge] Skipped echo of injected text.');
        lastMessage.dataset.aiBridgeSeen = 'echo';
        return;
      }
      lastMessage.dataset.aiBridgeSeen = 'true';
      console.debug(`[AI Bridge] Captured response (${finalText.length} chars), sending to bridge.`);
      chrome.runtime.sendMessage({
        action: 'newMessage',
        sender: isDeepSeek ? 'DeepSeek' : 'Claude',
        message: finalText
      });
    });
  });

  const targetNode = document.querySelector('#root') || document.body;
  observer.observe(targetNode, { childList: true, subtree: true, characterData: true });
}

if (document.readyState === 'complete') {
  observeResponses();
} else {
  window.addEventListener('load', observeResponses);
}

const indicator = document.createElement('div');
indicator.style.cssText = `
  position: fixed;
  top: 10px;
  right: 10px;
  background: #4a6cf7;
  color: white;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 12px;
  z-index: 9999;
  font-family: -apple-system, sans-serif;
  opacity: 0.7;
  pointer-events: none;
  transition: background 0.3s;
`;
indicator.textContent = '🤖 AI Bridge Connected';
document.body.appendChild(indicator);
