import { defineRule } from "../../utils/define-rule.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { walkInsideStatementBlocks } from "../../utils/walk-inside-statement-blocks.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { collectUseStateBindings } from "./utils/collect-use-state-bindings.js";

// A state setter called inside a render-phase loop fires once per iteration,
// and each call schedules another render that re-runs the loop, looping
// forever ("Too many re-renders"). `no-set-state-in-render` only catches
// setters that run UNCONDITIONALLY on every path; a setter inside a
// `for (const item of items)` is conditional on the loop running, so it
// slips past that rule. The CFG's `isInsideLoop` closes that gap precisely:
// it is true only for a node in a real cycle of the component's OWN CFG, so
// a setter inside a `.map()` / event-handler callback (a separate function)
// is never mistaken for a render-phase loop write.
const findRenderLoopSetterCalls = (
  context: RuleContext,
  componentBody: EsTreeNode,
  setterNames: ReadonlySet<string>,
): EsTreeNodeOfType<"CallExpression">[] => {
  const calls: EsTreeNodeOfType<"CallExpression">[] = [];
  walkInsideStatementBlocks(componentBody, (child) => {
    if (!isNodeOfType(child, "CallExpression")) return;
    if (!isNodeOfType(child.callee, "Identifier")) return;
    if (!setterNames.has(child.callee.name)) return;
    if (!context.cfg.isInsideLoop(child)) return;
    // A setter that ALSO runs on every path (`for (;;) setX()`) is the
    // unconditional render write `no-set-state-in-render` owns; leave it to
    // that rule so the two never double-report the same call.
    if (context.cfg.isUnconditionalFromEntry(child)) return;
    calls.push(child);
  });
  return calls;
};

export const noSetStateInRenderLoop = defineRule({
  id: "no-set-state-in-render-loop",
  title: "setState called in a render loop",
  severity: "warn",
  recommendation:
    "Move the setter into an event handler or effect, or compute the value while rendering. A setter called inside a loop during render fires every iteration and starts another render.",
  create: (context: RuleContext) => {
    const checkComponent = (componentBody: EsTreeNode | null | undefined): void => {
      if (!componentBody || !isNodeOfType(componentBody, "BlockStatement")) return;
      const setterNames = new Set(
        collectUseStateBindings(componentBody).map((binding) => binding.setterName),
      );
      if (setterNames.size === 0) return;

      for (const setterCall of findRenderLoopSetterCalls(context, componentBody, setterNames)) {
        const setterIdentifierName = (setterCall.callee as EsTreeNodeOfType<"Identifier">).name;
        context.report({
          node: setterCall,
          message: `${setterIdentifierName}() runs inside a render-phase loop, so it fires every iteration and starts another render. Move it into an event handler or effect, or compute the value while rendering.`,
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
        ) {
          return;
        }
        checkComponent(node.init.body);
      },
    };
  },
});
