package com.cuyler.ironledger;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

/**
 * A packaged app has no browser history, so the system back gesture/button
 * finishes the Activity from any overlay — a back swipe with a modal open
 * would close the whole app. Ask the web app first; it returns true when it
 * handled the press (closed a modal, returned to the dashboard).
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must be registered BEFORE super.onCreate(), or the bridge never sees it
        // and Capacitor.Plugins.AppUpdater stays undefined in the web layer.
        registerPlugin(AppUpdaterPlugin.class);
        super.onCreate(savedInstanceState);

        // After an install or update the WebView's HTTP cache can still hold the
        // PREVIOUS build's JS, which makes a freshly updated app behave like the
        // old one (classically: it keeps re-offering the same update forever).
        // Spot the version change natively and serve this one launch straight
        // from the APK. Same-version launches keep normal caching.
        try {
            long installed = getPackageManager().getPackageInfo(getPackageName(), 0).versionCode;
            android.content.SharedPreferences prefs = getSharedPreferences("iron_ledger", MODE_PRIVATE);
            if (prefs.getLong("seenVersionCode", -1L) != installed) {
                prefs.edit().putLong("seenVersionCode", installed).apply();
                WebView wv = getBridge() != null ? getBridge().getWebView() : null;
                if (wv != null) {
                    wv.getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);
                    wv.clearCache(true);
                }
            }
        } catch (Exception ignore) {
            // never let cache bookkeeping stop the app from starting
        }

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView == null) {
                    fallThrough();
                    return;
                }
                // evaluateJavascript JSON-encodes its result, so a JS *string*
                // 'true' arrives as "\"true\"" — quotes included. Strip them
                // defensively before comparing, or back always falls through.
                webView.evaluateJavascript(
                    "(window.__back && window.__back()) === true",
                    value -> {
                        boolean handled = value != null && value.replace("\"", "").trim().equals("true");
                        if (!handled) fallThrough();
                    }
                );
            }

            private void fallThrough() {
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });
    }
}
