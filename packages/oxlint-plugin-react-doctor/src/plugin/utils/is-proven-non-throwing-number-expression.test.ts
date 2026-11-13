import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../test-utils/run-rule.js";
import { noRefCurrentInRender } from "../rules/state-and-effects/no-ref-current-in-render.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isProvenNonThrowingBuiltInCall } from "./is-proven-non-throwing-built-in-call.js";
import type { RuleContext } from "./rule-context.js";

const probe = {
  ...noRefCurrentInRender,
  create: (context: RuleContext) => ({
    CallExpression: (node: EsTreeNodeOfType<"CallExpression">) => {
      if (isProvenNonThrowingBuiltInCall(node, context.scopes))
        context.report({ node, message: "nonthrowing" });
    },
  }),
};

describe("nonthrowing numeric expression reuse", () => {
  it.each([
    ["Math.round(1 + 2);", 1],
    ["const value = 1; const alias = value; Math.round(alias);", 1],
    ["const { value = 1 } = supplied; Math.round(value);", 0],
    ["const [value = 1] = supplied; Math.round(value);", 0],
    ["const value = supplied; Math.round(value);", 0],
    ["let value = 1; value = supplied; Math.round(value);", 0],
    ["Math.round(Symbol());", 0],
  ])("proves actual numeric origins: %s", (source, expected) => {
    const result = runRule(probe, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });

  it("declines a long numeric alias chain at the shared resolution budget", () => {
    const source = Array.from(
      { length: 6000 },
      (_, index) => `const alias${index} = ${index ? `alias${index - 1}` : "1"};`,
    ).join("\n");
    const result = runRule(probe, `${source}\nMath.round(alias5999);`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
