# AI Conversation Bridge

A Chrome extension that lets DeepSeek and Claude talk to each other, with you in control.

> **Also in this repo:**
> - [`agora-app/`](agora-app/) — an Electron **desktop** version showing both AIs side by side in one window. Prototype; see its [README](agora-app/README.md) and [#20](../../issues/20).
> - [`agora-android/`](agora-android/) — a native **Android** version (Kotlin + WebViews). APK builds in CI — grab it from [Releases](../../releases). See its [README](agora-android/README.md) and [#21](../../issues/21).

## What it does

- Automatically forwards each AI's response to the other, creating a back-and-forth conversation
- Runs entirely in the background service worker — keeps bridging after the popup closes
- Waits for the AI to finish streaming before forwarding — no partial messages
- Lets you interject at any time with your own message (sent to both AIs simultaneously)
- Manual forward buttons: chat with one AI privately, then hand its last response to the other
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

### Manual forwarding

The **Claude ➡️ DeepSeek** and **DeepSeek ➡️ Claude** buttons grab the most recent response from one AI and type it into the other. They work with the bridge **off** — useful for developing a plan with one AI privately, then sharing the finished result.

### Notes

- Works in Chrome split view as well as separate tabs (split view panes are still separate tabs).
- **Keep both AI tabs visible** (split view or side-by-side windows). Chrome throttles timers in hidden tabs — a backgrounded tab can delay response capture by up to a minute, which looks like the bridge stalling until you click the tab.
- **Claude Code sessions (`claude.ai/code/...`) are not bridged** — that's a coding agent, not the chat product. Use a regular chat at [claude.ai/new](https://claude.ai/new).
- After pulling an update, reload the extension at `chrome://extensions/` **and refresh both AI tabs** so the new content script loads.

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

## Related projects

AI-to-AI conversation is a growing space; a few things worth knowing about, found while researching whether this idea was novel (see [#13](../../issues/13)):

| Project | Mechanism | How it compares to Agora |
|---|---|---|
| **[Camelia](https://chromewebstore.google.com/detail/camelia/elgfamgapnaflgdmndekkodcmhkpjilh)** | Chrome extension, DOM injection, two-tab relay with turn limits | Closest structural match — but hardcoded to 2023-era ChatGPT (`chat.openai.com`), confirmed non-functional today (content script never migrated to `chatgpt.com`). 28 users, effectively abandoned. |
| **[Gibberlink](https://github.com/PennyroyalTea/gibberlink)** | Voice/phone calls — two AI agents detect each other and switch from English to an efficient sound-level protocol (`ggwave`) | Different domain (audio calls, not text chat); ElevenLabs hackathon winner, a proof-of-concept rather than an installable tool. |
| **[AgentPipe](https://github.com/kevinelliott/agentpipe)** | Terminal/TUI app — orchestrates official CLI tools (Claude Code, Gemini CLI, etc.) in a shared "room" | Closest architectural cousin: turn-based, multi-agent, metrics/cost tracking. Uses **paid API/CLI access** rather than free logged-in web sessions — the opposite trade-off from Agora (no DOM fragility, but requires API keys/costs). |
| **[Agent4Science](https://agent4science.org/)** | Web platform — AI agents with distinct personas share papers, write peer reviews, and debate each other; humans observe/configure but only agents post | Academic research project (University of Chicago, Chicago Human+AI Lab, launched April 2026), not a general-purpose chat bridge — but a serious example of multi-agent dialogue with a defined social structure. |
| ChatHub | Web app/extension, **fan-out** (one prompt → up to 6 models reply independently) | Different category entirely — models never see each other's answers. No AI-to-AI dialogue. Its per-model grid UI is a design reference for [#16](../../issues/16). |
| "The Bot Has A Question" | Python script, two API-backed assistants looping questions | Same basic idea as Agora's core loop, but no moderation, pause, or interject — just an unattended loop. |

**Where Agora sits**: every serious implementation of true AI-to-AI dialogue (AgentPipe, the academic frameworks) is API or CLI-based, avoiding the DOM-fragility problems this project spent considerable effort solving (echoes, streaming truncation, selector rot — see [CHANGELOG](CHANGELOG.md)). Agora's bet is the opposite trade-off: no API costs, using free logged-in web sessions, at the cost of being more fragile to each site's UI. What's less common anywhere in this list is Agora's **human moderation layer** — live interject, pause/resume voice commands, per-direction manual forwarding, and a mutual stop-token both AIs can use to end a conversation cleanly.

## Roadmap

See the [open issues](../../issues) for planned improvements.

## License

MIT
