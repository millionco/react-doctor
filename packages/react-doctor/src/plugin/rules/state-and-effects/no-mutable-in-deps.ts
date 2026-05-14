import { MUTABLE_GLOBAL_ROOTS } from "../../constants/dom.js";
import { HOOKS_WITH_DEPS } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: "Lifecycle of Reactive Effects" — Can global or mutable
// values be dependencies? — calls out that `location.pathname`,
// `ref.current`, and other mutable values can't be deps:
//
//   "Mutable values aren't reactive. Changing it wouldn't trigger
//    a re-render, so even if you specified it in the dependencies,
//    React wouldn't know to re-synchronize the Effect."
//
// We flag two shapes:
//   (1) MemberExpression rooted in a known mutable global
//       (location, window, document, navigator, history, ...) —
//       e.g. `location.pathname`, `window.innerWidth`, `document.title`
//   (2) MemberExpression `<x>.current` where `x` is a `useRef`
//       binding declared in the same component
//
// Bare `location` / bare `useRef`-returned identifiers are NOT
// flagged — those are themselves stable references; only their
// mutable property reads are the bug.
const collectUseRefBindingNames = (componentBody: EsTreeNode): Set<string> => {
  const useRefBindings = new Set<string>();
  if (!isNodeOfType(componentBody, "BlockStatement")) return useRefBindings;
  for (const statement of componentBody.body ?? []) {
    if (!isNodeOfType(statement, "VariableDeclaration")) continue;
    for (const declarator of statement.declarations ?? []) {
      if (!isNodeOfType(declarator.id, "Identifier")) continue;
      if (!isNodeOfType(declarator.init, "CallExpression")) continue;
      if (!isHookCall(declarator.init, "useRef")) continue;
      useRefBindings.add(declarator.id.name);
    }
  }
  return useRefBindings;
};

const findMutableDepIssue = (
  depElement: EsTreeNode,
  useRefBindingNames: Set<string>,
): { kind: "global" | "ref-current"; rootName: string } | null => {
  if (!isNodeOfType(depElement, "MemberExpression")) return null;

  if (
    isNodeOfType(depElement.property, "Identifier") &&
    depElement.property.name === "current" &&
    !depElement.computed &&
    isNodeOfType(depElement.object, "Identifier") &&
    useRefBindingNames.has(depElement.object.name)
  ) {
    return { kind: "ref-current", rootName: depElement.object.name };
  }

  const rootName = getRootIdentifierName(depElement);
  if (rootName !== null && MUTABLE_GLOBAL_ROOTS.has(rootName)) {
    return { kind: "global", rootName };
  }
  return null;
};

export const noMutableInDeps = defineRule<Rule>({
  id: "no-mutable-in-deps",
  framework: "global",
  severity: "error",
  category: "State & Effects",
  recommendation:
    "Read mutable values (`location.pathname`, `ref.current`) inside the effect body instead of in the deps array, or subscribe with `useSyncExternalStore`. Mutations to these don't trigger re-renders, so listing them in deps doesn't make the effect react to changes",
  examples: [
    {
      before: "useEffect(() => { log(window.location.pathname); }, [window.location.pathname]);",
      after: "useEffect(() => { log(window.location.pathname); }, []);",
    },
  ],
  create: (context: RuleContext) => {
    const checkComponent = (componentBody: EsTreeNode | null | undefined): void => {
      if (!componentBody || !isNodeOfType(componentBody, "BlockStatement")) return;
      const useRefBindingNames = collectUseRefBindingNames(componentBody);

      walkAst(componentBody, (child: EsTreeNode) => {
        if (!isNodeOfType(child, "CallExpression")) return;
        if (!isHookCall(child, HOOKS_WITH_DEPS)) return;
        if ((child.arguments?.length ?? 0) < 2) return;
        const depsNode = child.arguments[1];
        if (!isNodeOfType(depsNode, "ArrayExpression")) return;

        for (const element of depsNode.elements ?? []) {
          if (!element) continue;
          const issue = findMutableDepIssue(element, useRefBindingNames);
          if (!issue) continue;
          if (issue.kind === "ref-current") {
            context.report({
              node: element,
              message: `"${issue.rootName}.current" in deps — refs are mutable and don't trigger re-renders, so React won't re-run this effect when it changes. Read the ref inside the effect body instead`,
            });
          } else {
            context.report({
              node: element,
              message: `Mutable global "${issue.rootName}.*" in deps — values like \`location.pathname\` can change without triggering a re-render, so they can't drive effect re-runs. Subscribe with useSyncExternalStore or read inside the effect`,
            });
          }
        }
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
