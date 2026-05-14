import {
  EFFECT_HOOK_NAMES,
  EVENT_TRIGGERED_NAVIGATION_METHOD_NAMES,
  EVENT_TRIGGERED_SIDE_EFFECT_CALLEES,
  EVENT_TRIGGERED_SIDE_EFFECT_MEMBER_METHODS,
  NAVIGATION_RECEIVER_NAMES,
} from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { getCallbackStatements } from "../../utils/get-callback-statements.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { collectUseStateBindings } from "./utils/collect-use-state-bindings.js";
import { collectReturnExpressions } from "./utils/collect-return-expressions.js";
import { buildLocalDependencyGraph } from "./utils/build-local-dependency-graph.js";
import { collectRenderReachableNames } from "./utils/collect-render-reachable-names.js";
import { expandTransitiveDependencies } from "./utils/expand-transitive-dependencies.js";
import { collectHandlerBindingNames } from "./utils/collect-handler-binding-names.js";
import { isInsideEventHandler } from "./utils/is-inside-event-handler.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

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

const findTriggeredSideEffectCalleeName = (consequentNode: EsTreeNode): string | null => {
  let foundCalleeName: string | null = null;
  walkAst(consequentNode, (child: EsTreeNode) => {
    if (foundCalleeName) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    const callee = child.callee;
    if (
      isNodeOfType(callee, "Identifier") &&
      EVENT_TRIGGERED_SIDE_EFFECT_CALLEES.has(callee.name)
    ) {
      foundCalleeName = callee.name;
      return;
    }
    if (isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")) {
      const propertyName = callee.property.name;
      const isUnambiguousMethod = EVENT_TRIGGERED_SIDE_EFFECT_MEMBER_METHODS.has(propertyName);
      const isNavigationMethod = EVENT_TRIGGERED_NAVIGATION_METHOD_NAMES.has(propertyName);
      if (!isUnambiguousMethod && !isNavigationMethod) return;
      const rootName = getRootIdentifierName(callee);
      if (isNavigationMethod && (rootName === null || !NAVIGATION_RECEIVER_NAMES.has(rootName))) {
        return;
      }
      foundCalleeName = rootName ? `${rootName}.${propertyName}` : propertyName;
    }
  });
  return foundCalleeName;
};

const collectHandlerOnlyWriteStateNames = (
  componentBody: EsTreeNode,
  useStateBindings: Array<{ valueName: string; setterName: string; declarator: EsTreeNode }>,
  handlerBindingNames: Set<string>,
): Set<string> => {
  const handlerOnlyWriteStateNames = new Set<string>();
  for (const binding of useStateBindings) {
    let didFindAnySetterCall = false;
    let areAllSetterCallsInHandlers = true;
    walkAst(componentBody, (child: EsTreeNode) => {
      if (!areAllSetterCallsInHandlers) return false;
      if (!isNodeOfType(child, "CallExpression")) return;
      if (!isNodeOfType(child.callee, "Identifier")) return;
      if (child.callee.name !== binding.setterName) return;
      didFindAnySetterCall = true;
      if (!isInsideEventHandler(child, handlerBindingNames)) {
        areAllSetterCallsInHandlers = false;
      }
    });
    if (didFindAnySetterCall && areAllSetterCallsInHandlers) {
      handlerOnlyWriteStateNames.add(binding.valueName);
    }
  }
  return handlerOnlyWriteStateNames;
};

export const noEventTriggerState = defineRule<Rule>({
  id: "no-event-trigger-state",
  framework: "global",
  severity: "warn",
  category: "State & Effects",
  recommendation:
    "Delete the trigger state (`useState(null)` plus the `useEffect` that watches it) and call the side-effect (`post(...)` / `navigate(...)` / `track(...)`) directly inside the event handler that previously called the setter. State should not exist purely to schedule effect runs",
  examples: [
    {
      before:
        "const [submit, setSubmit] = useState(null);\nuseEffect(() => { if (submit) post(submit); }, [submit]);\nconst onSubmit = (data) => setSubmit(data);",
      after: "const onSubmit = (data) => post(data);",
    },
  ],
  create: (context: RuleContext) => {
    const checkComponent = (componentBody: EsTreeNode | null | undefined): void => {
      if (!componentBody || !isNodeOfType(componentBody, "BlockStatement")) return;

      const useStateBindings = collectUseStateBindings(componentBody);
      if (useStateBindings.length === 0) return;

      const handlerBindingNames = collectHandlerBindingNames(componentBody);
      const handlerOnlyWriteStateNames = collectHandlerOnlyWriteStateNames(
        componentBody,
        useStateBindings,
        handlerBindingNames,
      );
      if (handlerOnlyWriteStateNames.size === 0) return;

      // HACK: a state read in render (e.g. `<input value={query} />`)
      // is dual-purpose — it controls UI AND triggers the effect.
      // Calling it "exists only to schedule the effect" is wrong; the
      // user can't just delete the state. Reuse the same render-
      // reachability machinery that `rerenderStateOnlyInHandlers`
      // uses to filter these out (transitive dep graph + walk from
      // return expressions).
      const returnExpressions = collectReturnExpressions(componentBody);
      const dependencyGraph = buildLocalDependencyGraph(componentBody);
      const directRenderNames = collectRenderReachableNames(returnExpressions);
      const renderReachableNames = expandTransitiveDependencies(directRenderNames, dependencyGraph);

      walkAst(componentBody, (effectCall: EsTreeNode) => {
        if (!isNodeOfType(effectCall, "CallExpression")) return;
        if (!isHookCall(effectCall, EFFECT_HOOK_NAMES)) return;
        if ((effectCall.arguments?.length ?? 0) < 2) return;

        const depsNode = effectCall.arguments[1];
        if (!isNodeOfType(depsNode, "ArrayExpression")) return;
        if ((depsNode.elements?.length ?? 0) !== 1) return;

        const depElement = depsNode.elements[0];
        if (!isNodeOfType(depElement, "Identifier")) return;
        if (!handlerOnlyWriteStateNames.has(depElement.name)) return;
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
          message: `useState "${depElement.name}" exists only to schedule "${sideEffectCalleeName}(...)" from a useEffect — call "${sideEffectCalleeName}(...)" directly inside the event handler that sets it, and delete the state`,
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
