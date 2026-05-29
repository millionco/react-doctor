import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { getCallbackStatements } from "../../utils/get-callback-statements.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { collectUseStateBindings } from "./utils/collect-use-state-bindings.js";

// A setter argument that is a primitive literal (`setOpen(true)`,
// `setCount(0)`, `setName("")`) settles to a fixed point: once the
// state already holds that value, React's `Object.is` bailout stops
// the effect from re-running. Those are NOT feedback loops, so the
// detector skips them. New-reference values (`setItems([])`,
// `setUser({})`), arithmetic (`setCount(count + 1)`), and functional
// updaters (`setCount((value) => value + 1)`) never settle on their
// own and DO loop — those are reported.
const isProvableFixedPointSetterArgument = (
  setterCall: EsTreeNodeOfType<"CallExpression">,
): boolean => {
  const firstArgument = setterCall.arguments?.[0];
  // A bare `setX()` writes `undefined`; if the state already holds
  // `undefined` it settles. Can't prove a loop, so stay quiet.
  if (!firstArgument) return true;
  return isNodeOfType(stripParenExpression(firstArgument), "Literal");
};

const getUnconditionalSetterCall = (
  statement: EsTreeNode,
  setterNames: ReadonlySet<string>,
): EsTreeNodeOfType<"CallExpression"> | null => {
  // `getCallbackStatements` hands back the bare expression for a concise
  // arrow body (`() => setCount(...)`) and the `ExpressionStatement` for a
  // block body (`() => { setCount(...); }`). Both are unconditional
  // synchronous writes, so unwrap the statement form and treat them alike.
  const expression = stripParenExpression(
    isNodeOfType(statement, "ExpressionStatement") ? statement.expression : statement,
  );
  if (!isNodeOfType(expression, "CallExpression")) return null;
  if (!isNodeOfType(expression.callee, "Identifier")) return null;
  if (!setterNames.has(expression.callee.name)) return null;
  return expression;
};

const collectDependencyStateNames = (depsNode: EsTreeNode): ReadonlySet<string> => {
  const dependencyNames = new Set<string>();
  if (!isNodeOfType(depsNode, "ArrayExpression")) return dependencyNames;
  for (const element of depsNode.elements ?? []) {
    if (isNodeOfType(element, "Identifier")) dependencyNames.add(element.name);
  }
  return dependencyNames;
};

export const noSelfUpdatingEffect = defineRule<Rule>({
  id: "no-self-updating-effect",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Remove the feedback loop: derive the value during render, move the write into an event handler, or guard the update so it reaches a fixed point. See https://react.dev/learn/you-might-not-need-an-effect",
  create: (context: RuleContext) => {
    const checkFunctionScope = (functionBody: EsTreeNode | null | undefined): void => {
      if (!functionBody || !isNodeOfType(functionBody, "BlockStatement")) return;

      const useStateBindings = collectUseStateBindings(functionBody);
      if (useStateBindings.length === 0) return;

      const setterNameToStateName = new Map<string, string>();
      for (const binding of useStateBindings) {
        setterNameToStateName.set(binding.setterName, binding.valueName);
      }
      const setterNames = new Set(setterNameToStateName.keys());

      for (const statement of functionBody.body ?? []) {
        if (!isNodeOfType(statement, "ExpressionStatement")) continue;
        const effectCall = statement.expression;
        if (!isNodeOfType(effectCall, "CallExpression")) continue;
        if (!isHookCall(effectCall, EFFECT_HOOK_NAMES)) continue;
        if ((effectCall.arguments?.length ?? 0) < 2) continue;

        const dependencyStateNames = collectDependencyStateNames(effectCall.arguments[1]);
        if (dependencyStateNames.size === 0) continue;

        const callback = getEffectCallback(effectCall);
        if (!callback) continue;

        // Only the effect's own synchronous statements are walked.
        // Setters inside nested timer / subscription / promise
        // callbacks are deferred writes that fire on a later tick, and
        // setters guarded by an `if` can reach a fixed point — neither
        // is an unconditional feedback loop, so both are left to other
        // rules.
        const reportedStateNames = new Set<string>();
        for (const callbackStatement of getCallbackStatements(callback)) {
          const setterCall = getUnconditionalSetterCall(callbackStatement, setterNames);
          if (!setterCall || !isNodeOfType(setterCall.callee, "Identifier")) continue;

          const stateName = setterNameToStateName.get(setterCall.callee.name);
          if (!stateName || !dependencyStateNames.has(stateName)) continue;
          if (reportedStateNames.has(stateName)) continue;
          if (isProvableFixedPointSetterArgument(setterCall)) continue;

          reportedStateNames.add(stateName);
          context.report({
            node: setterCall,
            message: `${setterCall.callee.name}() runs unconditionally inside this effect, which depends on \`${stateName}\` — setting the same state the effect reacts to re-runs the effect on every commit and causes a render loop. Derive the value during render, move the write into an event handler, or guard the update so it settles.`,
          });
        }
      }
    };

    return {
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        const name = node.id?.name;
        if (!name || (!isUppercaseName(name) && !isReactHookName(name))) return;
        checkFunctionScope(node.body);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        const isHookAssignment =
          isNodeOfType(node.id, "Identifier") &&
          isReactHookName(node.id.name) &&
          (isNodeOfType(node.init, "ArrowFunctionExpression") ||
            isNodeOfType(node.init, "FunctionExpression"));
        if (!isComponentAssignment(node) && !isHookAssignment) return;
        if (
          !isNodeOfType(node.init, "ArrowFunctionExpression") &&
          !isNodeOfType(node.init, "FunctionExpression")
        ) {
          return;
        }
        checkFunctionScope(node.init.body);
      },
    };
  },
});
