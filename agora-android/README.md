# Agora Android App

Native Android version of the bridge — DeepSeek and Claude in two WebViews with the relay running in Kotlin. Built for testing on a phone (developed against a Galaxy S23U). See [issue #21](../../../issues/21).

## Get the APK (no Android Studio needed)

A GitHub Actions workflow builds the APK on every push. To install on your phone:

1. Go to the repo's **[Releases](../../../releases)** → **Agora Android (latest debug build)**
2. Download **`agora-debug.apk`** directly on the phone
3. Open it; allow "install from this source" if prompted
4. Play Protect may warn about an unsigned/sideloaded app — expected for a personal debug build

To rebuild on demand: repo → **Actions** → **Build Android APK** → **Run workflow**.

## First run

- **DeepSeek** and **Claude** tabs each load the site — log into both (use **email login**; Google OAuth often refuses inside WebViews with "disallowed_useragent"). Cookies persist across launches.
- **Start** begins the relay; the bottom bar interjects as `[Human]` to the selected target.
- **Log** tab shows the merged conversation.
- Voice commands (`stop` / `pause` / `resume`) and the mutual `[STOP_BRIDGE]` token work as in the other versions.

## How it works

| Piece | File | Notes |
|---|---|---|
| Relay engine | `app/src/main/java/com/kobildn/agora/Bridge.kt` | Kotlin port of the extension's `background.js` — forwarding, labels/intro, mutual stop, voice commands, dedupe, turn caps, interject routing |
| DOM logic | `app/src/main/assets/site-inject.js` | Port of `content.js`, injected into each WebView on page load; talks to Kotlin via the `AgoraNative` JS interface |
| App shell | `app/src/main/java/com/kobildn/agora/MainActivity.kt` | Two WebViews (desktop UA, persistent cookies, JS injection), tab switching, interject bar |

## Known caveats (v0.1)

- **Mobile DOM is the big unknown.** The selectors in `site-inject.js` were derived against the **desktop** sites. This app forces a desktop user-agent to get that DOM, but the sites may still serve mobile-ish layouts or behave differently in WebView. **This first build is the test** of whether capture/injection works on the phone at all — if a panel doesn't send/capture, that finding goes to #21. The `window.__agoraSnapshot()` helper (callable from a `chrome://inspect` remote DevTools session) reports what actually resolved.
- **Android background throttling**: a long AI-to-AI conversation needs the app foregrounded; Android freezes/throttles backgrounded WebViews. No foreground service yet.
- **Two panels on a phone** is cramped, so this uses **tab switching** (DeepSeek / Claude / Log) rather than side-by-side. The relay runs regardless of which tab is visible.
- Debug build only — unsigned for release, no auto-update.

## Building locally (optional)

Open `agora-android/` in Android Studio (it provisions the Gradle wrapper + SDK automatically), or with a local Android SDK + Gradle 8.9:

```bash
cd agora-android
gradle assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk
```
