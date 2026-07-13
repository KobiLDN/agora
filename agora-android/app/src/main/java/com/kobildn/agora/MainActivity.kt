package com.kobildn.agora

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.Spinner
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : AppCompatActivity() {

    private lateinit var webDeepSeek: WebView
    private lateinit var webClaude: WebView
    private lateinit var logScroll: android.widget.ScrollView
    private lateinit var logText: TextView
    private lateinit var bridgeButton: Button
    private lateinit var title: TextView
    private lateinit var interjectInput: EditText
    private lateinit var targetSpinner: Spinner

    private lateinit var bridge: Bridge

    // whether each panel has finished its first load (so injection is safe)
    private val siteReady = hashMapOf("DeepSeek" to false, "Claude" to false)
    private val timeFmt = SimpleDateFormat("HH:mm:ss", Locale.getDefault())

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webDeepSeek = findViewById(R.id.webDeepSeek)
        webClaude = findViewById(R.id.webClaude)
        logScroll = findViewById(R.id.logScroll)
        logText = findViewById(R.id.logText)
        bridgeButton = findViewById(R.id.bridgeButton)
        title = findViewById(R.id.title)
        interjectInput = findViewById(R.id.interjectInput)
        targetSpinner = findViewById(R.id.targetSpinner)

        bridge = Bridge(
            sendToSite = { site, text -> injectIntoSite(site, text) },
            onStateChanged = { runOnUiThread { renderState() } }
        )

        setupSpinner()
        setupWebView(webDeepSeek, "DeepSeek", "https://chat.deepseek.com")
        setupWebView(webClaude, "Claude", "https://claude.ai")

        findViewById<Button>(R.id.tabDeepSeek).setOnClickListener { showTab("DeepSeek") }
        findViewById<Button>(R.id.tabClaude).setOnClickListener { showTab("Claude") }
        findViewById<Button>(R.id.tabLog).setOnClickListener { showTab("Log") }

        bridgeButton.setOnClickListener { bridge.toggleBridge() }
        findViewById<Button>(R.id.sendButton).setOnClickListener { sendInterject() }

        CookieManager.getInstance().setAcceptCookie(true)
        renderState()
    }

    private fun setupSpinner() {
        val options = listOf("→ Claude", "→ DeepSeek", "→ Both")
        val adapter = ArrayAdapter(this, android.R.layout.simple_spinner_item, options)
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        targetSpinner.adapter = adapter
    }

    private fun selectedTarget(): String = when (targetSpinner.selectedItemPosition) {
        1 -> "DeepSeek"
        2 -> "Both"
        else -> "Claude"
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView(web: WebView, site: String, url: String) {
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            // desktop UA gives us the DOM the selectors were written against;
            // mobile layouts differ enough to break capture/injection
            userAgentString = userAgentString.replace("; wv", "") +
                " AgoraBridge"
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)

        web.addJavascriptInterface(SiteInterface(site), "AgoraNative")

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                // keep navigation inside the WebView (don't punt to a browser)
                return false
            }

            override fun onPageFinished(view: WebView?, pageUrl: String?) {
                siteReady[site] = true
                injectSiteScript(web, site)
            }
        }
        web.loadUrl(url)
    }

    private fun injectSiteScript(web: WebView, site: String) {
        val script = try {
            assets.open("site-inject.js").bufferedReader().use { it.readText() }
        } catch (e: Exception) {
            return
        }
        val wrapped = "window.__AGORA_SITE__ = ${jsString(site)};\n$script"
        web.evaluateJavascript(wrapped, null)
    }

    private fun injectIntoSite(site: String, text: String): Boolean {
        val web = webForSite(site) ?: return false
        if (siteReady[site] != true) return false
        runOnUiThread {
            web.evaluateJavascript("window.__agoraInject && window.__agoraInject(${jsString(text)});", null)
        }
        return true
    }

    private fun webForSite(site: String): WebView? = when (site) {
        "DeepSeek" -> webDeepSeek
        "Claude" -> webClaude
        else -> null
    }

    private fun sendInterject() {
        val text = interjectInput.text.toString().trim()
        if (text.isEmpty()) return
        interjectInput.setText("")
        bridge.handleUserMessage(text, selectedTarget())
    }

    private fun showTab(which: String) {
        webDeepSeek.visibility = if (which == "DeepSeek") WebView.VISIBLE else WebView.GONE
        webClaude.visibility = if (which == "Claude") WebView.VISIBLE else WebView.GONE
        logScroll.visibility = if (which == "Log") android.view.View.VISIBLE else android.view.View.GONE
    }

    private fun renderState() {
        bridgeButton.text = if (bridge.bridgeActive) "Stop" else "Start"
        bridgeButton.backgroundTintList =
            android.content.res.ColorStateList.valueOf(
                if (bridge.bridgeActive) 0xFFDC3545.toInt() else 0xFF4A6CF7.toInt()
            )
        title.text = if (bridge.bridgeActive) "🏛️ Agora • On" else "🏛️ Agora"

        val sb = StringBuilder()
        for (e in bridge.log) {
            sb.append("[").append(timeFmt.format(Date(e.timestamp))).append("] ")
                .append(e.sender).append(": ").append(e.message).append("\n\n")
        }
        logText.text = sb.toString()
        logScroll.post { logScroll.fullScroll(android.view.View.FOCUS_DOWN) }
    }

    /** JS-safe string literal (handles quotes, newlines, unicode). */
    private fun jsString(s: String): String {
        val sb = StringBuilder("\"")
        for (c in s) {
            when (c) {
                '\\' -> sb.append("\\\\")
                '"' -> sb.append("\\\"")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                '\u2028' -> sb.append("\\u2028")
                '\u2029' -> sb.append("\\u2029")
                else -> sb.append(c)
            }
        }
        sb.append("\"")
        return sb.toString()
    }

    /** Bridge object exposed to the injected JS as `AgoraNative`. */
    inner class SiteInterface(private val site: String) {
        @JavascriptInterface
        fun onMessage(sender: String, message: String) {
            runOnUiThread { bridge.handleNewMessage(sender, message) }
        }

        @JavascriptInterface
        fun onSelectorError(what: String) {
            runOnUiThread {
                bridge.addLogEntry("System", "⚠️ Could not find $what on $site — its UI may have changed.")
            }
        }
    }

    override fun onBackPressed() {
        // let the visible panel go back through its own history first
        when {
            webDeepSeek.visibility == WebView.VISIBLE && webDeepSeek.canGoBack() -> webDeepSeek.goBack()
            webClaude.visibility == WebView.VISIBLE && webClaude.canGoBack() -> webClaude.goBack()
            else -> super.onBackPressed()
        }
    }
}
