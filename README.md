# AI Conversation Bridge

A Chrome extension that lets DeepSeek and Claude talk to each other, with you in control.

## What it does

- Automatically forwards each AI's response to the other, creating a back-and-forth conversation
- Waits for the AI to finish streaming before forwarding — no more partial messages
- Lets you interject at any time with your own message (sent to both AIs simultaneously)
- Configurable turn delay and max-turn limit so the conversation doesn't run away
- Exports the conversation log as JSON or Markdown
- Surfaces a visible error banner if a site's UI changes and selectors break
- Persists all state across browser sessions via `chrome.storage.local`

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
6. Click **Stop Bridge** to pause, or **Clear Log** to reset the log

### Settings

Click **⚙️ Settings** in the popup to configure:

| Setting | Default | Description |
|---|---|---|
| Turn delay | 3 s | Pause between forwarding a response to the other AI |
| Max turns | 0 (unlimited) | Bridge auto-pauses after this many automated exchanges |

### Exporting the log

Use the **JSON** or **MD** buttons next to the log header to download the full conversation. JSON preserves timestamps; Markdown formats it as a readable transcript.

## Project structure

```
ai-conversation-bridge/
├── manifest.json       # MV3 manifest (permissions, content scripts, service worker)
├── popup.html          # Extension popup UI
├── popup.js            # Popup logic: bridge control, settings, log, export
├── background.js       # Service worker: tab syncing, bridge state relay
├── content.js          # Injected into both chat sites: input injection + response observation
├── inject.js           # Optional deep-injection stub for future React/Vue state access
└── icons/              # Extension icons (16×16, 48×48, 128×128)
```

## Roadmap

See the [open issues](../../issues) for planned improvements.

## License

MIT
