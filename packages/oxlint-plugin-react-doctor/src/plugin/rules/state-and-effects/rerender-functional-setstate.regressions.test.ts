import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rerenderFunctionalSetstate } from "./rerender-functional-setstate.js";

describe("rerender-functional-setstate — regressions", () => {
  it("stays silent when the read state is a dependency of the enclosing effect", () => {
    const result = runRule(
      rerenderFunctionalSetstate,
      `function C() {
        const [count, setCount] = useState(0);
        useEffect(() => {
          const id = setInterval(() => setCount(count + 1), 1000);
          return () => clearInterval(id);
        }, [count]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
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
