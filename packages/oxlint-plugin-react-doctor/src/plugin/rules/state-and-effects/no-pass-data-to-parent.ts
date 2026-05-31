import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNamespacedApiCallee } from "../../utils/is-namespaced-api-call.js";
import { DATA_SINK_METHOD_NAMES } from "../../constants/data-sink-method-names.js";
import { getCallMethodName } from "../../utils/get-call-method-name.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  getArgsUpstreamRefs,
  getCallExpr,
  getUpstreamRefs,
  isSynchronous,
} from "./utils/effect/ast.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import {
  getEffectFn,
  getEffectFnRefs,
  hasCleanup,
  isConstant,
  isProp,
  isPropCall,
  isRefCall,
  isRefCurrent,
  isUseEffect,
} from "./utils/effect/react.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

// 1:1 port of upstream `src/rules/no-pass-data-to-parent.js`.

// Local mirror of upstream's inline `isUseState`/`isUseRef` checks
// that work on the *identifier* of an upstream ref (not on a ref).
const isUseStateIdentifier = (identifier: EsTreeNode): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  if (identifier.name === "useState") return true;
  const parent = (identifier as unknown as { parent?: EsTreeNode | null }).parent;
  if (
    parent &&
    isNodeOfType(parent, "MemberExpression") &&
    isNodeOfType(parent.object, "Identifier") &&
    parent.object.name === "React" &&
    isNodeOfType(parent.property, "Identifier") &&
    parent.property.name === "useState"
  ) {
    return true;
  }
  return false;
};

const isUseRefIdentifier = (identifier: EsTreeNode): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  if (identifier.name === "useRef") return true;
  const parent = (identifier as unknown as { parent?: EsTreeNode | null }).parent;
  if (
    parent &&
    isNodeOfType(parent, "MemberExpression") &&
    isNodeOfType(parent.object, "Identifier") &&
    parent.object.name === "React" &&
    isNodeOfType(parent.property, "Identifier") &&
    parent.property.name === "useRef"
  ) {
    return true;
  }
  return false;
};

export const noPassDataToParent = defineRule<Rule>({
  id: "no-pass-data-to-parent",
  title: "Data passed to parent via effect",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Fetch the data in the parent and pass it down as a prop (or return it from the hook), instead of handing it back up through a prop callback in a useEffect. See https://react.dev/learn/you-might-not-need-an-effect#passing-data-to-the-parent",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isUseEffect(node)) return;
      const analysis = getProgramAnalysis(node);
      if (!analysis) return;
      if (hasCleanup(analysis, node)) return;
      const effectFnRefs = getEffectFnRefs(analysis, node);
      if (!effectFnRefs) return;
      const effectFn = getEffectFn(analysis, node);
      if (!effectFn) return;

      for (const ref of effectFnRefs) {
        if (!isPropCall(analysis, ref)) continue;
        if (isRefCall(analysis, ref)) continue;
        if (!isSynchronous(ref.identifier as unknown as EsTreeNode, effectFn)) continue;
        const callExpr = getCallExpr(ref);
        if (!callExpr) continue;

        // Skip well-known prototype/observer/promise methods —
        // `props.items.forEach(fn)`, `props.store.subscribe(fn)`,
        // `props.fetcher.then(fn)` are NOT "passing data to a parent
        // via a callback", they're iteration / subscription /
        // chaining patterns that happen to receive a callback. The
        // rule's intent is `props.onDataLoaded(data)` style hand-back,
        // which never uses these method names.
        const calleeNode = (callExpr as unknown as { callee?: EsTreeNode }).callee;
        const methodName = calleeNode ? getCallMethodName(calleeNode) : null;
        if (methodName && DATA_SINK_METHOD_NAMES.has(methodName)) continue;
        // `editor.commands.setSelection(...)`, `props.store.dispatch(...)`,
        // `props.queryClient.invalidate(...)` etc. — calling a method
        // on a namespaced API object, not handing data back to a parent.
        if (calleeNode && isNamespacedApiCallee(calleeNode)) continue;

        const argsUpstreamRefs = getArgsUpstreamRefs(analysis, ref).filter(
          (argRef) => getUpstreamRefs(analysis, argRef).length === 1,
        );

        const isSomeArgsData = argsUpstreamRefs.some((argRef) => {
          if (isUseStateIdentifier(argRef.identifier as unknown as EsTreeNode)) return false;
          if (isProp(analysis, argRef)) return false;
          if (isUseRefIdentifier(argRef.identifier as unknown as EsTreeNode)) return false;
          if (isRefCurrent(argRef)) return false;
          if (isConstant(argRef)) return false;
          return true;
        });
        if (!isSomeArgsData) continue;

        context.report({
          node: callExpr,
          message:
            "Handing data back to a parent from a useEffect costs your users an extra render.",
        });
      }
    },
  }),
});
