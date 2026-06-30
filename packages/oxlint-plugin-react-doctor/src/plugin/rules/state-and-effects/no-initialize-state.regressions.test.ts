import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noInitializeState } from "./no-initialize-state.js";

describe("no-initialize-state — regressions", () => {
  it("stays silent when a mount effect seeds a non-deterministic id", () => {
    const result = runRule(
      noInitializeState,
      `function C() {
        const [id, setId] = useState(null);
        useEffect(() => { setId(crypto.randomUUID()); }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for Math.random / Date.now seeds", () => {
    const result = runRule(
      noInitializeState,
      `function C() {
        const [seed, setSeed] = useState(0);
        const [at, setAt] = useState(0);
        useEffect(() => { setSeed(Math.random()); setAt(Date.now()); }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a deterministic literal init from a mount effect", () => {
    const result = runRule(
      noInitializeState,
      `function C() {
        const [n, setN] = useState(0);
        useEffect(() => { setN(42); }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
