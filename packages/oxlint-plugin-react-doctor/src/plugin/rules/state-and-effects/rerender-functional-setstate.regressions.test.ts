import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rerenderFunctionalSetstate } from "./rerender-functional-setstate.js";

describe("rerender-functional-setstate — regressions", () => {
  // A subscription handler registered inside an effect closes over the state
  // captured at registration; multiple events before the next re-subscribe all
  // read the same stale value (the canonical react.dev bug). Being listed in
  // the effect deps does NOT make it safe, so this must still fire.
  it("flags a deferred setter even when the read state is an effect dependency", () => {
    const result = runRule(
      rerenderFunctionalSetstate,
      `function C() {
        const [messages, setMessages] = useState([]);
        useEffect(() => {
          return subscribe((received) => setMessages([...messages, received]));
        }, [messages]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a deferred setter when the state is not in the effect deps", () => {
    const result = runRule(
      rerenderFunctionalSetstate,
      `function C() {
        const [count, setCount] = useState(0);
        useEffect(() => {
          const id = setInterval(() => setCount(count + 1), 1000);
          return () => clearInterval(id);
        }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
