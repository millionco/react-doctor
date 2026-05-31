import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { findDownstreamNodes, getDownstreamRefs, getUpstreamRefs } from "./utils/effect/ast.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import { getEffectFnRefs, hasCleanup, isProp, isState, isUseEffect } from "./utils/effect/react.js";

const SETTER_NAME_PATTERN = /^set[A-Z]/;

// True for the preamble forms allowed inside a pure-early-exit
// consequent block: `setX(value)`, `setX?.(value)`, `props.onChange(value)`,
// or `xxxRef.current = value` (ref bookkeeping isn't event-handler-like).
const isSetterCallExpressionStatement = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "ExpressionStatement")) return false;
  let expression = node.expression as EsTreeNode | null;
  if (expression && isNodeOfType(expression, "ChainExpression")) {
    expression = expression.expression as EsTreeNode;
  }
  if (!expression) return false;
  if (isNodeOfType(expression, "CallExpression")) {
    const callee = expression.callee;
    if (isNodeOfType(callee, "Identifier")) {
      return SETTER_NAME_PATTERN.test(callee.name);
    }
    if (
      isNodeOfType(callee, "MemberExpression") &&
      isNodeOfType(callee.property, "Identifier") &&
      SETTER_NAME_PATTERN.test(callee.property.name)
    ) {
      return true;
    }
    return false;
  }
  if (isNodeOfType(expression, "AssignmentExpression")) {
    const left = expression.left;
    if (
      isNodeOfType(left, "MemberExpression") &&
      !left.computed &&
      isNodeOfType(left.property, "Identifier") &&
      left.property.name === "current" &&
      isNodeOfType(left.object, "Identifier")
    ) {
      return true;
    }
  }
  return false;
};

// `xxxRef.current` anywhere in the IF test marks the effect as a
// one-shot hydration / lazy-mount / scroll-restore guard, not an
// event-handler antipattern.
const REF_GUARD_SCAN_BUDGET = 50;

const containsRefGuard = (testNode: EsTreeNode): boolean => {
  const stack: EsTreeNode[] = [testNode];
  let budget = REF_GUARD_SCAN_BUDGET;
  while (stack.length > 0 && budget-- > 0) {
    const node = stack.pop()!;
    if (
      isNodeOfType(node, "MemberExpression") &&
      !node.computed &&
      isNodeOfType(node.property, "Identifier") &&
      node.property.name === "current" &&
      isNodeOfType(node.object, "Identifier")
    ) {
      const name = node.object.name;
      if (name === "ref" || name.endsWith("Ref") || name.endsWith("ref")) return true;
    }
    if (isNodeOfType(node, "LogicalExpression") || isNodeOfType(node, "BinaryExpression")) {
      stack.push(node.left as EsTreeNode, node.right as EsTreeNode);
    } else if (isNodeOfType(node, "UnaryExpression")) {
      stack.push(node.argument as EsTreeNode);
    } else if (isNodeOfType(node, "ConditionalExpression")) {
      stack.push(
        node.test as EsTreeNode,
        node.consequent as EsTreeNode,
        node.alternate as EsTreeNode,
      );
    } else if (isNodeOfType(node, "MemberExpression")) {
      stack.push(node.object as EsTreeNode);
    } else if (isNodeOfType(node, "ChainExpression")) {
      stack.push(node.expression as EsTreeNode);
    }
  }
  return false;
};

// "Side-effect-free exit": `return;`, `return null;`, `return X;` where
// X is a simple identifier/literal. `return fn()` is NOT — the call IS
// the work, just disguised.
const isSideEffectFreeExit = (statement: EsTreeNode): boolean => {
  if (isNodeOfType(statement, "ContinueStatement")) return true;
  if (isNodeOfType(statement, "BreakStatement")) return true;
  if (!isNodeOfType(statement, "ReturnStatement")) return false;
  const argument = statement.argument;
  if (!argument) return true;
  if (isNodeOfType(argument, "Literal")) return true;
  if (isNodeOfType(argument, "Identifier")) return true;
  if (isNodeOfType(argument, "UnaryExpression") && argument.operator === "void") return true;
  return false;
};

