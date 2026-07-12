import { LOOP_TYPES, MUTATING_ARRAY_METHODS } from "../../constants/js.js";
import { createLoopAwareVisitors } from "../../utils/create-loop-aware-visitors.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isInlineFunctionExpression } from "../../utils/is-inline-function-expression.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { resolveFirstArgumentBinding } from "../../utils/resolve-first-argument-binding.js";
import { walkAst } from "../../utils/walk-ast.js";

// Only a predicate that tests a SINGLE equality on one field
// (`item.id === target` / `item === target`) can be replaced by a `Map`
// keyed on that field. Range checks (`sc >= b.min`), multi-condition
// predicates (`a && b`), or any non-equality body have no Map equivalent,
// so reporting them would be a false positive. This also skips the
// database / ORM `.find({ where: … })` overload (object arg, not a
// callback) and bare `collection.find()`.
const referencesParameter = (
  expression: EsTreeNode | null | undefined,
  parameterName: string,
): boolean => {
  if (!expression) return false;
  if (isNodeOfType(expression, "Identifier")) return expression.name === parameterName;
  if (isNodeOfType(expression, "MemberExpression"))
    return referencesParameter(expression.object, parameterName);
  return false;
};

const isSingleFieldEqualityPredicate = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  const callback = node.arguments?.[0] as EsTreeNode | undefined;
  if (!isInlineFunctionExpression(callback)) return false;
  const firstParameter = resolveFirstArgumentBinding(callback.params?.[0]);
  if (!firstParameter || !isNodeOfType(firstParameter, "Identifier")) return false;

  let predicate: EsTreeNode | null = null;
  const body = callback.body;
  if (isNodeOfType(body, "BlockStatement")) {
    const statements = body.body ?? [];
    if (statements.length !== 1) return false;
    const onlyStatement = statements[0];
    if (!isNodeOfType(onlyStatement, "ReturnStatement") || !onlyStatement.argument) return false;
    predicate = onlyStatement.argument as EsTreeNode;
  } else {
    predicate = body as EsTreeNode;
  }

  if (
    !isNodeOfType(predicate, "BinaryExpression") ||
    (predicate.operator !== "===" && predicate.operator !== "==")
  ) {
    return false;
  }
  return (
    referencesParameter(predicate.left as EsTreeNode, firstParameter.name) ||
    referencesParameter(predicate.right as EsTreeNode, firstParameter.name)
  );
};

// Names that change every iteration of an enclosing loop: the
// for…of / for…in binding plus anything (re)assigned or declared
// inside the loop body. When the `.find()` receiver roots at one of
// these, the receiver is a different array each pass, so a single
// pre-loop Map can't replace it — flagging it would be a false
// positive. The set is a pure function of the (immutable) loop subtree, so
// it is memoized per loop node — nested `.find()`s under the same loops
// reuse one walk instead of re-collecting per call site.
const loopBoundNamesCache = new WeakMap<EsTreeNode, ReadonlySet<string>>();

const getLoopBoundNames = (loop: EsTreeNode): ReadonlySet<string> => {
  const cached = loopBoundNamesCache.get(loop);
  if (cached) return cached;
  const names = new Set<string>();
  if ((isNodeOfType(loop, "ForOfStatement") || isNodeOfType(loop, "ForInStatement")) && loop.left) {
    walkAst(loop.left, (child: EsTreeNode) => {
      if (isNodeOfType(child, "Identifier")) names.add(child.name);
    });
  }
  walkAst(loop, (child: EsTreeNode) => {
    // A binding declared inside a nested function (a callback, a nested
    // component) belongs to that scope, not the loop iteration, so it does
    // not make the outer `.find()` receiver loop-varying. Don't descend into
    // nested function scopes.
    if (child !== loop && isFunctionLike(child)) return false;
    if (isNodeOfType(child, "VariableDeclarator") && child.id) {
      walkAst(child.id, (idNode: EsTreeNode) => {
        if (isNodeOfType(idNode, "Identifier")) names.add(idNode.name);
      });
      return;
    }
    if (isNodeOfType(child, "AssignmentExpression")) {
      const targetRoot = getRootIdentifierName(child.left);
      if (targetRoot) names.add(targetRoot);
      return;
    }
    // `accumulator.push(item)` / `.sort()` inside the loop — the array
    // the `.find()` scans changes every pass, so a pre-loop Map would go
    // stale (docs-validation r2: cloudscape drilldown groupedSeriesData,
    // freecut newTracks). Mutation counts the same as reassignment.
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "MemberExpression") &&
      isNodeOfType(child.callee.property, "Identifier") &&
      MUTATING_ARRAY_METHODS.has(child.callee.property.name)
    ) {
      const mutatedRoot = getRootIdentifierName(child.callee.object);
      if (mutatedRoot) names.add(mutatedRoot);
    }
  });
  loopBoundNamesCache.set(loop, names);
  return names;
};

