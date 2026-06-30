import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { advancedEventHandlerRefs } from "./advanced-event-handler-refs.js";

describe("advanced-event-handler-refs — regressions", () => {
  it("stays silent when the handler has a stable useCallback identity", () => {
    const result = runRule(
      advancedEventHandlerRefs,
      `function C() {
        const onResize = useCallback(() => {}, []);
        useEffect(() => {
          window.addEventListener('resize', onResize);
          return () => window.removeEventListener('resize', onResize);
        }, [onResize]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when another dep is itself the subscription target", () => {
    const result = runRule(
      advancedEventHandlerRefs,
      `function C({ onMessage, socket }) {
        useEffect(() => {
          socket.on('message', onMessage);
          return () => socket.off('message', onMessage);
        }, [onMessage, socket]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a fresh unstable handler with no other deps", () => {
    const result = runRule(
      advancedEventHandlerRefs,
      `function C({ onResize }) {
        useEffect(() => {
          window.addEventListener('resize', onResize);
          return () => window.removeEventListener('resize', onResize);
        }, [onResize]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
