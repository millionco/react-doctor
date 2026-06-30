import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { collectUseStateBindings } from "./utils/collect-use-state-bindings.js";
import { collectRenderReachableExpressions } from "./utils/collect-render-reachable-expressions.js";
import { buildLocalDependencyGraph } from "./utils/build-local-dependency-graph.js";
import { collectRenderReachableNames } from "./utils/collect-render-reachable-names.js";
import { expandTransitiveDependencies } from "./utils/expand-transitive-dependencies.js";
import { collectFunctionLikeLocalNames } from "./utils/collect-function-like-local-names.js";
import { isSetterCalledDuringRender } from "./utils/is-setter-called-during-render.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// A binding whose value name appears in an EFFECT hook's dependency
// array is reactively needed: an effect re-runs when a dep changes, and
// swapping the state for a `useRef` would stop that re-run (ref writes
// don't trigger effects), so the value is NOT "set but never shown".
// Only effect hooks qualify — `useMemo`/`useCallback` deps merely control
// memoization/identity, and reading `ref.current` inside those callbacks
// stays correct, so they don't justify keeping the value in state.
const collectDependencyArrayNames = (componentBody: EsTreeNode): Set<string> => {
  const dependencyNames = new Set<string>();
  walkAst(componentBody, (child: EsTreeNode) => {
    if (!isNodeOfType(child, "CallExpression")) return;
    if (!isHookCall(child, EFFECT_HOOK_NAMES)) return;
    for (const argument of child.arguments ?? []) {
      if (!isNodeOfType(argument, "ArrayExpression")) continue;
      for (const element of argument.elements ?? []) {
        if (!element) continue;
        const rootName = getRootIdentifierName(element);
        if (rootName) dependencyNames.add(rootName);
      }
    }
  });
  return dependencyNames;
};

export const rerenderStateOnlyInHandlers = defineRule({
  id: "rerender-state-only-in-handlers",
  title: "State only used in handlers",
  severity: "warn",
  tags: ["test-noise"],
  category: "Performance",
  recommendation:
    "Use useRef instead of useState when the value is only set and never shown on screen. `ref.current = ...` updates it without redrawing the component.",
  create: (context: RuleContext) => {
    const checkComponent = (
      componentBody: EsTreeNode | null | undefined
    ): void => {
      if (!componentBody || !isNodeOfType(componentBody, "BlockStatement"))
        return;
      const bindings = collectUseStateBindings(componentBody);
      if (bindings.length === 0) return;

      const renderReachableExpressions =
        collectRenderReachableExpressions(componentBody);
      if (renderReachableExpressions.length === 0) return;

      const eventHandlerReferenceNames =
        collectFunctionLikeLocalNames(componentBody);
      const dependencyGraph = buildLocalDependencyGraph(
        componentBody,
        eventHandlerReferenceNames
      );
      const directRenderNames = collectRenderReachableNames(
        componentBody,
        eventHandlerReferenceNames
      );
      const renderReachableNames = expandTransitiveDependencies(
        directRenderNames,
        dependencyGraph
      );
      for (const dependencyName of collectDependencyArrayNames(componentBody)) {
        renderReachableNames.add(dependencyName);
      }

      for (const binding of bindings) {
        if (renderReachableNames.has(binding.valueName)) continue;
        // Underscore-only or underscore-prefixed value names signal
        // the user is intentionally using useState to FORCE a re-
        // render and doesn't care about the value (`const [_, force]
        // = useState(0)`, `const [_force, setForce] = useState(false)`).
        // This is the canonical "trigger a re-render imperatively"
        // pattern — useRef wouldn't work because ref updates don't
        // re-render. Skip.
        if (binding.valueName === "_" || binding.valueName.startsWith("_"))
          continue;
        // Setter names that match force-rerender conventions
        // (`triggerRender`, `forceUpdate`, `rerender`, `forceRender`,
        // `tick`, `bump`, `bumpVersion`) — these names literally
        // declare the user's intent: re-render on demand. Skip.
        const setterSuffix = binding.setterName.slice(3); // 'set' + suffix
        if (
          /^(TriggerRender|ForceUpdate|Rerender|ForceRender|Tick|Bump|BumpVersion|InvalidateRender|Refresh|Repaint)$/i.test(
            setterSuffix
          )
        ) {
          continue;
        }

        let setterCalled = false;
        walkAst(componentBody, (child: EsTreeNode) => {
          if (setterCalled) return;
          if (
            isNodeOfType(child, "CallExpression") &&
            isNodeOfType(child.callee, "Identifier") &&
            child.callee.name === binding.setterName
          ) {
            setterCalled = true;
          }
        });
        if (!setterCalled) continue;

        // The "store information from previous renders" pattern reads the
        // value in a render-phase guard (`if (value !== prevValue)`) and
        // re-syncs it by calling the setter during render. Such a value
        // shapes render-phase control flow, so it is NOT write-only and a
        // `useRef` swap would break the adjustment. Skip it.
        if (isSetterCalledDuringRender(componentBody, binding.setterName))
          continue;

        context.report({
          node: binding.declarator,
          message: `Each update to "${binding.valueName}" redraws your component for nothing because this useState is set but never shown on screen.`,
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
