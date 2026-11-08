package com.cuyler.ironledger;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;

/**
 * Self-update support.
 *
 * The installed version is read from the PackageManager, never from a constant
 * in the web bundle. If the app compared against a number baked into its own
 * assets it would keep believing it was the old build and re-offer the same
 * update forever.
 *
 * Downloading happens here rather than in JS so a multi-MB APK never has to
 * cross the bridge as base64, and so the install intent can be raised directly
 * against a FileProvider URI.
 *
 * It also writes data exports, because a WebView cannot download one.
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    @PluginMethod
    public void getAppInfo(PluginCall call) {
        try {
            PackageManager pm = getContext().getPackageManager();
            PackageInfo pi = pm.getPackageInfo(getContext().getPackageName(), 0);
            JSObject o = new JSObject();
            o.put("versionCode", Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : (long) pi.versionCode);
            o.put("versionName", pi.versionName);
            o.put("packageName", getContext().getPackageName());
            o.put("canInstall", canInstall());
            call.resolve(o);
        } catch (Exception e) {
            call.reject("cannot read package info: " + e.getMessage());
        }
    }

    /** Android 8+ gates "install unknown apps" behind a per-app user grant. */
    private boolean canInstall() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return getContext().getPackageManager().canRequestPackageInstalls();
        }
        return true;
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("cannot open settings: " + e.getMessage());
        }
    }

    @PluginMethod
    public void downloadAndInstall(final PluginCall call) {
        final String url = call.getString("url");
        final String want = call.getString("sha256", "");
        final String name = call.getString("fileName", "iron-ledger-update.apk");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        if (!canInstall()) {
            call.reject("NOT_ALLOWED_TO_INSTALL");
            return;
        }

        new Thread(new Runnable() {
            @Override
            public void run() {
                File out = null;
                try {
                    File dir = new File(getContext().getCacheDir(), "updates");
                    if (!dir.exists() && !dir.mkdirs()) {
                        call.reject("cannot create cache dir");
                        return;
                    }
                    out = new File(dir, name);
                    if (out.exists() && !out.delete()) {
                        call.reject("cannot replace previous download");
                        return;
                    }

                    HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                    conn.setInstanceFollowRedirects(true);
                    conn.setConnectTimeout(30000);
                    conn.setReadTimeout(60000);
                    conn.connect();

                    int code = conn.getResponseCode();
                    if (code < 200 || code >= 300) {
                        call.reject("download failed: HTTP " + code);
                        return;
                    }
                    long total = Build.VERSION.SDK_INT >= 24
                            ? conn.getContentLengthLong()
                            : (long) conn.getContentLength();

                    MessageDigest md = MessageDigest.getInstance("SHA-256");
                    long read = 0;
                    int lastPct = -1;
                    InputStream in = conn.getInputStream();
                    FileOutputStream fo = new FileOutputStream(out);
                    try {
                        byte[] buf = new byte[65536];
                        int n;
                        while ((n = in.read(buf)) > 0) {
                            fo.write(buf, 0, n);
                            md.update(buf, 0, n);
                            read += n;
                            if (total > 0) {
                                int pct = (int) (read * 100 / total);
                                if (pct != lastPct) {
                                    lastPct = pct;
                                    JSObject d = new JSObject();
                                    d.put("percent", pct);
                                    notifyListeners("downloadProgress", d);
                                }
                            }
                        }
                    } finally {
                        try { fo.flush(); } catch (Exception ignore) { }
                        try { fo.close(); } catch (Exception ignore) { }
                        try { in.close(); } catch (Exception ignore) { }
                    }

                    String got = toHex(md.digest());
                    if (want != null && !want.isEmpty() && !want.equalsIgnoreCase(got)) {
                        out.delete();
                        call.reject("checksum mismatch: expected " + want + ", got " + got);
                        return;
                    }

                    install(out);

                    JSObject res = new JSObject();
                    res.put("sha256", got);
                    res.put("bytes", read);
                    call.resolve(res);
                } catch (Exception e) {
                    if (out != null && out.exists()) out.delete();
                    call.reject("update failed: " + e.getMessage());
                }
            }
        }).start();
    }

    /**
     * Write an export to app-specific EXTERNAL storage and offer to send it away.
     *
     * An <a download> of a blob URL does nothing in a WebView: no download starts
     * and nothing here was registered to catch one, so the Export buttons looked
     * live and saved nothing. App-specific external storage needs no runtime
     * permission, is reachable over USB and by a file manager, and the share
     * chooser is the part that actually gets a backup off the phone.
     */
    @PluginMethod
    public void exportFile(PluginCall call) {
        String name = call.getString("name", "iron-ledger-export.json");
        String data = call.getString("data", "");
        String mime = call.getString("mime", "application/json");
        try {
            File dir = new File(getContext().getExternalFilesDir(null), "exports");
            if (!dir.exists() && !dir.mkdirs()) throw new Exception("could not create " + dir);
            // keep the name tame: it is used as a filename
            File out = new File(dir, name.replaceAll("[^A-Za-z0-9._-]", "_"));
            try (FileOutputStream fos = new FileOutputStream(out)) {
                fos.write(data.getBytes(StandardCharsets.UTF_8));
                fos.flush();
            }
            if (out.length() == 0) throw new Exception("wrote an empty file");

            Uri uri = FileProvider.getUriForFile(getContext(),
                    getContext().getPackageName() + ".fileprovider", out);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, "Save or send your backup");
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);

            JSObject res = new JSObject();
            res.put("path", out.getAbsolutePath());
            res.put("bytes", out.length());
            call.resolve(res);
        } catch (Exception e) {
            call.reject("export failed: " + e.getMessage());
        }
    }

    private void install(File apk) {
        // The manifest's FileProvider already exposes the cache dir, so the
        // downloaded APK can be handed to the system installer by URI.
        Uri uri = FileProvider.getUriForFile(getContext(),
                getContext().getPackageName() + ".fileprovider", apk);
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(uri, "application/vnd.android.package-archive");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
    }

    private static String toHex(byte[] b) {
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) sb.append(String.format(Locale.US, "%02x", x));
        return sb.toString();
    }
}
