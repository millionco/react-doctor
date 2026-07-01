import { INDEX_PARAMETER_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const STRING_COERCION_FUNCTIONS = new Set(["String", "Number"]);

// Name of the index-shaped identifier a `key=` expression resolves to, or
// null. Mirrors the coverage of no-array-index-as-key's `extractIndexName`
// (bare identifier, `String(i)`/`Number(i)`, `i.toString()`, `` `${i}` ``)
// but returns the identifier regardless of whether the name is in the index
// set — the caller matches it against the map callback's single parameter.
const extractKeyIdentifierName = (node: EsTreeNode): string | null => {
  if (isNodeOfType(node, "Identifier")) return node.name;

  if (isNodeOfType(node, "TemplateLiteral")) {
    const expressions = node.expressions ?? [];
    if (expressions.length === 1 && isNodeOfType(expressions[0], "Identifier")) {
      return expressions[0].name;
    }
    return null;
  }

  if (
    isNodeOfType(node, "CallExpression") &&
    isNodeOfType(node.callee, "MemberExpression") &&
    isNodeOfType(node.callee.object, "Identifier") &&
    isNodeOfType(node.callee.property, "Identifier") &&
    node.callee.property.name === "toString"
  ) {
    return node.callee.object.name;
  }

  if (
    isNodeOfType(node, "CallExpression") &&
    isNodeOfType(node.callee, "Identifier") &&
    STRING_COERCION_FUNCTIONS.has(node.callee.name) &&
    isNodeOfType(node.arguments?.[0], "Identifier")
  ) {
    return node.arguments[0].name;
  }

  return null;
};

// `Array(n)` or `new Array(n)` — returns the length argument node so the
// caller can suppress the harmless single-element case (`Array(1)`).
const getArrayConstructorLengthArgument = (node: EsTreeNode): EsTreeNode | null => {
  const isArrayConstructor =
    (isNodeOfType(node, "CallExpression") || isNodeOfType(node, "NewExpression")) &&
    isNodeOfType(node.callee, "Identifier") &&
    node.callee.name === "Array";
  if (!isArrayConstructor) return null;
  return node.arguments?.[0] ?? null;
};

// Length argument of the `Array(n).fill(...)` / `new Array(n).fill(...)`
// receiver, or null when the receiver is not that shape.
const getFillReceiverLengthArgument = (receiver: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(receiver, "CallExpression")) return null;
  const callee = receiver.callee;
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    !isNodeOfType(callee.property, "Identifier") ||
    callee.property.name !== "fill"
  ) {
    return null;
  }
  return getArrayConstructorLengthArgument(callee.object);
};

// The nearest enclosing `.map(callback)` when the given node lives directly
// in that callback (not behind an intervening nested function), plus the
// receiver the `.map` was called on.
const findEnclosingMapCall = (
  node: EsTreeNode,
): { callback: EsTreeNode; receiver: EsTreeNode } | null => {
  let current = node;
  while (current.parent) {
    if (isFunctionLike(current)) {
      const parent = current.parent;
      if (
        isNodeOfType(parent, "CallExpression") &&
        parent.arguments.includes(current as never) &&
        isNodeOfType(parent.callee, "MemberExpression") &&
        isNodeOfType(parent.callee.property, "Identifier") &&
        parent.callee.property.name === "map"
      ) {
        return { callback: current, receiver: parent.callee.object };
      }
      return null;
    }
    current = current.parent;
  }
  return null;
};

export const noFillMapElementAsKey = defineRule({
  id: "no-fill-map-element-as-key",
  title: "fill().map() first param is the element, not the index",
  severity: "warn",
  recommendation:
    "After `.fill(value)` every element is identical, so a lone `.map((index) => …)` binds `index` to that value and gives every child the same key. Add the index as the second parameter: `.map((_, index) => …)`.",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "key") return;
      if (!node.value || !isNodeOfType(node.value, "JSXExpressionContainer")) return;

      const keyName = extractKeyIdentifierName(node.value.expression);
      if (!keyName || !INDEX_PARAMETER_NAMES.has(keyName)) return;

      const enclosingMap = findEnclosingMapCall(node);
      if (!enclosingMap) return;

      const parameters = (enclosingMap.callback as EsTreeNodeOfType<"ArrowFunctionExpression">)
        .params;
      if (parameters.length !== 1) return;
      const soleParameter = parameters[0];
      if (!isNodeOfType(soleParameter, "Identifier") || soleParameter.name !== keyName) return;

      const lengthArgument = getFillReceiverLengthArgument(enclosingMap.receiver);
      if (!lengthArgument) return;
      if (isNodeOfType(lengthArgument, "Literal") && lengthArgument.value === 1) return;

      context.report({
        node,
        message: `Every item in this list gets the same key because \`.fill()\` makes every element identical and "${keyName}" is bound to that element, not the position — add the index as the second parameter (\`.map((_, ${keyName}) => …)\`) so React can tell your list items apart.`,
      });
    },
  }),
});
