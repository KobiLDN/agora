// Injected into each AI site's WebView. Port of the extension's content.js /
// the desktop app's preload/site.js, with the messaging channel swapped for
// the Android @JavascriptInterface `AgoraNative`.
//
// Kotlin sets window.__AGORA_SITE__ = "DeepSeek" | "Claude" before this runs,
// calls window.__agoraInject(text) to type a message, and receives captured
// responses via AgoraNative.onMessage(JSON).
//
// NOTE: these selectors were derived against the DESKTOP sites. The mobile
// layouts of claude.ai / chat.deepseek.com differ, so some may need a mobile
// pass — the generic fallbacks (any textarea / contenteditable) are the
// safety net, and window.__agoraSnapshot() reports what actually resolved.
(function () {
  if (window.__agoraInstalled) return;
  window.__agoraInstalled = true;

  var SITE = window.__AGORA_SITE__ || 'unknown';
  var isDeepSeek = SITE === 'DeepSeek';
  var isClaude = SITE === 'Claude';

  function normalize(t) {
    return (t || '').replace(/\s+/g, ' ').trim();
  }

  // ---- echo guard: don't recapture our own injected text ----
  var recentInjections = [];
  function rememberInjection(text) {
    recentInjections.push(normalize(text));
    if (recentInjections.length > 10) recentInjections.shift();
  }
  function isEchoOfInjected(text) {
    var t = normalize(text);
    if (!t) return false;
    for (var i = 0; i < recentInjections.length; i++) {
      var inj = recentInjections[i];
      if (!inj) continue;
      if (t === inj) return true;
      if (t.indexOf(inj) !== -1 && t.length < inj.length + 200) return true;
      if (inj.indexOf(t) !== -1) return true;
    }
    return false;
  }

  function getMessageText(el) {
    var clone = el.cloneNode(true);
    var junk = clone.querySelectorAll(
      'button, svg, [aria-hidden="true"], [class*="sr-only"], [class*="screenreader"],' +
      'details, summary, [class*="thinking"], [class*="thought"],' +
      '[data-testid*="thinking"], [data-testid*="thought"]'
    );
    for (var i = 0; i < junk.length; i++) junk[i].remove();

    var proseSelector = 'p, li, pre, blockquote, h1, h2, h3, h4';
    var proseAll = clone.querySelectorAll(proseSelector);
    var prose = [];
    for (var j = 0; j < proseAll.length; j++) {
      var n = proseAll[j];
      if (!(n.parentElement && n.parentElement.closest(proseSelector))) prose.push(n);
    }

    var blocks;
    if (prose.length) {
      blocks = prose.map(function (n) { return (n.textContent || '').trim(); }).filter(Boolean);
    } else {
      blocks = [(clone.textContent || '').trim()];
    }
    blocks = blocks.filter(function (b, i) { return b !== blocks[i - 1]; });

    var text = blocks.join('\n').trim();
    text = text.replace(/^(Claude|DeepSeek) responded:\s*/i, '');
    if (text.length % 2 === 0) {
      var half = text.slice(0, text.length / 2);
      if (half === text.slice(text.length / 2)) text = half.trim();
    }
    return text;
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
        || document.querySelector('textarea[placeholder*="message"]');
    }
    return document.querySelector('textarea') || document.querySelector('div[contenteditable="true"]');
  }

  function resolveSendButton() {
    if (isDeepSeek) {
      return document.querySelector('button[aria-label*="Send"]')
        || document.querySelector('button[type="submit"]')
        || document.querySelector('button[class*="send"]');
    }
    if (isClaude) {
      return document.querySelector('button[aria-label="Send message"]')
        || document.querySelector('button[aria-label*="Send"]')
        || document.querySelector('button[data-testid="send-button"]');
    }
    return document.querySelector('button[aria-label*="Send"]');
  }

  function warnSelectorFailure(what) {
    try { AgoraNative.onSelectorError(what); } catch (e) {}
  }

  function setInputText(inputField, message) {
    if (inputField.tagName === 'DIV' && inputField.contentEditable === 'true') {
      inputField.focus();
      try { document.getSelection().selectAllChildren(inputField); } catch (e) {}
      var inserted = false;
      try { inserted = document.execCommand('insertText', false, message); } catch (e) {}
      if (!inserted) {
        inputField.textContent = message;
        inputField.dispatchEvent(new InputEvent('input', { bubbles: true, data: message, inputType: 'insertText' }));
      }
    } else {
      var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
      if (setter && setter.set) setter.set.call(inputField, message);
      else inputField.value = message;
      inputField.dispatchEvent(new Event('input', { bubbles: true }));
      inputField.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function pressEnter(inputField) {
    var opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    inputField.dispatchEvent(new KeyboardEvent('keydown', opts));
    inputField.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  window.__agoraInject = function (message) {
    var inputField = resolveInputField();
    if (!inputField) { warnSelectorFailure('input field'); return; }
    rememberInjection(message);
    setInputText(inputField, message);
    setTimeout(function () {
      var sendButton = resolveSendButton();
      if (sendButton && !sendButton.disabled) sendButton.click();
      else pressEnter(inputField);
    }, 600);
  };

  function isGenerating() {
    if (isDeepSeek) {
      return !!(document.querySelector('button[aria-label*="Stop"]') ||
                document.querySelector('button[class*="stop"]'));
    }
    if (isClaude) {
      return !!(document.querySelector('[data-is-streaming="true"]') ||
                document.querySelector('button[aria-label*="Stop"]') ||
                document.querySelector('button[data-testid="stop-button"]'));
    }
    return false;
  }

  function getMessageNodes() {
    if (isClaude) {
      var nodes = document.querySelectorAll('[data-is-streaming]');
      if (nodes.length) return nodes;
    }
    return document.querySelectorAll('[data-testid*="message"], [class*="message"], [class*="chat-item"]');
  }

  function isAIMessage(el) {
    if (isClaude && el.hasAttribute('data-is-streaming')) return true;
    return !el.querySelector('[class*="user"]') &&
           !el.querySelector('[data-testid*="user"]') &&
           !el.closest('[data-testid*="user"]') &&
           !el.closest('[class*="user"]');
  }

  function waitForStableText(el, callback, maxWaitMs) {
    maxWaitMs = maxWaitMs || 180000;
    var start = Date.now();
    var prev = null;
    var stablePolls = 0;
    var poll = setInterval(function () {
      var text = normalize(el.textContent);
      if (text && text === prev && !isGenerating()) {
        stablePolls++;
        if (stablePolls >= 2) { clearInterval(poll); callback(getMessageText(el)); return; }
      } else {
        stablePolls = 0;
      }
      prev = text;
      if (Date.now() - start > maxWaitMs) { clearInterval(poll); callback(getMessageText(el)); }
    }, 750);
  }

  function observeResponses() {
    var nodes0 = getMessageNodes();
    for (var i = 0; i < nodes0.length; i++) {
      if (!nodes0[i].dataset.agoraSeen) nodes0[i].dataset.agoraSeen = 'preexisting';
    }

    var observer = new MutationObserver(function () {
      var nodes = getMessageNodes();
      var floor = Math.max(0, nodes.length - 10);
      for (var i = nodes.length - 1; i >= floor; i--) {
        var el = nodes[i];
        if (el.dataset.agoraSeen) break;
        if (el.dataset.agoraPending) return;
        if (!isAIMessage(el) || !normalize(el.textContent)) continue;

        el.dataset.agoraPending = 'true';
        (function (el) {
          waitForStableText(el, function (finalText) {
            delete el.dataset.agoraPending;
            if (el.dataset.agoraSeen) return;
            if (!finalText) { el.dataset.agoraSeen = 'empty'; return; }
            if (isEchoOfInjected(finalText)) { el.dataset.agoraSeen = 'echo'; return; }
            el.dataset.agoraSeen = 'true';
            try { AgoraNative.onMessage(SITE, finalText); } catch (e) {}
          });
        })(el);
        return;
      }
    });

    var target = document.querySelector('#root') || document.body;
    if (target) observer.observe(target, { childList: true, subtree: true, characterData: true });
  }

  window.__agoraSnapshot = function () {
    var nodes = getMessageNodes();
    var input = resolveInputField();
    var send = resolveSendButton();
    function describe(el) {
      if (!el) return null;
      return {
        tag: el.tagName ? el.tagName.toLowerCase() : null,
        classes: (typeof el.className === 'string') ? el.className.slice(0, 120) : null,
        placeholder: el.getAttribute ? el.getAttribute('placeholder') : null,
        ariaLabel: el.getAttribute ? el.getAttribute('aria-label') : null
      };
    }
    return JSON.stringify({
      site: SITE,
      url: location.href,
      inputField: describe(input),
      sendButton: describe(send),
      isGenerating: isGenerating(),
      messageNodeCount: nodes.length,
      recentInjectionCount: recentInjections.length
    });
  };

  if (document.readyState === 'complete') observeResponses();
  else window.addEventListener('load', observeResponses);
})();
