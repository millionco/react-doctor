import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { getCallbackStatements } from "../../utils/get-callback-statements.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { collectUseStateBindings } from "./utils/collect-use-state-bindings.js";

// Every literal builds a value-equal result except a regex literal,
// which evaluates to a fresh `RegExp` object each render and so never
// passes React's `Object.is` bailout — the same as `[]` / `{}` / `new`.
const doesConstructFreshReference = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "ArrayExpression") ||
  isNodeOfType(node, "ObjectExpression") ||
  isNodeOfType(node, "NewExpression") ||
  (isNodeOfType(node, "Literal") && "regex" in node);

// True when `stateName` is read as a VALUE somewhere in the expression. A
// non-computed member property (`other.count`) and a non-computed object
// key (`{ count: 1 }`) are static names, not reads of the `count`
// binding, so they are skipped — walking every Identifier blindly would
// flag `setCount(other.count)` as self-referential.
const expressionReadsStateValue = (node: EsTreeNode, stateName: string): boolean => {
  // A nested closure (`registerCallback(() => count)`) captures the state
  // rather than reading it while computing the setter's argument — the
  // body runs later, or never. Synchronous reads that actually shape the
  // value (e.g. the `items` receiver in `items.filter(...)`) sit outside
  // the closure and are still seen, so stop at function boundaries.
  if (isNodeOfType(node, "ArrowFunctionExpression") || isNodeOfType(node, "FunctionExpression")) {
    return false;
  }
  if (isNodeOfType(node, "Identifier")) return node.name === stateName;
  if (isNodeOfType(node, "MemberExpression")) {
    if (expressionReadsStateValue(node.object, stateName)) return true;
    return node.computed ? expressionReadsStateValue(node.property, stateName) : false;
  }
  if (isNodeOfType(node, "Property")) {
    if (node.computed && expressionReadsStateValue(node.key, stateName)) return true;
    return expressionReadsStateValue(node.value, stateName);
  }
  const nodeRecord = node as unknown as Record<string, unknown>;
  for (const childKey of Object.keys(nodeRecord)) {
    if (childKey === "parent" || childKey === "type") continue;
    const childValue = nodeRecord[childKey];
    if (Array.isArray(childValue)) {
      for (const childArrayItem of childValue) {
        if (isAstNode(childArrayItem) && expressionReadsStateValue(childArrayItem, stateName)) {
          return true;
        }
      }
    } else if (isAstNode(childValue) && expressionReadsStateValue(childValue, stateName)) {
      return true;
    }
  }
  return false;
};

// A self-referential write only loops forever when its new value
// provably keeps changing every run. That holds for three shapes:
//   - a functional updater `(prev) => …` (React re-runs the effect, the
//     updater re-derives from the latest value),
//   - a freshly-constructed reference (`setItems([])`, `setUser({})`,
//     `new Map()`) that never passes React's `Object.is` bailout, and
//   - a value computed from the same state (`setCount(count + 1)`).
// Plausibly-stable scalar writes (`setOpen(true)`, `setTab(props.tab)`,
// `setX(other)`) settle after at most one extra render, and `setX(x)`
// is a no-op — none are render loops, so the detector stays quiet to
// avoid overclaiming.
const isNonSettlingSetterArgument = (
  setterCall: EsTreeNodeOfType<"CallExpression">,
  stateName: string,
): boolean => {
  const firstArgument = setterCall.arguments?.[0];
  // A bare `setX()` writes `undefined`; if the state already holds
  // `undefined` it settles, so it is not provably a loop.
  if (!firstArgument) return false;
  const argument = stripParenExpression(firstArgument);
  // `setX(x)` writes the current value straight back — an immediate
  // `Object.is` bailout, not a loop.
  if (isNodeOfType(argument, "Identifier") && argument.name === stateName) return false;
  if (
    isNodeOfType(argument, "ArrowFunctionExpression") ||
    isNodeOfType(argument, "FunctionExpression")
  ) {
    return true;
  }
  if (doesConstructFreshReference(argument)) return true;
  return expressionReadsStateValue(argument, stateName);
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
          if (!isNonSettlingSetterArgument(setterCall, stateName)) continue;

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
        const functionName = node.id?.name;
        if (!functionName || (!isUppercaseName(functionName) && !isReactHookName(functionName))) {
          return;
        }
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
