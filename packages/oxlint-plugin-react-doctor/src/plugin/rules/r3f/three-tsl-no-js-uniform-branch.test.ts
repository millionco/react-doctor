import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeTslNoJsUniformBranch } from "./three-tsl-no-js-uniform-branch.js";

describe("three-tsl-no-js-uniform-branch", () => {
  it.each([
    `import { Fn, uniform } from "three/tsl"; const enabled = uniform(true); const shader = Fn(() => { if (enabled.value) return color(1); return color(0); });`,
    `import * as TSL from "three/tsl"; const strength = TSL.uniform(1); const value = strength.value; const shader = TSL.Fn(() => value > 0 ? color(1) : color(0));`,
  ])("flags JavaScript control flow over TSL uniform values", (code) => {
    expect(runRule(threeTslNoJsUniformBranch, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { Fn, uniform, If } from "three/tsl"; const enabled = uniform(true); const shader = Fn(() => If(enabled, () => color(1)));`,
    `import { uniform } from "three/tsl"; const enabled = uniform(true); if (enabled.value) updateUi();`,
    `import { Fn, uniform } from "other"; const enabled = uniform(true); Fn(() => { if (enabled.value) update(); });`,
    `import { Fn } from "three/tsl"; Fn(() => { if (settings.value) update(); });`,
  ])("allows TSL control flow, CPU reads outside Fn, and unproven values", (code) => {
    expect(runRule(threeTslNoJsUniformBranch, code).diagnostics).toHaveLength(0);
  });
});
