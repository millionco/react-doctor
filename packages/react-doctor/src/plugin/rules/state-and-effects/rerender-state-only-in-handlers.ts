import { defineRule } from "../../utils/define-rule.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
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
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const rerenderStateOnlyInHandlers = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "Performance",
  recommendation:
    "Replace useState with useRef when the value is only mutated and never read in render — `ref.current = ...` updates without re-rendering the component",
  examples: [
    {
      before:
        "const [clicks, setClicks] = useState(0);\nconst onClick = () => setClicks(clicks + 1);",
      after: "const clicksRef = useRef(0);\nconst onClick = () => { clicksRef.current += 1; };",
    },
  ],
  create: (context: RuleContext) => {
    const checkComponent = (componentBody: EsTreeNode | null | undefined): void => {
      if (!componentBody || !isNodeOfType(componentBody, "BlockStatement")) return;
      const bindings = collectUseStateBindings(componentBody);
      if (bindings.length === 0) return;

      const returnExpressions = collectReturnExpressions(componentBody);
      if (returnExpressions.length === 0) return;

      const dependencyGraph = buildLocalDependencyGraph(componentBody);
      const directRenderNames = collectRenderReachableNames(returnExpressions);
      const renderReachableNames = expandTransitiveDependencies(directRenderNames, dependencyGraph);

      for (const binding of bindings) {
        if (renderReachableNames.has(binding.valueName)) continue;

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
          message: `useState "${binding.valueName}" is updated but never read in the component's return — use useRef so updates don't trigger re-renders`,
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