// `groups[i].links.find(...)` — the chain roots at an invariant name,
// but the computed index (`i`) varies per iteration, so the receiver is
// a different array each pass.
const hasLoopBoundComputedIndex = (
  receiver: EsTreeNode | null | undefined,
  loopBoundNames: ReadonlySet<string>,
): boolean => {
  let cursor: EsTreeNode | null | undefined = receiver;
  while (cursor) {
    cursor = stripParenExpression(cursor);
    if (!isNodeOfType(cursor, "MemberExpression")) break;
    if (cursor.computed && cursor.property) {
      let doesIndexReferenceLoopBoundName = false;
      walkAst(cursor.property as EsTreeNode, (child: EsTreeNode) => {
        if (isNodeOfType(child, "Identifier") && loopBoundNames.has(child.name)) {
          doesIndexReferenceLoopBoundName = true;
        }
      });
      if (doesIndexReferenceLoopBoundName) return true;
    }
    cursor = cursor.object;
  }
  return false;
};

// `CASE_EVENT_FILTER_OPTIONS[type].options.find(...)` — a receiver
// rooted at a SCREAMING_SNAKE module constant is a fixed config/enum
// table, tiny by convention (docs-validation r2: enum-sized filter
// options rendered as badges). The doc's tiny-N carve-out ("< ~10
// items — linear scan beats Map allocation") applies; growing data
// arrays are not named like constants.
const SCREAMING_SNAKE_PATTERN = /^[A-Z][A-Z0-9_]+$/;

const isConstantTableReceiver = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  if (!isNodeOfType(node.callee, "MemberExpression")) return false;
  const receiverRoot = getRootIdentifierName(node.callee.object);
  return receiverRoot !== null && SCREAMING_SNAKE_PATTERN.test(receiverRoot);
};

const isLoopVariantReceiver = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  if (!isNodeOfType(node.callee, "MemberExpression")) return false;
  const receiver = node.callee.object;
  // A receiver that isn't rooted at a plain identifier (`getLinks(row).find`,
  // `this.rows.find`) may be recomputed every pass — bail rather than report.
  const receiverRoot = getRootIdentifierName(receiver);
  if (!receiverRoot) return true;

  const loopBoundNames = new Set<string>();
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor) {
    if (LOOP_TYPES.includes(ancestor.type)) {
      for (const name of getLoopBoundNames(ancestor)) loopBoundNames.add(name);
    }
    ancestor = ancestor.parent;
  }
  if (loopBoundNames.has(receiverRoot)) return true;
  return hasLoopBoundComputedIndex(receiver, loopBoundNames);
};

export const jsIndexMaps = defineRule({
  id: "js-index-maps",
  title: "array.find() inside a loop",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Build a `Map` once before the loop instead of calling `array.find(...)` inside it",
  create: (context: RuleContext) =>
    createLoopAwareVisitors({
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (
          !isNodeOfType(node.callee, "MemberExpression") ||
          !isNodeOfType(node.callee.property, "Identifier")
        )
          return;
        const methodName = node.callee.property.name;
        if (methodName !== "find" && methodName !== "findIndex") return;
        if (!isSingleFieldEqualityPredicate(node)) return;
        if (isConstantTableReceiver(node)) return;
        if (isLoopVariantReceiver(node)) return;
        context.report({
          node,
          message: `This gets slow as your list grows because array.${methodName}() runs inside a loop, so build a Map once before the loop for instant lookups`,
        });
      },
    }),
});
