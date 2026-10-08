package com.kry.zjuenglish;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.media.AudioManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import org.json.JSONObject;

public final class MainActivity extends Activity {
    private WebView web;
    private SpeechController speech;
    private boolean speechSettingsOpened;
    private String pendingExport;
    private static final String ORIGIN = "https://app.local/";

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(14, 20, 35));
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        setContentView(root);
        web.setBackgroundColor(Color.rgb(14, 20, 35));
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setMediaPlaybackRequiresUserGesture(false);
        web.addJavascriptInterface(new Bridge(), "Android");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !request.getUrl().toString().startsWith(ORIGIN);
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!"https".equals(uri.getScheme()) || !"app.local".equals(uri.getHost()))
                    return response("text/plain", new ByteArrayInputStream(new byte[0]));
                String path = uri.getPath();
                try {
                    if (path == null || path.contains("..")) throw new Exception("Invalid path");
                    if (path.equals("/background"))
                        return response(getPreferences(0).getString("backgroundMime", "image/jpeg"), new FileInputStream(new File(getFilesDir(), "background")));
                    if (path.equals("/")) path = "/index.html";
                    String mime = path.endsWith(".html") ? "text/html" : path.endsWith(".js") ? "application/javascript" :
                        path.endsWith(".css") ? "text/css" : path.endsWith(".json") ? "application/json" : "text/plain";
                    return response(mime, getAssets().open(path.substring(1)));
                } catch (Exception error) { return response("text/plain", new ByteArrayInputStream(new byte[0])); }
            }
        });
        setVolumeControlStream(AudioManager.STREAM_MUSIC);
        speech = new SpeechController(new AndroidSpeechEngine(this), (id, status, message) -> {
            try {
                JSONObject event = new JSONObject();
                event.put("id", id); event.put("state", status); event.put("message", message);
                callback("nativeSpeech", event.toString());
            } catch (Exception error) { Toast.makeText(this, "无法反馈朗读状态", Toast.LENGTH_SHORT).show(); }
        });
        speech.warmUp();
        web.loadUrl(ORIGIN);
    }

    private WebResourceResponse response(String mime, InputStream stream) { return new WebResourceResponse(mime, "UTF-8", stream); }
    private void callback(String function, String value) {
        runOnUiThread(() -> web.evaluateJavascript("window." + function + "(" + JSONObject.quote(value) + ")", null));
    }
    private String read(InputStream stream, int limit) throws Exception {
        try (InputStream input = stream; java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) {
                if (output.size() + count > limit) throw new Exception("文件过大");
                output.write(buffer, 0, count);
            }
            return output.toString("UTF-8");
        }
    }

    public final class Bridge {
        @JavascriptInterface public String load() {
            File file = new File(getFilesDir(), "state.json");
            if (!file.exists()) return "";
            try { return read(new FileInputStream(file), 32 * 1024 * 1024); }
            catch (Exception error) { return "{\"loadError\":true}"; }
        }
        @JavascriptInterface public boolean save(String json) {
            try {
                new JSONObject(json);
                File temp = new File(getFilesDir(), "state.tmp");
                try (FileOutputStream output = new FileOutputStream(temp)) {
                    output.write(json.getBytes(StandardCharsets.UTF_8));
                    output.getFD().sync();
                }
                android.system.Os.rename(temp.getAbsolutePath(), new File(getFilesDir(), "state.json").getAbsolutePath());
                return true;
            } catch (Exception error) { return false; }
        }
        @JavascriptInterface public void speak(String text, double rate, double volume, String accent, String requestId) {
            runOnUiThread(() -> speech.request(new SpeechController.Request(requestId, text, rate, volume, accent)));
        }
        @JavascriptInterface public void stopSpeech() { runOnUiThread(() -> speech.cancel()); }
        @JavascriptInterface public void exportBackup(String json) {
            pendingExport = json;
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.setType("application/json");
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.putExtra(Intent.EXTRA_TITLE, "Z-Android-" + new java.text.SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(new java.util.Date()) + ".json");
                startActivityForResult(intent, 1);
            });
        }
        @JavascriptInterface public void importFile(String type) {
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/json");
                if (type.equals("background")) {
                    intent.setType("*/*");
                    intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/*", "video/*"});
                } else if (type.equals("text")) intent.setType("*/*");
                startActivityForResult(intent, type.equals("background") ? 4 : type.equals("text") ? 3 : 2);
            });
        }
        @JavascriptInterface public String backgroundMime() { return getPreferences(0).getString("backgroundMime", ""); }
        @JavascriptInterface public void exit() { runOnUiThread(() -> finish()); }
        @JavascriptInterface public void ttsSettings() {
            runOnUiThread(() -> {
                speechSettingsOpened = true;
                try { startActivity(new Intent("com.android.settings.TTS_SETTINGS")); }
                catch (Exception error) { Toast.makeText(MainActivity.this, "请打开系统设置中的文字转语音", Toast.LENGTH_LONG).show(); }
            });
        }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (result != RESULT_OK || data == null || data.getData() == null) return;
        Uri uri = data.getData();
        new Thread(() -> {
            try {
                if (request == 1) {
                    try (OutputStream output = getContentResolver().openOutputStream(uri, "wt")) {
                        output.write(pendingExport.getBytes(StandardCharsets.UTF_8));
                    }
                    callback("nativeMessage", "备份已导出");
                } else if (request == 4) {
                    String mime = getContentResolver().getType(uri);
                    if (mime == null || !(mime.startsWith("image/") || mime.startsWith("video/"))) throw new Exception("请选择图片或视频");
                    File temporary = new File(getFilesDir(), "background.tmp");
                    try (InputStream input = getContentResolver().openInputStream(uri); OutputStream output = new FileOutputStream(temporary)) {
                        byte[] buffer = new byte[8192];
                        int count;
                        while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                    }
                    android.system.Os.rename(temporary.getAbsolutePath(), new File(getFilesDir(), "background").getAbsolutePath());
                    getPreferences(0).edit().putString("backgroundMime", mime).apply();
                    callback("nativeBackground", mime);
                } else callback(request == 3 ? "nativeCSV" : "nativeImport", read(getContentResolver().openInputStream(uri), 32 * 1024 * 1024));
            } catch (Exception error) { callback("nativeMessage", "操作失败：" + error.getMessage()); }
        }).start();
    }

    @Override protected void onPause() {
        web.evaluateJavascript("window.lifecyclePause && window.lifecyclePause()", null);
        web.onPause();
        if (speech != null) speech.cancel();
        super.onPause();
    }
    @Override protected void onResume() {
        super.onResume();
        if (web != null) {
            web.onResume();
            web.evaluateJavascript("window.lifecycleResume && window.lifecycleResume()", null);
        }
        if (speech != null && speechSettingsOpened) { speechSettingsOpened = false; speech.refresh(); }
    }
    @Override public void onBackPressed() { web.evaluateJavascript("window.back && window.back()", null); }
    @Override protected void onDestroy() {
        if (speech != null) speech.close();
        web.destroy();
        super.onDestroy();
    }
}
