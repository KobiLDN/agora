const isDeepSeek = window.location.href.includes('chat.deepseek.com');
const isClaude = window.location.href.includes('claude.ai');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'sendMessage') {
    injectMessage(message.message);
    sendResponse({ success: true });
  }
});

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
    return !!(
      document.querySelector('button[aria-label*="Stop"]') ||
      document.querySelector('button[class*="stop"]') ||
      document.querySelector('[class*="loading"]')
    );
  }
  if (isClaude) {
    return !!(
      document.querySelector('button[aria-label*="Stop"]') ||
      document.querySelector('button[data-testid="stop-button"]') ||
      document.querySelector('button[aria-label*="stop"]')
    );
  }
  return false;
}

function waitForGenerationEnd(callback, maxWaitMs = 120000) {
  const start = Date.now();
  const poll = setInterval(() => {
    if (!isGenerating()) {
      clearInterval(poll);
      setTimeout(callback, 500);
    } else if (Date.now() - start > maxWaitMs) {
      clearInterval(poll);
      console.warn('[AI Bridge] Timed out waiting for generation to finish.');
      callback();
    }
  }, 500);
}

function observeResponses() {
  let capturing = false;

  const observer = new MutationObserver(() => {
    if (capturing) return;

    const messages = document.querySelectorAll(
      '[data-testid*="message"], [class*="message"], [class*="chat-item"]'
    );
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.dataset.aiBridgeSeen) return;

    const isFromAI = !lastMessage.querySelector('[class*="user"]') &&
                     !lastMessage.querySelector('[data-testid*="user"]');
    if (!isFromAI) return;

    capturing = true;
    waitForGenerationEnd(() => {
      capturing = false;
      const finalText = lastMessage.textContent?.trim();
      if (!finalText || lastMessage.dataset.aiBridgeSeen) return;
      lastMessage.dataset.aiBridgeSeen = 'true';
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
