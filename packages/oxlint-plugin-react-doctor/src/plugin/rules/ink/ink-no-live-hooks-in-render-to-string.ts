import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import { componentOrHookDisplayNameForFunction } from "../../utils/component-or-hook-display-name.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveInkApiName } from "../../utils/resolve-ink-api-name.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";

const LIVE_HOOK_NAMES = new Set([
  "useApp",
  "useCursor",
  "useFocus",
  "useFocusManager",
  "useInput",
  "usePaste",
  "useStderr",
  "useStdin",
  "useStdout",
  "useWindowSize",
]);

const collectRenderedComponentNames = (
  program: EsTreeNode,
  context: RuleContext,
): ReadonlySet<string> => {
  const componentNames = new Set<string>();
  walkAst(program, (descendantNode) => {
    if (
      !isNodeOfType(descendantNode, "CallExpression") ||
      resolveInkApiName(descendantNode.callee, context.scopes) !== "renderToString"
    ) {
      return;
    }
    const renderedNode = descendantNode.arguments[0];
    if (
      isNodeOfType(renderedNode, "JSXElement") &&
      isNodeOfType(renderedNode.openingElement.name, "JSXIdentifier")
    ) {
      componentNames.add(renderedNode.openingElement.name.name);
    }
  });
  return componentNames;
};

export const inkNoLiveHooksInRenderToString = defineRule({
  id: "ink-no-live-hooks-in-render-to-string",
  title: "Live terminal hook used during string rendering",
  severity: "error",
  minimumInkVersion: MINIMUM_INK_VERSIONS.renderToString,
  recommendation: "Keep `renderToString()` components independent of live terminal hooks.",
  create: (context) => ({
    Program(node: EsTreeNodeOfType<"Program">) {
      const renderedComponentNames = collectRenderedComponentNames(node, context);
      if (renderedComponentNames.size === 0) return;
      walkAst(node, (descendantNode) => {
        if (!isNodeOfType(descendantNode, "CallExpression")) return;
        const hookName = resolveInkApiName(descendantNode.callee, context.scopes);
        if (!hookName || !LIVE_HOOK_NAMES.has(hookName)) return;
        const componentFunction = findEnclosingFunction(descendantNode);
        const componentName = componentFunction
          ? componentOrHookDisplayNameForFunction(componentFunction)
          : null;
        if (!componentName || !renderedComponentNames.has(componentName)) return;
        context.report({
          node: descendantNode,
          message: `Ink \`${hookName}\` has no live terminal lifecycle under \`renderToString()\`.`,
        });
      });
    },
  }),
});
