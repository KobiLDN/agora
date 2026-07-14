# Changelog

## v2.0 — 2026-07-13

Two new form factors beyond the Chrome extension, both sharing the extension's battle-tested DOM logic.

### Added
- **Desktop app** (`agora-app/`, Electron, #20) — DeepSeek and Claude as live side-by-side panels in one window, no tab-juggling. `WebContentsView` panels aren't iframes, so `X-Frame-Options` doesn't block them. Relay logic ported minus every MV3 workaround (no service-worker death, no alarms backstop). Validated working on Windows.
- **Android app** (`agora-android/`, Kotlin + WebViews, #21) — the bridge on a phone. Relay ported to Kotlin, `content.js` DOM logic to an injected JS asset. APK built in CI (`.github/workflows/android.yml`) and published to the `android-latest` release for direct phone download — no Android Studio needed.

### Fixed (desktop)
- **DeepSeek "Abnormal usage environment"** — Electron's default UA advertises `Electron/x` + app name, which DeepSeek's anti-automation flags. `cleanUserAgent()` strips those so each panel presents as plain Chrome.
- **Header status dots stuck red** — now reflect each panel's actual load state (green when loaded), with the state re-sent on UI load to avoid a startup race.
- **Stale history forwarded on Start Bridge** (#22) — clearing the log doesn't clear the panels' on-screen chat history; the observer could grab a pre-existing message and forward it. Start Bridge now re-baselines both panels so only messages appearing after Start get relayed.

## v1.3 — 2026-07-09

Hardening from extended live testing — a multi-hour bridged conversation where the AIs themselves helped diagnose the bugs (the service-worker issue was spotted by the bridged Claude chat reading the code).

### Fixed
- **DeepSeek responses never forwarded** (#11) — a permanent "loading"-classed element made the extension think DeepSeek was generating forever; and the observer's last-node-only targeting with a global lock jammed on DeepSeek's trailing junk nodes. Observer now scans backwards for the newest unseen non-empty AI message with per-node tracking.
- **Scheduled forwards silently lost** (#12) — bare `setTimeout` in the MV3 service worker dies with the worker. Forwards are now persisted to storage with a `chrome.alarms` backstop that can wake a dead worker. (Adds `alarms` permission.)
- **Echo mislabeling under bursts** (#9) — the echo guard remembered only the last injected text; rapid messages (e.g. after a user interject) let an older injected bubble through, sending Claude its own words as `[DeepSeek]`. Guard now tracks the last 10 injections.
- **Polluted captures** (#10) — screen-reader prefixes ("Claude responded:"), thinking-block summaries, and doubled renders stripped via structural prose extraction.

### Added
- **Sender labels** — forwarded messages carry `[DeepSeek]`/`[Claude]`/`[Human]` prefixes plus a one-time bridge notice, so each AI knows it's talking to another AI with human supervision. Toggleable in Settings.
- Console debug logging (`[AI Bridge]` lines) for diagnosing capture issues from the page console.

### Known limitations
- Chrome throttles timers in hidden tabs — keep both AI tabs visible (split view). Documented in README.
- Claude Code sessions (`claude.ai/code`) are explicitly excluded — they're a coding agent, not the chat product.

## v1.2 — 2026-07-09

Fixes from the first live end-to-end test (a real DeepSeek ⇄ Claude conversation).

### Fixed
- **Bridge stopped working when the popup closed** (#8) — all forwarding logic lived in the popup, which Chrome destroys the moment you click a page. Everything now runs in the background service worker; the popup is just a viewer.
- **Infinite echo loop** (#8) — injected messages were reported back as AI responses, so a forwarded message would bounce between the two sites forever.
- **Claude send button never found** (#1) — on claude.ai the send button only appears once the input has content; we looked for it before typing. Now resolved after injection, with an Enter-key fallback.
- **Claude editor ignored injected text** (#1) — ProseMirror doesn't react to `textContent` writes; injection now uses `execCommand('insertText')`.
- **Claude Code tabs mistaken for chat** (#1) — `claude.ai/code/*` (Claude Code sessions) matched the URL check, so the bridge scraped coding status text like "Edited 2 files". Now excluded.

### Added
- **Manual forward buttons** — "Claude ➡️ DeepSeek" and "DeepSeek ➡️ Claude" grab the last AI response and hand it to the other side, with the bridge off. Chat privately with one AI, then share the result on demand.

## v1.1 — 2026-07-05

### Added
- Turn delay and max-turn limit settings (#3)
- Export conversation log as JSON or Markdown (#4)
- Wait for streaming to finish before forwarding (#2)
- Fallback selector chains and visible error banner when a site's UI changes (#1)

## v1.0 — 2026-07-05

Initial release: DeepSeek ⇄ Claude bridge with auto-forwarding, user interjection, and a persistent conversation log.
