package com.kry.zjuenglish;

public final class SpeechController {
    public interface Engine {
        void initialize(Listener listener);
        boolean speak(Request request);
        void stop();
        void shutdown();
    }
    public interface Listener {
        void initialized(boolean success, String message);
        void started(String id);
        void finished(String id);
        void failed(String id, String message);
    }
    public interface Events { void status(String id, String state, String message); }
    public static final class Request {
        public final String id, text, accent;
        public final double rate, volume;
        public Request(String id, String text, double rate, double volume, String accent) {
            this.id = id; this.text = text == null ? "" : text.trim();
            this.rate = rate; this.volume = volume; this.accent = accent;
        }
    }

    private final Engine engine;
    private final Events events;
    private Request current;
    private boolean ready, initializing, closed;
    private int generation, retries;

    public SpeechController(Engine engine, Events events) { this.engine = engine; this.events = events; }
    public void warmUp() { if (!closed && !ready && !initializing) initialize(); }
    public void request(Request request) {
        if (closed) { events.status(request.id, "error", "朗读服务已关闭，请重新打开应用"); return; }
        if (request.text.isEmpty()) { events.status(request.id, "error", "没有可朗读的英文内容"); return; }
        if (request.volume <= 0) { events.status(request.id, "error", "应用朗读音量为 0，请在设置中调高音量"); return; }
        cancel();
        current = request; retries = 0;
        if (ready) play();
        else {
            events.status(request.id, "waiting", "正在准备英语语音，准备好后自动播放…");
            if (!initializing) initialize();
        }
    }
    public void cancel() {
        if (current != null) {
            String id = current.id; current = null;
            events.status(id, "stopped", "");
        }
        engine.stop();
    }
    public void refresh() { if (!closed) { ready = false; initialize(); } }
    public void close() {
        cancel(); closed = true; ready = false; initializing = false; generation++;
        engine.shutdown();
    }
    private boolean matches(String id) { return current != null && current.id.equals(id); }
    private void initialize() {
        ready = false; initializing = true;
        final int token = ++generation;
        engine.initialize(new Listener() {
            public void initialized(boolean success, String message) {
                if (closed || token != generation) return;
                initializing = false; ready = success;
                if (success) play(); else fail(message);
            }
            public void started(String id) {
                if (!closed && token == generation && matches(id)) events.status(id, "started", "正在朗读…");
            }
            public void finished(String id) {
                if (!closed && token == generation && matches(id)) {
                    current = null; events.status(id, "done", "");
                }
            }
            public void failed(String id, String message) {
                if (!closed && token == generation && matches(id)) retry(message);
            }
        });
    }
    private void play() {
        if (!ready || current == null || closed) return;
        try {
            if (!engine.speak(current)) retry("语音引擎未接受播放请求，请检查英语语音包");
        } catch (RuntimeException error) {
            retry(error.getMessage() == null ? "语音引擎发生错误" : error.getMessage());
        }
    }
    private void retry(String message) {
        if (current == null) return;
        if (retries++ == 0) {
            events.status(current.id, "waiting", "正在重新连接语音引擎并重试…");
            initialize();
        } else fail(message);
    }
    private void fail(String message) {
        if (current == null) return;
        String id = current.id; current = null;
        events.status(id, "error", message == null || message.isEmpty() ? "英语朗读不可用，请检查系统语音设置" : message);
    }
}
