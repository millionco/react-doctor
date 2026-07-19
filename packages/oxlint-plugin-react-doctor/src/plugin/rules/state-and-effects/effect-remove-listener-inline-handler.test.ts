import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectRemoveListenerInlineHandler } from "./effect-remove-listener-inline-handler.js";

describe("effect-remove-listener-inline-handler", () => {
  it("flags removeEventListener with an inline arrow handler", () => {
    const result = runRule(
      effectRemoveListenerInlineHandler,
      `el.removeEventListener('scroll', () => handle());`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags removeEventListener with an inline function expression", () => {
    const result = runRule(
      effectRemoveListenerInlineHandler,
      `window.removeEventListener('resize', function () { onResize(); });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags removeEventListener with a .bind() handler", () => {
    const result = runRule(
      effectRemoveListenerInlineHandler,
      `node.removeEventListener('click', this.handle.bind(this));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags emitter.off with an inline arrow handler", () => {
    const result = runRule(
      effectRemoveListenerInlineHandler,
      `emitter.on('data', handler); emitter.off('data', (d) => process(d));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag two-arg unsubscribe since the second arg may be a completion callback", () => {
    const result = runRule(
      effectRemoveListenerInlineHandler,
      `appEvent.unsubscribe('update', (e) => handle(e));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag mqtt-style unsubscribe with an inline ack callback", () => {
    const result = runRule(
      effectRemoveListenerInlineHandler,
      `client.unsubscribe('presence/room', (err) => { if (err) console.error(err); });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag removeEventListener with a stable identifier handler", () => {
    const result = runRule(
      effectRemoveListenerInlineHandler,
      `window.removeEventListener('resize', onResize);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag removeEventListener with a member-expression handler", () => {
    const result = runRule(
      effectRemoveListenerInlineHandler,
      `el.removeEventListener('scroll', handlerRef.current);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag addEventListener with an inline arrow handler", () => {
    const result = runRule(
      effectRemoveListenerInlineHandler,
      `window.addEventListener('resize', () => onResize(), { once: true });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag removeEventListener with a factory call result", () => {
    const result = runRule(
      effectRemoveListenerInlineHandler,
      `el.removeEventListener('scroll', makeHandler());`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a single-arg unsubscribe idiom", () => {
    const result = runRule(effectRemoveListenerInlineHandler, `store.unsubscribe(() => sync());`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag computed removal member access", () => {
    const result = runRule(
      effectRemoveListenerInlineHandler,
      `el[removeName]('scroll', () => handle());`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on a device API off(duration, completionCallback)", () => {
    const result = runRule(
      effectRemoveListenerInlineHandler,
      `const LampPreview = ({ light }: LampPreviewProps) => {
  const [isPreviewing, setIsPreviewing] = useState(false);

  useEffect(() => {
    light.on(0, () => setIsPreviewing(true));
    return () => {
      light.off(FADE_DURATION_MS, (error: Error | null) => {
        if (error) console.error("failed to power down preview lamp", error);
      });
    };
  }, [light]);

  return <LampIndicator active={isPreviewing} />;
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags off() with a string event name and inline handler", () => {
    const result = runRule(
      effectRemoveListenerInlineHandler,
      `useEffect(() => {
         emitter.on("change", handleChange);
         return () => emitter.off("change", () => handleChange());
       }, []);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags off() when matching expressionless template event names", () => {
    const result = runRule(
      effectRemoveListenerInlineHandler,
      "emitter.on(`change`, handleChange); emitter.off(`change`, () => handleChange());",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags off() after matching addListener() and once() registrations", () => {
    const result = runRule(
      effectRemoveListenerInlineHandler,
      `emitter.addListener("change", handleChange);
       emitter.off("change", () => handleChange());
       emitter.once("close", handleClose);
       emitter.off("close", () => handleClose());`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not match registrations on a shadowed receiver binding", () => {
    const result = runRule(
      effectRemoveListenerInlineHandler,
      `function register(emitter) { emitter.on("change", handleChange); }
       function cleanup(emitter) { emitter.off("change", () => handleChange()); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("carries the test-noise tag so unit tests asserting off() tolerance are pipeline-skipped", () => {
    expect(effectRemoveListenerInlineHandler.tags).toContain("test-noise");
  });

  it("flags a fresh bind reached through a static computed member", () => {
    const freshBind = runRule(
      effectRemoveListenerInlineHandler,
      `window.removeEventListener("resize", handleResize["bind"](this));`,
    );
    const matchingReference = runRule(
      effectRemoveListenerInlineHandler,
      `window.removeEventListener("resize", handleResize);`,
    );
    const wrongMethod = runRule(
      effectRemoveListenerInlineHandler,
      `window.removeEventListener("resize", handleResize["call"](this));`,
    );
    expect(freshBind.diagnostics).toHaveLength(1);
    expect(matchingReference.diagnostics).toHaveLength(0);
    expect(wrongMethod.diagnostics).toHaveLength(0);
  });
});
