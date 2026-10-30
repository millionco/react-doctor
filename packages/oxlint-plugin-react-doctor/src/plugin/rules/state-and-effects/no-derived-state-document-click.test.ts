import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule, runRuleOnParsedFixture } from "../../../test-utils/run-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import { noDerivedState } from "./no-derived-state.js";
import { noDerivedStateEffect } from "./no-derived-state-effect.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";
import { noInitializeState } from "./no-initialize-state.js";
import fixtures from "./no-derived-state-document-click-fixtures.json";

const rules = [noDerivedState, noDerivedStateEffect, noAdjustStateOnPropChange, noInitializeState];

describe("finite native document click state", () => {
  it.each(fixtures)("$id", ({ source, counts }) => {
    for (const [ruleIndex, rule] of rules.entries()) {
      const result = runRule(rule, source, { filename: "src/panel.tsx" });
      expect(result.parseErrors, rule.id).toEqual([]);
      expect(result.diagnostics, rule.id).toHaveLength(counts[ruleIndex]);
    }
  });

  it.each(fixtures)("$id with range-only host positions", ({ source, counts }) => {
    const parsed = parseFixture(source, { filename: "src/panel.tsx" });
    attachParentReferences(parsed.program);
    walkAst(parsed.program, (node) => {
      Reflect.deleteProperty(node, "start");
      Reflect.deleteProperty(node, "end");
    });
    for (const [ruleIndex, rule] of rules.entries()) {
      const result = runRuleOnParsedFixture(rule, source, parsed, { filename: "src/panel.tsx" });
      expect(result.parseErrors, rule.id).toEqual([]);
      expect(result.diagnostics, rule.id).toHaveLength(counts[ruleIndex]);
    }
  });
});
