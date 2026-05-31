import { defineRule } from "../../utils/define-rule.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { collectHandlerBindingNames } from "./utils/collect-handler-binding-names.js";
import { isInsideEventHandler } from "./utils/is-inside-event-handler.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const DEFERRABLE_HOOK_NAMES = new Set(["useSearchParams", "useParams", "usePathname"]);

const findHookCallBindings = (
  componentBody: EsTreeNode,
): Array<{ valueName: string; hookName: string; declarator: EsTreeNode }> => {
  const bindings: Array<{ valueName: string; hookName: string; declarator: EsTreeNode }> = [];
  if (!isNodeOfType(componentBody, "BlockStatement")) return bindings;

  for (const statement of componentBody.body ?? []) {
    if (!isNodeOfType(statement, "VariableDeclaration")) continue;
    for (const declarator of statement.declarations ?? []) {
      if (!isNodeOfType(declarator.id, "Identifier")) continue;
      if (!isNodeOfType(declarator.init, "CallExpression")) continue;
      const callee = declarator.init.callee;
      if (!isNodeOfType(callee, "Identifier")) continue;
      if (!DEFERRABLE_HOOK_NAMES.has(callee.name)) continue;
      bindings.push({
        valueName: declarator.id.name,
        hookName: callee.name,
        declarator,
      });
    }
  }
  return bindings;
};

// HACK: subscribing to `useSearchParams()` / `useParams()` /
// `usePathname()` makes the component re-render whenever the URL state
// changes — even when the component only reads the value inside an
// onClick / onSubmit handler. In that case the value is read at click
// time anyway; the subscription is wasted work.
//
// Better pattern: read inside the handler via the underlying API
// (`new URL(window.location.href).searchParams`), or build a small
// custom hook that exposes a `getSearchParams()` getter without
// subscribing. The result is fewer renders without losing the data.
//
// Heuristic: hook value-name appears only inside arrow / function
// expressions that are themselves bound to JSX `on*` attributes.
export const rerenderDeferReadsHook = defineRule<Rule>({
  id: "rerender-defer-reads-hook",
  title: "URL hook value only read in handlers",
  tags: ["test-noise"],
  severity: "warn",
  category: "Performance",
  recommendation:
    "Read the URL inside the handler (e.g. `new URL(window.location.href).searchParams`) so the component doesn't redraw every time the URL changes.",
  create: (context: RuleContext) => {
    const checkComponent = (componentBody: EsTreeNode | null | undefined): void => {
      if (!componentBody || !isNodeOfType(componentBody, "BlockStatement")) return;
      const bindings = findHookCallBindings(componentBody);
      if (bindings.length === 0) return;
      const handlerBindingNames = collectHandlerBindingNames(componentBody);

      for (const binding of bindings) {
        const referenceLocations: EsTreeNode[] = [];
        walkAst(componentBody, (child: EsTreeNode) => {
          if (
            isNodeOfType(binding.declarator, "VariableDeclarator") &&
            child === binding.declarator.id
          )
            return;
          if (isNodeOfType(child, "Identifier") && child.name === binding.valueName) {
            referenceLocations.push(child);
          }
        });

        if (referenceLocations.length === 0) continue;

        const allInHandlers = referenceLocations.every((ref) =>
          isInsideEventHandler(ref, handlerBindingNames),
        );
        if (!allInHandlers) continue;

        context.report({
          node: binding.declarator,
          message: `${binding.hookName}() redraws your component on every URL change even though it's only read inside event handlers.`,
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
