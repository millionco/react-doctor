import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoFreshUseThreeSelector } from "./r3f-no-fresh-use-three-selector.js";

describe("r3f-no-fresh-use-three-selector", () => {
  it("requires the selector overload introduced in R3F v6", () => {
    expect(r3fNoFreshUseThreeSelector.requires).toEqual(["r3f:6"]);
  });

  it("flags object and array selector results", () => {
    const result = runRule(
      r3fNoFreshUseThreeSelector,
      `import { useThree } from "@react-three/fiber"; const first = useThree((state) => ({ camera: state.camera })); const second = useThree((state) => [state.scene, state.camera]);`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags selector objects created through the global Object.create API", () => {
    const result = runRule(
      r3fNoFreshUseThreeSelector,
      `import { useThree } from "@react-three/fiber"; useThree((state) => Object.create({ camera: state.camera }));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps shadowed Object.create selector values quiet", () => {
    const result = runRule(
      r3fNoFreshUseThreeSelector,
      `import { useThree } from "@react-three/fiber"; const Scene = ({ Object }) => useThree((state) => Object.create(state.camera));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    `import { useThree } from "@react-three/fiber"; import { useCallback } from "react"; const selector = useCallback((state) => ({ camera: state.camera }), []); useThree(selector);`,
    `const { useThree } = require("@react-three/fiber"); const React = require("react"); const selector = React.useCallback((state) => [state.camera], []); useThree(selector);`,
    `const Fiber = require("@react-three/fiber"); const { useCallback: stabilize } = require("react"); Fiber.useThree(stabilize((state) => ({ scene: state.scene }), []));`,
    `import Fiber = require("@react-three/fiber"); import React = require("react"); Fiber.useThree(React.useCallback((state) => [state.scene], []));`,
    `import Fiber = require("@react-three/fiber"); import React = require("react"); import select = Fiber.useThree; import stabilize = React.useCallback; select(stabilize((state) => ({ camera: state.camera }), []));`,
  ])("flags fresh selectors wrapped by React useCallback", (code) => {
    const result = runRule(r3fNoFreshUseThreeSelector, code);
    expect(result.diagnostics).toHaveLength(1);
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

  it("ignores selectors wrapped by unrelated or shadowed useCallback implementations", () => {
    const result = runRule(
      r3fNoFreshUseThreeSelector,
      `import { useThree } from "@react-three/fiber"; import { useCallback } from "other-hooks"; const first = useCallback((state) => ({ camera: state.camera }), []); const Scene = (require) => { const React = require("react"); const second = React.useCallback((state) => [state.scene], []); useThree(second); }; useThree(first);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
