import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnNoScrollState } from "./rn-no-scroll-state.js";

describe("react-native/rn-no-scroll-state — regressions", () => {
  it("stays silent on a guarded set-once latch reading the same state", () => {
    const result = runRule(
      rnNoScrollState,
      `const C = () => {
  const [hasScrolled, setHasScrolled] = useState(false);
  const onScroll = () => { if (!hasScrolled) setHasScrolled(true); };
  return <ScrollView onScroll={onScroll} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags unconditional per-frame setState", () => {
    const result = runRule(
      rnNoScrollState,
      `const C = () => {
  const [y, setY] = useState(0);
  const onScroll = (e) => { setY(e.nativeEvent.contentOffset.y); };
  return <ScrollView onScroll={onScroll} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
