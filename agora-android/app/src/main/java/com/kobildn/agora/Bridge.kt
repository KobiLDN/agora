package com.kobildn.agora

import android.os.Handler
import android.os.Looper

/**
 * The relay engine — Kotlin port of the extension's background.js / the
 * desktop app's lib/bridge.js. Same behaviour: forwarding with turn delay,
 * sender labels + one-time intro, mutual [STOP_BRIDGE] detection, voice
 * commands, dedupe, turn caps, single-target interject routing.
 *
 * Host responsibilities (MainActivity):
 *  - sendToSite(site, text): inject text into that site's WebView, returns
 *    false if the panel isn't ready
 *  - onStateChanged(): re-render UI (log, bridge button)
 */
class Bridge(
    private val sendToSite: (String, String) -> Boolean,
    private val onStateChanged: () -> Unit
) {
    data class LogEntry(val sender: String, val message: String, val timestamp: Long)

    data class Settings(
        var turnDelay: Int = 3,
        var maxTurns: Int = 0,
        var labelMessages: Boolean = true,
        var interjectTarget: String = "Claude"
    )

    val settings = Settings()
    val log = ArrayList<LogEntry>()
    var bridgeActive = false
        private set

    private var turnCount = 0
    private val introSentTo = hashMapOf("DeepSeek" to false, "Claude" to false)
    private var lastStopSender: String? = null
    private var lastStopTime = 0L

    private val main = Handler(Looper.getMainLooper())

    companion object {
        const val STOP_TOKEN = "[STOP_BRIDGE]"
        const val STOP_WINDOW_MS = 3 * 60 * 1000L
        const val DEDUPE_WINDOW_MS = 60 * 1000L
        private val PAUSE_WORDS = setOf("stop", "pause", "halt")
        private val RESUME_WORDS = setOf("resume", "continue", "start")
    }

    private fun otherSite(name: String): String? = when (name) {
        "DeepSeek" -> "Claude"
        "Claude" -> "DeepSeek"
        else -> null
    }

    private fun detectCommand(text: String): String? {
        val words = text.lowercase().replace(Regex("[^\\w\\s]"), "").split(Regex("\\s+")).filter { it.isNotEmpty() }
        if (words.isEmpty() || words.size > 4) return null
        if (words.any { it in PAUSE_WORDS }) return "pause"
        if (words.any { it in RESUME_WORDS }) return "resume"
        return null
    }

    // Token must be the literal trailing content of the message — mentions
    // elsewhere never trigger (extension issue #18, three rounds of this).
    private fun endsWithStopToken(text: String): Boolean = text.trim().endsWith(STOP_TOKEN)

    fun addLogEntry(sender: String, message: String) {
        log.add(LogEntry(sender, message, System.currentTimeMillis()))
        if (log.size > 200) log.removeAt(0)
        onStateChanged()
    }

    fun toggleBridge() {
        bridgeActive = !bridgeActive
        turnCount = 0
        introSentTo["DeepSeek"] = false
        introSentTo["Claude"] = false
        lastStopSender = null
        onStateChanged()
    }

    fun clearLog() {
        log.clear()
        turnCount = 0
        onStateChanged()
    }

    private fun labelText(from: String, target: String, text: String): String {
        if (!settings.labelMessages) return text
        var intro = ""
        if (introSentTo[target] == false) {
            intro = "[Bridge notice: You are in a relayed conversation with another AI, $from. " +
                "Messages prefixed [$from] are written by that AI, not by a human. " +
                "A human moderator supervises and may interject; their messages are prefixed [Human]. " +
                "When you and the other AI have both independently reached a genuine natural " +
                "conclusion — not just a lull, and not proactively suggesting it end — end your " +
                "ENTIRE message with the literal token $STOP_TOKEN as the very last characters, " +
                "with nothing else after it. Merely mentioning the token elsewhere will NOT " +
                "trigger anything — only trailing use does. If you and the other AI are just " +
                "repeating \"agreed\" / \"nothing more to add\" with no new content, that " +
                "repetition IS the natural conclusion — use the token right then.]\n\n"
            introSentTo[target] = true
        }
        return "$intro[$from]: $text"
    }

    private fun checkMutualStop(sender: String, message: String): Boolean {
        if (!endsWithStopToken(message)) return false
        val now = System.currentTimeMillis()
        val prev = lastStopSender
        if (prev != null && prev != sender && (now - lastStopTime) < STOP_WINDOW_MS) {
            bridgeActive = false
            lastStopSender = null
            addLogEntry("System", "Bridge stopped — both AIs signaled agreement.")
            return true
        }
        lastStopSender = sender
        lastStopTime = now
        return false
    }

    /** An AI response captured by the injected site script. */
    fun handleNewMessage(sender: String, message: String) {
        val cutoff = System.currentTimeMillis() - DEDUPE_WINDOW_MS
        val duplicate = log.any { it.sender == sender && it.timestamp > cutoff && it.message == message }
        if (duplicate) return

        addLogEntry(sender, message)

        if (checkMutualStop(sender, message)) return
        if (!bridgeActive) return

        if (settings.maxTurns > 0 && turnCount >= settings.maxTurns) {
            bridgeActive = false
            addLogEntry("System", "Bridge paused after ${settings.maxTurns} turn${if (settings.maxTurns == 1) "" else "s"}.")
            return
        }

        val delayMs = (settings.turnDelay.coerceAtLeast(0)) * 1000L
        main.postDelayed({ forwardMessage(sender, message) }, delayMs)
    }

    private fun forwardMessage(sender: String, message: String) {
        if (!bridgeActive) return
        val target = otherSite(sender) ?: return
        turnCount++
        val delivered = sendToSite(target, labelText(sender, target, message))
        if (!delivered) {
            addLogEntry("System", "⚠️ Could not deliver to the $target panel — is it loaded?")
        }
        onStateChanged()
    }

    /**
     * User interjection → deliver to the chosen target only; the other AI
     * hears it through the normal relay path. Broadcasting to both spawns two
     * parallel reply chains (diagnosed by the bridged AIs themselves).
     */
    fun handleUserMessage(text: String, target: String) {
        addLogEntry("User", text)

        when (detectCommand(text)) {
            "pause" -> {
                bridgeActive = false
                addLogEntry("System", "Bridge paused by voice command.")
            }
            "resume" -> {
                bridgeActive = true
                turnCount = 0
                addLogEntry("System", "Bridge resumed by voice command.")
            }
        }

        val outgoing = if (settings.labelMessages) "[Human]: $text" else text
        val command = detectCommand(text)
        val resolved = if (command != null) "Both" else target
        val targets = if (resolved == "Both") listOf("DeepSeek", "Claude") else listOf(resolved)
        for (name in targets) sendToSite(name, outgoing)
    }

    /** Manual forward: hand the last captured response from one AI to the other. */
    fun forwardLast(from: String): String? {
        val entry = log.lastOrNull { it.sender == from } ?: return "No $from response found to forward."
        val target = otherSite(from) ?: return "Unknown source."
        val delivered = sendToSite(target, labelText(from, target, entry.message))
        if (!delivered) return "Could not deliver to the $target panel — is it loaded?"
        addLogEntry("System", "Manually forwarded last $from response to $target.")
        return null
    }
}
