const isDeepSeek = window.location.href.includes('chat.deepseek.com');
const isClaude = window.location.href.includes('claude.ai');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'sendMessage') {
    injectMessage(message.message);
    sendResponse({ success: true });
  }
});

function injectMessage(message) {
  let inputField = null;
  let sendButton = null;

  if (isDeepSeek) {
    inputField = document.querySelector('textarea[placeholder*="Ask DeepSeek"]') ||
                 document.querySelector('textarea[placeholder*="输入"]') ||
                 document.querySelector('textarea');

    sendButton = document.querySelector('button[type="submit"]') ||
                 document.querySelector('button[aria-label*="Send"]') ||
                 document.querySelector('button:has(svg)');
  } else if (isClaude) {
    inputField = document.querySelector('div[contenteditable="true"]') ||
                 document.querySelector('textarea[placeholder*="Message Claude"]');

    sendButton = document.querySelector('button[aria-label*="Send"]') ||
                 document.querySelector('button[data-testid="send-button"]');
  }

  if (!inputField) return;

  if (inputField.tagName === 'DIV' && inputField.contentEditable === 'true') {
    inputField.textContent = message;
    inputField.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    inputField.value = message;
    inputField.dispatchEvent(new Event('input', { bubbles: true }));
    inputField.dispatchEvent(new Event('change', { bubbles: true }));
  }

  setTimeout(() => {
    if (sendButton) {
      sendButton.click();
      chrome.runtime.sendMessage({
        action: 'newMessage',
        sender: isDeepSeek ? 'DeepSeek' : 'Claude',
        message
      });
    }
  }, 500);
}

function observeResponses() {
  const observer = new MutationObserver(() => {
    const messages = document.querySelectorAll('[data-testid*="message"], [class*="message"], [class*="chat-item"]');
    const lastMessage = messages[messages.length - 1];

    if (lastMessage && !lastMessage.dataset.processed) {
      const text = lastMessage.textContent?.trim();
      if (text && text.length > 0) {
        lastMessage.dataset.processed = 'true';

        const isFromAI = !lastMessage.querySelector('[class*="user"]') &&
                         !lastMessage.querySelector('[data-testid*="user"]');

        if (isFromAI) {
          chrome.runtime.sendMessage({
            action: 'newMessage',
            sender: isDeepSeek ? 'DeepSeek' : 'Claude',
            message: text
          });
        }
      }
    }
  });

  const targetNode = document.querySelector('#root') || document.body;
  observer.observe(targetNode, {
    childList: true,
    subtree: true,
    characterData: true
  });
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
`;
indicator.textContent = '🤖 AI Bridge Connected';
document.body.appendChild(indicator);
