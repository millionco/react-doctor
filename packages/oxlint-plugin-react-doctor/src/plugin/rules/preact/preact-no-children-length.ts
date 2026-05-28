import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const ARRAY_READ_METHOD_NAMES = new Set([
  "length",
  "map",
  "forEach",
  "filter",
  "find",
  "reduce",
  "some",
  "every",
  "flat",
  "flatMap",
  "indexOf",
  "includes",
  "slice",
  "concat",
  "join",
]);

const CHILDREN_ARRAY_MESSAGE =
  "`props.children` is not always an array in Preact — use `toChildArray(children)` from `preact` before calling array methods or reading `.length`.";

// Walk up to the nearest enclosing function and check whether its first
// parameter destructures a `children` property — the `({ children }) => …`
// pattern that signals a React/Preact component receiving props.
const isDestructuredChildrenParam = (identifier: EsTreeNodeOfType<"Identifier">): boolean => {
  let cursor: EsTreeNode | null | undefined = identifier.parent;
  while (cursor) {
    if (
      isNodeOfType(cursor, "FunctionDeclaration") ||
      isNodeOfType(cursor, "FunctionExpression") ||
      isNodeOfType(cursor, "ArrowFunctionExpression")
    ) {
      const firstParam = cursor.params[0];
      if (!firstParam || !isNodeOfType(firstParam, "ObjectPattern")) return false;
      return firstParam.properties.some(
        (property) =>
          isNodeOfType(property, "Property") &&
          isNodeOfType(property.key, "Identifier") &&
          property.key.name === "children",
      );
    }
    cursor = cursor.parent ?? null;
  }
  return false;
};

// Matches the `children` tail of `props.children`, `this.props.children`,
// or destructured `{ children }` accessed as `children.<method>`.
const isChildrenMemberExpression = (node: EsTreeNodeOfType<"MemberExpression">): boolean => {
  const object = node.object;
  if (!isNodeOfType(object, "MemberExpression")) {
    // Direct `children.map(...)` — only when the identifier traces back
    // to a destructured function parameter like `({ children }) => …`.
    // A bare `children` variable from any other source (DOM children,
    // tree children, etc.) is not Preact's `props.children`.
    return (
      isNodeOfType(object, "Identifier") &&
      object.name === "children" &&
      isDestructuredChildrenParam(object)
    );
  }

  // `props.children` or `this.props.children`
  if (!isNodeOfType(object.property, "Identifier") || object.property.name !== "children") {
    return false;
  }

  const propsObject = object.object;
  if (isNodeOfType(propsObject, "Identifier") && propsObject.name === "props") return true;
  if (
    isNodeOfType(propsObject, "MemberExpression") &&
    isNodeOfType(propsObject.property, "Identifier") &&
    propsObject.property.name === "props" &&
    isNodeOfType(propsObject.object, "ThisExpression")
  ) {
    return true;
  }

  return false;
};

// In Preact, `props.children` is a single VNode (not an array) when there
// is exactly one child. Calling `.map()`, `.length`, `.forEach()`, etc. on
// it throws at runtime. The fix is `toChildArray(children)` from `preact`,
// which normalises the value to a flat array regardless of how many children
// exist. This rule flags direct array-method access on `props.children`,
// `this.props.children`, and destructured `children`.
export const preactNoChildrenLength = defineRule<Rule>({
  id: "preact-no-children-length",
  requires: ["preact"],
  severity: "warn",
  recommendation:
    "Wrap with `toChildArray(children)` from `preact` before accessing array methods or `.length`.",
  create: (context) => ({
    MemberExpression(node: EsTreeNodeOfType<"MemberExpression">) {
      if (node.computed) return;
      if (!isNodeOfType(node.property, "Identifier")) return;
      if (!ARRAY_READ_METHOD_NAMES.has(node.property.name)) return;
      if (!isChildrenMemberExpression(node)) return;
      context.report({ node, message: CHILDREN_ARRAY_MESSAGE });
    },
  }),
});
