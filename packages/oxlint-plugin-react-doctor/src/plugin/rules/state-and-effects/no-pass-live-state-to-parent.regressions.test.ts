import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPassLiveStateToParent } from "./no-pass-live-state-to-parent.js";

describe("no-pass-live-state-to-parent — regressions", () => {
  it("stays silent when the prop is a pure transform consumed locally", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `function Price({ format }) {
        const [amount] = useState(0);
        const [display, setDisplay] = useState("");
        useEffect(() => { setDisplay(format(amount)); }, [amount]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a discarded prop callback that hands state to the parent", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `function Price({ onSync }) {
        const [amount, setAmount] = useState(0);
        useEffect(() => { onSync(amount); }, [amount]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
