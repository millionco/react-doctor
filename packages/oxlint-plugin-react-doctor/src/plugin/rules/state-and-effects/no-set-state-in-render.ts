import { defineRule } from "../../utils/define-rule.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { collectUseStateBindings } from "./utils/collect-use-state-bindings.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { walkInsideStatementBlocks } from "../../utils/walk-inside-statement-blocks.js";

// An UNCONDITIONAL setter call on a component's render path triggers an
// infinite re-render loop ("Maximum update depth exceeded"). We flag a
// setter call only when the CFG proves it runs on EVERY path from the
// component's entry to its exit (`isUnconditionalFromEntry`) — exactly the
// React Compiler's `validateNoSetStateInRender` (its `computeUnconditional
// Blocks` post-dominator chain). That precision is what lets us stay quiet
// on the canonical store-previous-render pattern, which is CONDITIONAL and
// reaches a fixed point (see
// https://react.dev/reference/react/useState#storing-information-from-previous-renders):
//
//   if (prevCount !== count) {
//     setPrevCount(count);  // ← guarded → not unconditional → not flagged
//   }
//
// `walkInsideStatementBlocks` keeps us in the component's own body (it stops
// at nested functions), so setters inside effects / event handlers / other
// callbacks — a separate CFG — are never considered render-path writes.
const findUnconditionalSetterCalls = (
  context: RuleContext,
  componentBody: EsTreeNode,
  setterNames: ReadonlySet<string>,
): EsTreeNodeOfType<"CallExpression">[] => {
  const calls: EsTreeNodeOfType<"CallExpression">[] = [];
  walkInsideStatementBlocks(componentBody, (child) => {
    if (!isNodeOfType(child, "CallExpression")) return;
    if (!isNodeOfType(child.callee, "Identifier")) return;
    if (!setterNames.has(child.callee.name)) return;
    if (!context.cfg.isUnconditionalFromEntry(child)) return;
    calls.push(child);
  });
  return calls;
};

export const noSetStateInRender = defineRule({
  id: "no-set-state-in-render",
  title: "setState called during render",
  severity: "warn",
  recommendation:
    "Move the setter into a `useEffect` or an event handler, or compute the value while rendering. Calling a setter during render starts another render that calls it again, looping forever.",
  create: (context: RuleContext) => {
    const checkComponent = (componentBody: EsTreeNode | null | undefined): void => {
      if (!componentBody || !isNodeOfType(componentBody, "BlockStatement")) return;
      const setterNames = new Set(
        collectUseStateBindings(componentBody).map((binding) => binding.setterName),
      );
      if (setterNames.size === 0) return;

      for (const setterCall of findUnconditionalSetterCalls(context, componentBody, setterNames)) {
        const setterIdentifierName = (setterCall.callee as EsTreeNodeOfType<"Identifier">).name;
        context.report({
          node: setterCall,
          message: `${setterIdentifierName}() triggers another render while rendering. Move it to an effect or event handler, or compute the value during render.`,
        });
      }
    };

    return {
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        checkComponent(node.body);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isComponentAssignment(node)) return;
        if (
          !isNodeOfType(node.init, "ArrowFunctionExpression") &&
          !isNodeOfType(node.init, "FunctionExpression")
        )
          return;
        checkComponent(node.init.body);
      },
    };
  },
});
