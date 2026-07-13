# Agora Desktop App

The Electron version of the [AI Conversation Bridge extension](../ai-conversation-bridge/) — DeepSeek and Claude side by side in **one window**, with the conversation log, interject bar, and bridge controls built in. See [issue #20](../../../issues/20) for the full design rationale.

## Why the app exists (vs. the extension)

| Problem in the extension | In the app |
|---|---|
| Can't embed the AI sites in one page (`X-Frame-Options`) | `WebContentsView` panels are separate browsing contexts, not iframes — live side-by-side panels in one window |
| MV3 service worker dies (~30s idle), needed `chrome.alarms` backstops + Reset Connection | Main process is a normal long-running Node process — plain timers just work |
| Hidden-tab timer throttling stalls capture | Panels are always rendered in the app window |
| Tab detection / Sync Tabs / stale tab IDs | The app owns its panels — nothing to detect or lose |

All the battle-tested DOM logic (selector chains, echo guards, streaming-stability capture, structural text extraction — see the [CHANGELOG](../CHANGELOG.md)) ports over unchanged in `preload/site.js`.

## Run it

Requires [Node.js](https://nodejs.org/) (LTS is fine).

```cmd
cd /d "G:\My Drive\coding\ai\Agora\agora-app"
npm install
npm start
```

First run: log into DeepSeek (left panel) and Claude (right panel). Sessions persist across restarts (separate storage partitions, independent of your regular Chrome profile).

Then: **Start Bridge**, and use the bottom bar to interject as `[Human]`. Voice commands (`stop`, `pause`, `resume`) and the mutual `[STOP_BRIDGE]` token work the same as the extension.

## Layout

```
┌───────────────────────────────────────────────────────┐
│ 🏛️ Agora [On]        ● DeepSeek ⟳ 🔧  ● Claude ⟳ 🔧   │  header
├──────────┬──────────────────────┬─────────────────────┤
│ controls │                      │                     │
│ settings │   DeepSeek panel     │   Claude panel      │
│ ──────── │   (live site)        │   (live site)       │
│ log      │                      │                     │
│ stream   │                      │                     │
├──────────┴──────────────────────┴─────────────────────┤
│ Interject as [Human]…            [→ Claude ▾] [Send]  │  footer
└───────────────────────────────────────────────────────┘
```

## Project structure

```
agora-app/
├── main.js              # window, WebContentsView panels, layout, IPC plumbing
├── lib/
│   ├── bridge.js        # relay engine (port of the extension's background.js)
│   └── store.js         # JSON-file state persistence (replaces chrome.storage)
├── preload/
│   ├── site.js          # injected into each AI panel (port of content.js)
│   └── console.js       # contextBridge API for the console UI
└── ui/
    ├── console.html     # the app's own chrome: header, log panel, interject bar
    └── console.js       # state-driven renderer
```

## Known caveats (v0.1)

- **Unvalidated core assumption**: whether claude.ai and chat.deepseek.com fully work inside `WebContentsView` (rendering, login, streaming) needs this first real run — that's the point of this prototype. If a site refuses to work, that finding goes straight to #20.
- **Google/OAuth sign-in may be blocked** inside embedded views ("disallowed_useragent"). Use email-based login if that happens.
- No auto-update, packaging, or code signing yet — run from source with `npm start`.
- The extension remains the zero-install option; the app is the "one window, no tab juggling" option. Both share the same DOM logic and will drift unless changes are ported both ways — if this prototype validates, extracting the shared logic into one place is the next step.
