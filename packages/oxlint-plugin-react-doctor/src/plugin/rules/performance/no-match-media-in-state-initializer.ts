import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isGlobalMatchMediaCall } from "../../utils/is-global-match-media-call.js";
import { classifyReactNativeFileTarget } from "../../utils/is-react-native-file.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const REACT_USE_STATE_OPTIONS = {
  allowGlobalReactNamespace: true,
  allowUnboundBareCalls: false,
};

const isReactUseStateCall = (
  node: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => isReactApiCall(node, "useState", context.scopes, REACT_USE_STATE_OPTIONS);

const findDirectMatchMediaCall = (root: EsTreeNode, context: RuleContext): EsTreeNode | null => {
  let matchMediaCall: EsTreeNode | null = null;
  walkAst(root, (visitedNode) => {
    if (matchMediaCall) return false;
    if (isFunctionLike(visitedNode)) return false;
    if (isGlobalMatchMediaCall(visitedNode, context.scopes)) {
      matchMediaCall = visitedNode;
      return false;
    }
  });
  return matchMediaCall;
};

const findMatchMediaCallDuringInitialization = (
  initializer: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  const rootInitializer = stripParenExpression(initializer);
  if (!isFunctionLike(rootInitializer)) {
    return findDirectMatchMediaCall(rootInitializer, context);
  }
  if (rootInitializer.async || rootInitializer.generator) return null;
  return findDirectMatchMediaCall(rootInitializer.body, context);
};

export const noMatchMediaInStateInitializer = defineRule({
  id: "no-match-media-in-state-initializer",
  title: "matchMedia in state initializer",
  severity: "warn",
  category: "Correctness",
  requires: ["ssr"],
  recommendation:
    "Prefer CSS media queries for layout, or subscribe with `useSyncExternalStore` and provide a stable server snapshot.",
  create: (context: RuleContext): RuleVisitors => {
    if (isTestlikeFilename(context.filename)) return {};
    if (classifyReactNativeFileTarget(context) === "react-native") return {};

    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isReactUseStateCall(node, context)) return;
        const initializer = node.arguments?.[0];
        if (!initializer || initializer.type === "SpreadElement") return;
        const matchMediaCall = findMatchMediaCallDuringInitialization(initializer, context);
        if (!matchMediaCall) return;
        context.report({
          node: matchMediaCall,
          message:
            "`matchMedia()` in a useState initializer can cause an SSR crash or seed different server and hydration state. Prefer CSS media queries for layout, or use `useSyncExternalStore` with a stable server snapshot.",
        });
      },
    };
  },
});
