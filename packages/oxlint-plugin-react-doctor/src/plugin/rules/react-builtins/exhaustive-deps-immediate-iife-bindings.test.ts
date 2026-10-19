import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { IMMEDIATE_IIFE_BINDING_CONTROLS } from "../../../test-utils/immediate-iife-proof/constants.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";

describe("stable hook results behind erased interfaces", () => {
  for (const control of IMMEDIATE_IIFE_BINDING_CONTROLS.filter(
    (control) => control.name === "erased-state-setter" || control.name === "erased-ref-binding",
  )) {
    it(control.name, () => {
      const result = runRule(exhaustiveDeps, control.code, {
        filename: "synthetic-iife.tsx",
        includeLocations: true,
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });
  }
});
