import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnAnimationReactionAsDerived } from "./rn-animation-reaction-as-derived.js";

describe("react-native/rn-animation-reaction-as-derived — regressions", () => {
  it("stays silent on a locally-defined useAnimatedReaction", () => {
    const result = runRule(
      rnAnimationReactionAsDerived,
      `function useAnimatedReaction(prepare, react) {}
const C = () => { useAnimatedReaction(() => x.value, (cur) => { sv.value = cur; }); };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the assignment target is a ref member chain", () => {
    const result = runRule(
      rnAnimationReactionAsDerived,
      `import { useAnimatedReaction } from "react-native-reanimated";
const C = () => { useAnimatedReaction(() => x.value, (cur) => { plainRef.current.value = cur; }); };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a real reanimated shared-value copy", () => {
    const result = runRule(
      rnAnimationReactionAsDerived,
      `import { useAnimatedReaction } from "react-native-reanimated";
const C = () => { useAnimatedReaction(() => x.value, (cur) => { sv.value = cur; }); };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
