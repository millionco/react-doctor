import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveInkApiName } from "../../utils/resolve-ink-api-name.js";
import {
  collectInkRenderCalls,
  resolveInkRenderCallsForNode,
} from "../../utils/resolve-ink-render-calls.js";
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

export const inkNoLiveHooksInRenderToString = defineRule({
  id: "ink-no-live-hooks-in-render-to-string",
  title: "Live terminal hook used during string rendering",
  severity: "error",
  minimumInkVersion: MINIMUM_INK_VERSIONS.renderToString,
  recommendation: "Keep `renderToString()` components independent of live terminal hooks.",
  create: (context) => ({
    Program(node: EsTreeNodeOfType<"Program">) {
      const renderCalls = collectInkRenderCalls(node, context, "renderToString");
      if (renderCalls.length === 0) return;
      walkAst(node, (descendantNode) => {
        if (!isNodeOfType(descendantNode, "CallExpression")) return;
        const hookName = resolveInkApiName(descendantNode.callee, context.scopes);
        if (!hookName || !LIVE_HOOK_NAMES.has(hookName)) return;
        const relatedRenderCalls = resolveInkRenderCallsForNode(
          descendantNode,
          renderCalls,
          context,
        );
        if (relatedRenderCalls.length === 0) return;
        context.report({
          node: descendantNode,
          message: `Ink \`${hookName}\` has no live terminal lifecycle under \`renderToString()\`.`,
        });
      });
    },
  }),
});
