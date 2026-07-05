# AI Conversation Bridge

A Chrome extension that lets DeepSeek and Claude talk to each other, with you in control.

## What it does

- Automatically forwards each AI's response to the other, creating a back-and-forth conversation
- Lets you interject at any time with your own message (sent to both AIs simultaneously)
- Keeps a live conversation log in the popup
- Persists state across browser sessions via `chrome.storage.local`

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked** and select the `ai-conversation-bridge/` folder
5. The extension icon appears in your toolbar

## Usage

1. Open [chat.deepseek.com](https://chat.deepseek.com) in one tab
2. Open [claude.ai](https://claude.ai) in another tab
3. Click the extension icon — both tabs should show as **Connected**
4. Click **Start Bridge** to begin the automated conversation
5. Use the text area to interject your own message at any time
6. Click **Stop Bridge** to pause, or **Clear Log** to reset the conversation log

## Project structure

```
ai-conversation-bridge/
├── manifest.json       # MV3 manifest (permissions, content scripts, service worker)
├── popup.html          # Extension popup UI
├── popup.js            # Popup logic: bridge control, tab detection, log rendering
├── background.js       # Service worker: tab syncing, bridge state relay
├── content.js          # Injected into both chat sites: input injection + response observation
├── inject.js           # Optional deep-injection stub for future React/Vue state access
└── icons/              # Extension icons (16×16, 48×48, 128×128)
```

## Known limitations

- **Selector fragility** — relies on CSS selectors that may break when either site updates its UI ([#1](../../issues/1))
- **Streaming responses** — the extension may capture a partial response before the AI finishes generating ([#2](../../issues/2))
- No built-in throttle between turns — the conversation can move fast ([#3](../../issues/3))
- Conversation log is not exportable yet ([#4](../../issues/4))

## Roadmap

See the [open issues](../../issues) for planned improvements.

## License

MIT
