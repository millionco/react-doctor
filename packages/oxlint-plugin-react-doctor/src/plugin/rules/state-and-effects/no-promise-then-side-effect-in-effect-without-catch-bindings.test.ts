import type { RuleDiagnostic } from "../../../test-utils/run-rule.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { attachSourceLocations } from "../../../test-utils/attach-source-locations.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { walkAst } from "../../utils/walk-ast.js";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { IMMEDIATE_IIFE_BINDING_CONTROLS } from "../../../test-utils/immediate-iife-proof/constants.js";
import { noPromiseThenSideEffectInEffectWithoutCatch } from "./no-promise-then-side-effect-in-effect-without-catch.js";

describe("immediate IIFE runtime bindings and providers", () => {
  for (const control of IMMEDIATE_IIFE_BINDING_CONTROLS) {
    it(control.name, () => {
      const result = runRule(noPromiseThenSideEffectInEffectWithoutCatch, control.code, {
        filename: "synthetic-iife.tsx",
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual(control.expectedDiagnostics);
    });
  }
});

describe("provider scopes after the host captures Program", () => {
  for (const control of IMMEDIATE_IIFE_BINDING_CONTROLS.filter(
    (control) =>
      control.name === "erased-global-object-alias" ||
      control.name === "erased-promise-alias" ||
      control.name === "runtime-global-object-companion" ||
      control.name === "runtime-promise-companion",
  )) {
    it(control.name, () => {
      const parsed = parseFixture(control.code, { filename: "synthetic-iife.tsx" });
      expect(parsed.errors).toEqual([]);
      attachParentReferences(parsed.program);
      attachSourceLocations(parsed.program, control.code);
      const diagnostics: RuleDiagnostic[] = [];
      const visitors = wrapWithSemanticContext(noPromiseThenSideEffectInEffectWithoutCatch).create({
        filename: "synthetic-iife.tsx",
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
        report: (descriptor) =>
          diagnostics.push({
            column: descriptor.node.loc?.start.column,
            line: descriptor.node.loc?.start.line,
            message: descriptor.message,
            nodeType: descriptor.node.type,
          }),
      });
      expect(visitors.Program).toBeDefined();
      walkAst(parsed.program, (node) => {
        const handler = visitors[node.type];
        if (typeof handler === "function") handler(node);
      });
      expect(diagnostics).toEqual(control.expectedDiagnostics);
    });
  }
});
