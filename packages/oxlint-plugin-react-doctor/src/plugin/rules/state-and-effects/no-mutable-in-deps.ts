import { MUTABLE_GLOBAL_ROOTS } from "../../constants/dom.js";
import { HOOKS_WITH_DEPS } from "../../constants/react.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isReactHookCall } from "../../utils/is-react-hook-call.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
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
const collectUseRefBindingNames = (
  componentBody: EsTreeNode,
  scopes: ScopeAnalysis,
): Set<string> => {
  const useRefBindings = new Set<string>();
  if (!isNodeOfType(componentBody, "BlockStatement")) return useRefBindings;
  for (const statement of componentBody.body ?? []) {
    if (!isNodeOfType(statement, "VariableDeclaration")) continue;
    for (const declarator of statement.declarations ?? []) {
      if (!isNodeOfType(declarator.id, "Identifier")) continue;
      if (!isNodeOfType(declarator.init, "CallExpression")) continue;
      if (!isReactHookCall(declarator.init, "useRef", scopes)) continue;
      useRefBindings.add(declarator.id.name);
    }
  }
  return useRefBindings;
};

// Every name introduced by a `const`/`let`/`var` declaration anywhere
// in the component body. A root like `location` that resolves to a
// local binding (e.g. `const location = useLocation()`) is NOT the
// browser global — react-router's `useLocation()` returns a fresh,
// reactive object on every navigation, so `location.pathname` in deps
// is correct, not a footgun.
const collectLocalBindingNames = (componentBody: EsTreeNode): Set<string> => {
  const localBindingNames = new Set<string>();
  walkAst(componentBody, (child: EsTreeNode) => {
    // Don't descend into nested function scopes: a `const location = …`
    // inside a callback or nested component must not mask a browser global
    // (`location.pathname`) read in THIS component's own dependency array.
    if (
      child !== componentBody &&
      (isNodeOfType(child, "FunctionDeclaration") ||
        isNodeOfType(child, "FunctionExpression") ||
        isNodeOfType(child, "ArrowFunctionExpression"))
    ) {
      return false;
    }
    if (isNodeOfType(child, "VariableDeclarator")) {
      collectPatternNames(child.id, localBindingNames);
    }
  });
  return localBindingNames;
};

const findMutableDepIssue = (
  depElement: EsTreeNode,
  useRefBindingNames: Set<string>,
  localBindingNames: Set<string>,
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
  if (rootName !== null && MUTABLE_GLOBAL_ROOTS.has(rootName) && !localBindingNames.has(rootName)) {
    return { kind: "global", rootName };
  }
  return null;
};

export const noMutableInDeps = defineRule({
  id: "no-mutable-in-deps",
  title: "Mutable value in effect dependencies",
  severity: "error",
  recommendation:
    "Read mutable values like `location.pathname` or `ref.current` inside the effect body, or subscribe with `useSyncExternalStore`. Changing them doesn't redraw the screen, so listing them in deps won't make the effect run again.",
  create: (context: RuleContext) => {
    const checkComponent = (
      componentBody: EsTreeNode | null | undefined,
      componentParams: ReadonlyArray<EsTreeNode> = [],
    ): void => {
      if (!componentBody || !isNodeOfType(componentBody, "BlockStatement")) return;
      const useRefBindingNames = collectUseRefBindingNames(componentBody, context.scopes);
      const localBindingNames = collectLocalBindingNames(componentBody);
      for (const param of componentParams) collectPatternNames(param, localBindingNames);

      walkAst(componentBody, (child: EsTreeNode) => {
        if (!isNodeOfType(child, "CallExpression")) return;
        if (!isReactHookCall(child, HOOKS_WITH_DEPS, context.scopes)) return;
        if ((child.arguments?.length ?? 0) < 2) return;
        const depsNode = child.arguments[1];
        if (!isNodeOfType(depsNode, "ArrayExpression")) return;

        for (const element of depsNode.elements ?? []) {
          if (!element) continue;
          const issue = findMutableDepIssue(element, useRefBindingNames, localBindingNames);
          if (!issue) continue;
          if (issue.kind === "ref-current") {
            context.report({
              node: element,
              message: `Changing "${issue.rootName}.current" does not re-render the component, so this dependency will not make the effect run again.`,
            });
          } else {
            context.report({
              node: element,
              message: `Values like "${issue.rootName}.*" can change without re-rendering the component, so this dependency will not make the effect run again.`,
            });
          }
        }
      });
    };

    return {
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        checkComponent(node.body, node.params);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isComponentAssignment(node)) return;
        if (
          !isNodeOfType(node.init, "ArrowFunctionExpression") &&
          !isNodeOfType(node.init, "FunctionExpression")
        )
          return;
        checkComponent(node.init.body, node.init.params);
      },
    };
  },
});
