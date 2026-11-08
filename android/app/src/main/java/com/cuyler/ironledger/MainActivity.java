package com.cuyler.ironledger;

import android.os.Bundle;
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
        super.onCreate(savedInstanceState);

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
