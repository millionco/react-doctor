import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { renderingUsetransitionLoading } from "./rendering-usetransition-loading.js";

describe("performance/rendering-usetransition-loading — regressions", () => {
  it("stays silent when the loading flag tracks a promise chain", () => {
    const result = runRule(
      renderingUsetransitionLoading,
      `function C() { const [isLoading, setIsLoading] = useState(false); const load = () => { setIsLoading(true); loadData().then(() => setIsLoading(false)); }; return <button onClick={load}>{isLoading ? "..." : "go"}</button>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a synchronous loading-flag toggle", () => {
    const result = runRule(
      renderingUsetransitionLoading,
      `function C() { const [isLoading, setIsLoading] = useState(false); const toggle = () => { setIsLoading(true); }; return <button onClick={toggle}>{isLoading ? "..." : "go"}</button>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
