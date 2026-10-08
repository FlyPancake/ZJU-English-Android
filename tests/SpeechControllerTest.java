import com.kry.zjuenglish.SpeechController;
import java.util.ArrayList;
import java.util.List;

public final class SpeechControllerTest {
    private static int checks;
    private static void check(boolean condition, String message) { checks++; if (!condition) throw new AssertionError(message); }
    private static SpeechController.Request request(String id) { return new SpeechController.Request(id, " hello ", 0.85, 1, "US"); }
    private static final class FakeEngine implements SpeechController.Engine {
        SpeechController.Listener listener;
        int initializations, stops, shutdowns;
        boolean accepted = true;
        String failure;
        final List<SpeechController.Request> played = new ArrayList<>();
        public void initialize(SpeechController.Listener observer) { initializations++; listener = observer; }
        public boolean speak(SpeechController.Request request) {
            played.add(request); if (failure != null) throw new IllegalStateException(failure); return accepted;
        }
        public void stop() { stops++; }
        public void shutdown() { shutdowns++; }
    }
    private static final class Recorder implements SpeechController.Events {
        final List<String> events = new ArrayList<>();
        String lastMessage;
        public void status(String id, String state, String message) { events.add(id + ":" + state); lastMessage = message; }
        boolean has(String value) { return events.contains(value); }
    }
    public static void main(String[] arguments) {
        FakeEngine engine = new FakeEngine(); Recorder events = new Recorder();
        SpeechController controller = new SpeechController(engine, events);
        controller.warmUp(); controller.request(request("first"));
        check(engine.initializations == 1 && engine.played.isEmpty(), "request must wait without duplicate initialization");
        engine.listener.initialized(true, "");
        check(engine.played.size() == 1 && engine.played.get(0).id.equals("first"), "first click must play after initialization");
        check(engine.played.get(0).text.equals("hello"), "text is trimmed");
        engine.listener.started("first"); engine.listener.finished("first");
        check(events.has("first:started") && events.has("first:done"), "actual playback status must be reported");
        controller.request(request("repeat"));
        check(engine.played.size() == 2 && engine.initializations == 1, "manual repeat must work without reinitializing");

        engine = new FakeEngine(); events = new Recorder(); controller = new SpeechController(engine, events);
        controller.request(request("old")); controller.request(request("latest"));
        engine.listener.initialized(true, "");
        check(engine.played.size() == 1 && engine.played.get(0).id.equals("latest"), "only the latest waiting request may play");
        check(events.has("old:stopped"), "replaced request gets cancellation");
        engine.listener.started("old"); check(!events.has("old:started"), "stale utterance callback is ignored");

        engine = new FakeEngine(); events = new Recorder(); controller = new SpeechController(engine, events);
        controller.request(request("cancelled")); controller.cancel(); engine.listener.initialized(true, "");
        check(engine.played.isEmpty(), "pause must cancel deferred playback");
        controller.request(request("afterPause")); check(engine.played.size() == 1, "manual click after cancellation works");

        engine = new FakeEngine(); events = new Recorder(); controller = new SpeechController(engine, events);
        controller.request(request("failedInit")); engine.listener.initialized(false, "engine unavailable");
        check(events.has("failedInit:error"), "initialization failure is visible");
        controller.request(request("recover")); engine.listener.initialized(true, "");
        check(engine.initializations == 2 && engine.played.size() == 1, "later clicks recover initialization");

        engine = new FakeEngine(); events = new Recorder(); controller = new SpeechController(engine, events);
        engine.accepted = false; controller.request(request("rejected")); engine.listener.initialized(true, "");
        check(engine.initializations == 2 && events.has("rejected:waiting"), "rejected playback retries once");
        engine.listener.initialized(true, "");
        check(engine.initializations == 2 && events.has("rejected:error"), "second rejection stops and reports failure");

        engine = new FakeEngine(); events = new Recorder(); controller = new SpeechController(engine, events);
        controller.request(request("callbackFailure")); engine.listener.initialized(true, "");
        SpeechController.Listener stale = engine.listener;
        stale.failed("callbackFailure", "network failure");
        check(engine.initializations == 2, "runtime callback failure reconnects once");
        stale.finished("callbackFailure"); check(!events.has("callbackFailure:done"), "old engine cannot complete a retried request");
        engine.listener.initialized(true, ""); engine.listener.failed("callbackFailure", "voice missing");
        check(events.has("callbackFailure:error") && events.lastMessage.equals("voice missing"), "final error retains actionable message");

        engine = new FakeEngine(); events = new Recorder(); controller = new SpeechController(engine, events);
        controller.request(new SpeechController.Request("silent", "hello", 1, 0, "US"));
        check(events.has("silent:error") && engine.initializations == 0, "zero app volume is explicit, not silent playback");
        controller.request(request("settings")); engine.listener.initialized(true, ""); controller.cancel(); controller.refresh();
        check(engine.initializations == 2, "return from settings refreshes the engine");
        controller.request(request("newVoice")); engine.listener.initialized(true, "");
        check(engine.played.get(engine.played.size() - 1).id.equals("newVoice"), "new voice settings accept playback");
        stale = engine.listener; controller.close(); stale.started("newVoice");
        check(!events.has("newVoice:started") && engine.shutdowns == 1, "destroyed controller ignores late callbacks");
        controller.request(request("closed")); check(events.has("closed:error"), "closed controller gives explicit feedback");
        System.out.println("PASS: " + checks + " native speech coordinator assertions");
    }
}
