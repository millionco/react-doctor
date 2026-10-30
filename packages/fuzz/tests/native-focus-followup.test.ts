import { readFileSync } from "node:fs";
import { expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../oxlint-plugin-react-doctor/src/test-utils/attach-parent-references.js";
import { parseFixture } from "../../oxlint-plugin-react-doctor/src/test-utils/parse-fixture.js";
import { runRule } from "../../oxlint-plugin-react-doctor/src/test-utils/run-rule.js";
import { clickEventsHaveKeyEvents } from "../../oxlint-plugin-react-doctor/src/plugin/rules/a11y/click-events-have-key-events.js";
import { noStaticElementInteractions } from "../../oxlint-plugin-react-doctor/src/plugin/rules/a11y/no-static-element-interactions.js";
import { analyzeScopes } from "../../oxlint-plugin-react-doctor/src/plugin/semantic/scope-analysis.js";
import type { EsTreeNode } from "../../oxlint-plugin-react-doctor/src/plugin/utils/es-tree-node.js";
import { isFocusForwardingOrBlockingHandlerExpression } from "../../oxlint-plugin-react-doctor/src/plugin/utils/is-focus-forwarding-handler.js";
import { isNodeOfType } from "../../oxlint-plugin-react-doctor/src/plugin/utils/is-node-of-type.js";
import { walkAst } from "../../oxlint-plugin-react-doctor/src/plugin/utils/walk-ast.js";

it("preserves the synthetic self-click native lookup fallback seed", () => {
  const code = readFileSync(
    new URL(
      "../corpus/regressions/native-focus-followup/click-events-have-key-events--self-click-native-lookup-fallback.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const parsed = parseFixture(code);
  expect(parsed.errors).toEqual([]);
  attachParentReferences(parsed.program);
  let handlerExpression: EsTreeNode | undefined;
  walkAst(parsed.program, (node) => {
    if (isNodeOfType(node, "JSXAttribute") && isNodeOfType(node.value, "JSXExpressionContainer"))
      handlerExpression = node.value.expression;
  });
  if (!handlerExpression) throw new Error("Expected the synthetic native focus handler");
  expect(
    isFocusForwardingOrBlockingHandlerExpression(handlerExpression, analyzeScopes(parsed.program)),
  ).toBe(true);
  for (const rule of [clickEventsHaveKeyEvents, noStaticElementInteractions]) {
    const result = runRule(rule, code, { filename: "native-focus-seed.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  }
});
