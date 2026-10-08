package com.kry.zjuenglish;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import java.util.Locale;
import java.util.Set;

public final class AndroidSpeechEngine implements SpeechController.Engine {
    private final Context context;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private TextToSpeech speech;
    private Runnable timeout;
    private Runnable playbackTimeout;
    private SpeechController.Listener listener;
    private String activeRequestId;
    private int generation;
    private String selectedAccent;

    public AndroidSpeechEngine(Context context) { this.context = context; }
    public void initialize(final SpeechController.Listener listener) {
        shutdown();
        final int token = generation;
        this.listener = listener;
        final boolean[] completed = {false};
        timeout = () -> {
            if (token == generation && !completed[0]) {
                completed[0] = true;
                listener.initialized(false, "语音引擎启动超时，请检查系统文字转语音设置后重试");
            }
        };
        handler.postDelayed(timeout, 10000);
        try {
            speech = new TextToSpeech(context, status -> handler.post(() -> {
                if (token != generation || completed[0]) return;
                completed[0] = true; handler.removeCallbacks(timeout);
                if (status != TextToSpeech.SUCCESS || speech == null) {
                    listener.initialized(false, "无法启动系统语音引擎，请选择可用引擎并安装英语语音包"); return;
                }
                try {
                speech.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
                speech.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String id) { handler.post(() -> { if (token != generation) return; clearPlaybackTimeout(id); listener.started(id); }); }
                    @Override public void onDone(String id) { handler.post(() -> { if (token != generation) return; clearPlaybackTimeout(id); listener.finished(id); }); }
                    @Override public void onError(String id) { handler.post(() -> { if (token != generation) return; clearPlaybackTimeout(id); listener.failed(id, "朗读失败，请检查英语语音包或网络连接"); }); }
                    @Override public void onError(String id, int code) {
                        handler.post(() -> { if (token != generation) return; clearPlaybackTimeout(id); listener.failed(id, "朗读失败（" + code + "），请检查英语语音包、网络连接和系统语音设置"); });
                    }
                });
                listener.initialized(true, "");
                } catch (RuntimeException error) { listener.initialized(false, "语音引擎配置失败：" + error.getMessage()); }
            }));
        } catch (RuntimeException error) {
            completed[0] = true; handler.removeCallbacks(timeout);
            listener.initialized(false, "无法连接语音引擎：" + error.getMessage());
        }
    }
    private void selectVoice(String accent) {
        if (accent.equals(selectedAccent)) return;
        Locale preferred = "UK".equals(accent) ? Locale.UK : Locale.US;
        int result = speech.setLanguage(preferred);
        if (result < 0) result = speech.setLanguage(Locale.US);
        if (result < 0) result = speech.setLanguage(Locale.ENGLISH);
        Set<Voice> voices = speech.getVoices();
        if (voices != null) {
            Voice chosen = null;
            for (Voice voice : voices) {
                if (voice == null || voice.getLocale() == null || !"en".equals(voice.getLocale().getLanguage()) ||
                    (voice.getFeatures() != null && voice.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED))) continue;
                if (chosen == null || score(voice, preferred) > score(chosen, preferred)) chosen = voice;
            }
            if (chosen != null && speech.setVoice(chosen) == TextToSpeech.SUCCESS) result = TextToSpeech.LANG_AVAILABLE;
        }
        if (result < 0) throw new IllegalStateException("当前引擎没有可用的英语语音，请在系统文字转语音设置中安装英语语音包");
        selectedAccent = accent;
    }
    private int score(Voice voice, Locale preferred) {
        return (voice.isNetworkConnectionRequired() ? 0 : 10) + (voice.getLocale().getCountry().equals(preferred.getCountry()) ? 2 : 0);
    }
    public boolean speak(SpeechController.Request request) {
        if (speech == null) return false;
        AudioManager audio = (AudioManager)context.getSystemService(Context.AUDIO_SERVICE);
        if (audio != null && audio.getStreamVolume(AudioManager.STREAM_MUSIC) == 0)
            throw new IllegalStateException("系统媒体音量为 0，请按手机音量键调高媒体音量");
        selectVoice("UK".equals(request.accent) ? "UK" : "US");
        if (speech.setSpeechRate((float)Math.max(0.3, Math.min(2.0, request.rate))) == TextToSpeech.ERROR) return false;
        Bundle params = new Bundle();
        params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, (float)Math.max(0, Math.min(1, request.volume)));
        activeRequestId = request.id;
        boolean accepted = speech.speak(request.text, TextToSpeech.QUEUE_FLUSH, params, request.id) == TextToSpeech.SUCCESS;
        if (accepted) {
            final SpeechController.Listener observer = listener;
            final int token = generation;
            playbackTimeout = () -> {
                if (token == generation && request.id.equals(activeRequestId)) {
                    activeRequestId = null;
                    observer.failed(request.id, "语音引擎没有开始播放，请检查英语语音包并重试");
                }
            };
            handler.postDelayed(playbackTimeout, 8000);
        }
        return accepted;
    }
    private void clearPlaybackTimeout(String id) {
        if (id.equals(activeRequestId)) { if (playbackTimeout != null) handler.removeCallbacks(playbackTimeout); activeRequestId = null; }
    }
    public void stop() {
        if (playbackTimeout != null) handler.removeCallbacks(playbackTimeout);
        activeRequestId = null;
        if (speech != null) { try { speech.stop(); } catch (RuntimeException ignored) {} }
    }
    public void shutdown() {
        generation++; selectedAccent = null;
        if (playbackTimeout != null) handler.removeCallbacks(playbackTimeout);
        activeRequestId = null; listener = null;
        if (timeout != null) handler.removeCallbacks(timeout);
        if (speech != null) {
            try { speech.stop(); speech.shutdown(); } catch (RuntimeException ignored) {}
            speech = null;
        }
    }
}
