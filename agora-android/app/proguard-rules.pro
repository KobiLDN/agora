# Keep JavascriptInterface methods callable from injected JS
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
