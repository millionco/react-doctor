import { defineRule } from "../../utils/define-rule.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { collectUseStateBindings } from "./utils/collect-use-state-bindings.js";
import { collectRenderReachableExpressions } from "./utils/collect-render-reachable-expressions.js";
import { buildLocalDependencyGraph } from "./utils/build-local-dependency-graph.js";
import { collectRenderReachableNames } from "./utils/collect-render-reachable-names.js";
import { expandTransitiveDependencies } from "./utils/expand-transitive-dependencies.js";
import { collectFunctionLikeLocalNames } from "./utils/collect-function-like-local-names.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const rerenderStateOnlyInHandlers = defineRule<Rule>({
  id: "rerender-state-only-in-handlers",
  title: "State only used in handlers",
  severity: "warn",
  tags: ["test-noise"],
  category: "Performance",
  recommendation:
    "Use useRef instead of useState when the value is only set and never shown on screen. `ref.current = ...` updates it without redrawing the component.",
  create: (context: RuleContext) => {
    const checkComponent = (componentBody: EsTreeNode | null | undefined): void => {
      if (!componentBody || !isNodeOfType(componentBody, "BlockStatement")) return;
      const bindings = collectUseStateBindings(componentBody);
      if (bindings.length === 0) return;

      const renderReachableExpressions = collectRenderReachableExpressions(componentBody);
      if (renderReachableExpressions.length === 0) return;

      const eventHandlerReferenceNames = collectFunctionLikeLocalNames(componentBody);
      const dependencyGraph = buildLocalDependencyGraph(componentBody, eventHandlerReferenceNames);
      const directRenderNames = collectRenderReachableNames(
        componentBody,
        eventHandlerReferenceNames,
      );
      const renderReachableNames = expandTransitiveDependencies(directRenderNames, dependencyGraph);

      for (const binding of bindings) {
        if (renderReachableNames.has(binding.valueName)) continue;
        // Underscore-only or underscore-prefixed value names signal
        // the user is intentionally using useState to FORCE a re-
        // render and doesn't care about the value (`const [_, force]
        // = useState(0)`, `const [_force, setForce] = useState(false)`).
        // This is the canonical "trigger a re-render imperatively"
        // pattern — useRef wouldn't work because ref updates don't
        // re-render. Skip.
        if (binding.valueName === "_" || binding.valueName.startsWith("_")) continue;
        // Setter names that match force-rerender conventions
        // (`triggerRender`, `forceUpdate`, `rerender`, `forceRender`,
        // `tick`, `bump`, `bumpVersion`) — these names literally
        // declare the user's intent: re-render on demand. Skip.
        const setterSuffix = binding.setterName.slice(3); // 'set' + suffix
        if (
          /^(TriggerRender|ForceUpdate|Rerender|ForceRender|Tick|Bump|BumpVersion|InvalidateRender|Refresh|Repaint)$/i.test(
            setterSuffix,
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