const isPureEarlyExitConsequent = (consequent: EsTreeNode): boolean => {
  if (
    isNodeOfType(consequent, "ReturnStatement") ||
    isNodeOfType(consequent, "ContinueStatement") ||
    isNodeOfType(consequent, "BreakStatement")
  ) {
    return isSideEffectFreeExit(consequent);
  }
  if (isNodeOfType(consequent, "BlockStatement")) {
    const body = consequent.body ?? [];
    // An empty `if (cond) {}` is NOT a pure early-exit guard — it's
    // either dead code or a guarded-no-op around following work. Either
    // way it doesn't justify skipping the rule.
    if (body.length === 0) return false;
    const last = body[body.length - 1] as EsTreeNode;
    if (!isSideEffectFreeExit(last)) return false;
    // Allow any number of setter-only preamble statements:
    //   if (!enabled) { setLocal(initial); setLoading(false); return; }
    for (let i = 0; i < body.length - 1; i++) {
      if (!isSetterCallExpressionStatement(body[i] as EsTreeNode)) return false;
    }
    return true;
  }
  return false;
};

// 1:1 port of upstream `src/rules/no-event-handler.js`, narrowed to
// skip pure early-exit guard patterns (`if (!enabled) return;`) and
// one-shot ref-guarded effects (`if (wrapperRef.current && ...)`).
export const noEventHandler = defineRule<Rule>({
  id: "no-event-handler",
  title: "Event logic handled in an effect",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Run the side effect in the event handler that triggers it, instead of watching its state from a useEffect. See https://react.dev/learn/you-might-not-need-an-effect#sharing-logic-between-event-handlers",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isUseEffect(node)) return;
      const analysis = getProgramAnalysis(node);
      if (!analysis) return;
      if (hasCleanup(analysis, node)) return;
      const effectFnRefs = getEffectFnRefs(analysis, node);
      if (!effectFnRefs) return;

      const ifStatementsNoElse = findDownstreamNodes(node, "IfStatement").filter(
        (ifNode) =>
          isNodeOfType(ifNode, "IfStatement") &&
          !ifNode.alternate &&
          !isPureEarlyExitConsequent(ifNode.consequent as EsTreeNode) &&
          !containsRefGuard(ifNode.test as EsTreeNode),
      );
      const ifTestRefs = ifStatementsNoElse.flatMap((ifNode) => {
        if (!isNodeOfType(ifNode, "IfStatement")) return [];
        return getDownstreamRefs(analysis, ifNode.test as EsTreeNode).flatMap((ref) =>
          getUpstreamRefs(analysis, ref),
        );
      });

      // Dedupe by resolved binding (not identifier identity) so a
      // single useEffect use of a prop doesn't emit one diagnostic per
      // reference site in the file.
      const seenBindings = new Set<unknown>();
      const seenIdentifiers = new Set<EsTreeNode>();
      const dedupedRefs = ifTestRefs.filter((ref) => {
        const identifier = ref.identifier as unknown as EsTreeNode;
        if (!identifier) return false;
        const resolved = (ref as unknown as { resolved?: unknown }).resolved;
        if (resolved && seenBindings.has(resolved)) return false;
        if (resolved) seenBindings.add(resolved);
        if (seenIdentifiers.has(identifier)) return false;
        seenIdentifiers.add(identifier);
        return true;
      });

      for (const ref of dedupedRefs) {
        if (isState(analysis, ref)) {
          context.report({
            node: ref.identifier as unknown as EsTreeNode,
            message:
              "Faking an event handler with state plus a useEffect costs an extra render & runs late.",
          });
        }
      }
      for (const ref of dedupedRefs) {
        if (isProp(analysis, ref)) {
          context.report({
            node: ref.identifier as unknown as EsTreeNode,
            message:
              "Faking an event handler with a prop plus a useEffect costs an extra render & runs late.",
          });
        }
      }
    },
  }),
});
