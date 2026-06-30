import { createLoopAwareVisitors } from "../../utils/create-loop-aware-visitors.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

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
  if (
    !callback ||
    (!isNodeOfType(callback, "ArrowFunctionExpression") &&
      !isNodeOfType(callback, "FunctionExpression"))
  ) {
    return false;
  }
  const firstParameter = callback.params?.[0];
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
        context.report({
          node,
          message: `This gets slow as your list grows because array.${methodName}() runs inside a loop, so build a Map once before the loop for instant lookups`,
        });
      },
    }),
});
