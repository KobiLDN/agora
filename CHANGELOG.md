# Changelog

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
