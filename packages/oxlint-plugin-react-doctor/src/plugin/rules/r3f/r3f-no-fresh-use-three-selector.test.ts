import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoFreshUseThreeSelector } from "./r3f-no-fresh-use-three-selector.js";

describe("r3f-no-fresh-use-three-selector", () => {
  it("flags object and array selector results", () => {
    const result = runRule(
      r3fNoFreshUseThreeSelector,
      `import { useThree } from "@react-three/fiber"; const first = useThree((state) => ({ camera: state.camera })); const second = useThree((state) => [state.scene, state.camera]);`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows stable fields and explicit equality", () => {
    const result = runRule(
      r3fNoFreshUseThreeSelector,
      `import { useThree } from "@react-three/fiber"; const camera = useThree((state) => state.camera); const pair = useThree((state) => [state.camera], shallow);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores fresh returns inside nested selector callbacks", () => {
    const result = runRule(
      r3fNoFreshUseThreeSelector,
      `import { useThree } from "@react-three/fiber"; const camera = useThree((state) => { items.map((item) => { return { item }; }); function build() { return [state.scene]; } return state.camera; });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
