import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { getCallbackStatements } from "../../utils/get-callback-statements.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isReactHookCall } from "../../utils/is-react-hook-call.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { collectUseStateBindings } from "./utils/collect-use-state-bindings.js";
import { buildLocalDependencyGraph } from "./utils/build-local-dependency-graph.js";
import { collectRenderReachableNames } from "./utils/collect-render-reachable-names.js";
import { expandTransitiveDependencies } from "./utils/expand-transitive-dependencies.js";
import { collectFunctionLikeLocalNames } from "./utils/collect-function-like-local-names.js";
import { findTriggeredSideEffectCalleeName } from "./utils/find-triggered-side-effect-callee-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getRef } from "./utils/effect/ast.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import { isState } from "./utils/effect/react.js";
import { isStateWrittenOnlyFromEventHandlers } from "./utils/is-state-written-only-from-event-handlers.js";

// HACK: §6 of "You Might Not Need an Effect" — sending a POST request:
//
//   const [jsonToSubmit, setJsonToSubmit] = useState(null);
//   useEffect(() => {
//     if (jsonToSubmit !== null) {
//       post('/api/register', jsonToSubmit);
//     }
//   }, [jsonToSubmit]);
//
//   function handleSubmit(event) {
//     event.preventDefault();
//     setJsonToSubmit({ firstName, lastName });   // ← only writer
//   }
//
// Detector pre-conditions (all must hold):
//   (1) useEffect with deps = [stateX] — single dep that's a useState
//       binding declared in this component
//   (2) effect body is a single IfStatement guarding on stateX with one
//       of: bare truthy, !== null/undefined, === Literal, or .length
//   (3) IfStatement.consequent contains a CallExpression whose callee
//       is in EVENT_TRIGGERED_SIDE_EFFECT_CALLEES OR a MemberExpression
//       whose property is in EVENT_TRIGGERED_SIDE_EFFECT_MEMBER_METHODS
//   (4) every setStateX call site is inside a JSX `on*` handler (or a
//       function bound to one) — i.e. the trigger is set only by user
//       interactions, never by other reactive logic
//
// Why all four matter: (1) + (2) recognize the "trigger guard" shape;
// (3) restricts to side effects users would associate with a button
// click; (4) is the strongest signal that the state exists *only* to
// schedule the effect, distinguishing this from §5 (event-shared logic
// triggered by props) which already has its own rule.
// HACK: in JS, `undefined` is parsed as an Identifier (not a Literal
// like `null`). For `x !== undefined`, both sides of the
// BinaryExpression are Identifiers, so a naive "first Identifier
// wins" pick can return `"undefined"` instead of the trigger state
// name — silently dropping the violation for the reversed
// (`undefined !== x`) ordering. Skip the `undefined` / `null`
// sentinel side so the actual state Identifier is what we return.
const SENTINEL_IDENTIFIER_NAMES = new Set(["undefined", "NaN", "null"]);

const isSentinelIdentifier = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "Identifier") && SENTINEL_IDENTIFIER_NAMES.has(node.name);

const getTriggerGuardRootName = (testNode: EsTreeNode): string | null => {
  if (!testNode) return null;
  if (isNodeOfType(testNode, "Identifier")) return testNode.name;
  if (isNodeOfType(testNode, "BinaryExpression")) {
    if (!["!==", "===", "!=", "=="].includes(testNode.operator)) return null;
    for (const side of [testNode.left, testNode.right]) {
      if (isNodeOfType(side, "Identifier") && !isSentinelIdentifier(side)) {
        return side.name;
      }
    }
    return null;
  }
  if (
    isNodeOfType(testNode, "MemberExpression") &&
    isNodeOfType(testNode.property, "Identifier") &&
    testNode.property.name === "length"
  ) {
    if (isNodeOfType(testNode.object, "Identifier")) return testNode.object.name;
  }
  if (isNodeOfType(testNode, "UnaryExpression") && testNode.operator === "!") {
    return getTriggerGuardRootName(testNode.argument);
  }
  return null;
};

export const noEventTriggerState = defineRule({
  id: "no-event-trigger-state",
  title: "State exists only to trigger an effect",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Delete the trigger state (`useState(null)` plus the `useEffect` that watches it) and call the side effect like `post(...)`, `navigate(...)`, or `track(...)` directly in the event handler that set it. State shouldn't exist just to kick off an effect.",
  create: (context: RuleContext) => {
    const checkComponent = (componentBody: EsTreeNode | null | undefined): void => {
      if (!componentBody || !isNodeOfType(componentBody, "BlockStatement")) return;

      const useStateBindings = collectUseStateBindings(componentBody, context.scopes);
      if (useStateBindings.length === 0) return;
      const analysis = getProgramAnalysis(componentBody);
      if (!analysis) return;
      const localStateNames = new Set(useStateBindings.map((binding) => binding.valueName));

      // HACK: a state read in render (e.g. `<input value={query} />`)
      // is dual-purpose — it controls UI AND triggers the effect.
      // Calling it "exists only to schedule the effect" is wrong; the
      // user can't just delete the state. Reuse the same render-
      // reachability machinery that `rerenderStateOnlyInHandlers`
      // uses to filter these out (transitive dep graph + walk from
      // render-reachable expressions).
      const eventHandlerReferenceNames = collectFunctionLikeLocalNames(
        componentBody,
        context.scopes,
      );
      const dependencyGraph = buildLocalDependencyGraph(componentBody, eventHandlerReferenceNames);
      const directRenderNames = collectRenderReachableNames(
        componentBody,
        context.scopes,
        eventHandlerReferenceNames,
      );
      const renderReachableNames = expandTransitiveDependencies(directRenderNames, dependencyGraph);

      walkAst(componentBody, (effectCall: EsTreeNode) => {
        if (!isNodeOfType(effectCall, "CallExpression")) return;
        if (!isReactHookCall(effectCall, EFFECT_HOOK_NAMES, context.scopes)) return;
        if ((effectCall.arguments?.length ?? 0) < 2) return;

        const depsNode = effectCall.arguments[1];
        if (!isNodeOfType(depsNode, "ArrayExpression")) return;
        if ((depsNode.elements?.length ?? 0) !== 1) return;

        const depElement = depsNode.elements[0];
        if (!isNodeOfType(depElement, "Identifier")) return;
        if (!localStateNames.has(depElement.name)) return;
        const dependencyReference = getRef(analysis, depElement);
        if (
          !dependencyReference ||
          !isState(analysis, dependencyReference) ||
          !isStateWrittenOnlyFromEventHandlers(analysis, dependencyReference)
        ) {
          return;
        }
        // Dual-purpose state — used in render too. Don't claim it
        // "exists only to schedule" the effect.
        if (renderReachableNames.has(depElement.name)) return;

        const callback = getEffectCallback(effectCall);
        if (!callback) return;

        const bodyStatements = getCallbackStatements(callback);
        if (bodyStatements.length !== 1) return;
        const soleStatement = bodyStatements[0];
        if (!isNodeOfType(soleStatement, "IfStatement")) return;

        const guardRootName = getTriggerGuardRootName(soleStatement.test);
        if (guardRootName !== depElement.name) return;

        const sideEffectCalleeName = findTriggeredSideEffectCalleeName(soleStatement.consequent);
        if (!sideEffectCalleeName) return;

        context.report({
          node: effectCall,
          message: `useState "${depElement.name}" forces an extra render just to fire "${sideEffectCalleeName}(...)" from a useEffect.`,
        });
      });
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
