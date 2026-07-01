import { HOOK_NAME_PATTERN } from "../../constants/react.js";
import { containsJsxElement } from "../../utils/contains-jsx-element.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactComponentName } from "../../utils/is-react-component-name.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";

// A function destructuring `{ children }` is only a Preact/React component
// (where `children` is VNode children) when there's corroborating evidence:
// a component/hook name, or a body that renders JSX. A plain helper like
// `flattenTree({ children })` over a tree-node data array has neither, so its
// `children.flatMap(...)` is a normal array operation, not Preact children.
const isComponentLikeFunction = (functionNode: EsTreeNode): boolean => {
  let name: string | null = null;
  if (isNodeOfType(functionNode, "FunctionDeclaration") && functionNode.id) {
    name = functionNode.id.name;
  } else {
    const parent = functionNode.parent;
    if (isNodeOfType(parent, "VariableDeclarator") && isNodeOfType(parent.id, "Identifier")) {
      name = parent.id.name;
    }
  }
  if (name && (isReactComponentName(name) || HOOK_NAME_PATTERN.test(name))) return true;
  const body = "body" in functionNode ? functionNode.body : null;
  return body && isAstNode(body) ? containsJsxElement(body) : false;
};

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
  "Your users hit a crash when `props.children` is not an array in Preact, so use `toChildArray(children)` from `preact` before calling array methods or reading `.length`.";

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
      const destructuresChildren = firstParam.properties.some(
        (property) =>
          isNodeOfType(property, "Property") &&
          isNodeOfType(property.key, "Identifier") &&
          property.key.name === "children",
      );
      return destructuresChildren && isComponentLikeFunction(cursor);
    }
    cursor = cursor.parent ?? null;
  }
  return false;
};

// Walks up to the nearest enclosing function and checks it looks like a
// component/hook. `props.children` / `this.props.children` are only Preact
// VNode children inside a component; a plain data helper reading a tree
// node's `children` array (`flattenTree(props)`) is not.
const isInsideComponentLikeFunction = (node: EsTreeNode): boolean => {
  const enclosing = findEnclosingFunction(node);
  return enclosing ? isComponentLikeFunction(enclosing) : false;
};

// Matches the `children` tail of `props.children`, `this.props.children`,
// or destructured `{ children }` accessed as `children.<method>`.
const isChildrenMemberExpression = (
  node: EsTreeNodeOfType<"MemberExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const object = node.object;
  if (!isNodeOfType(object, "MemberExpression")) {
    // Direct `children.map(...)` — only when the identifier traces back
    // to a destructured function parameter like `({ children }) => …`.
    // A bare `children` variable from any other source (DOM children,
    // tree children, etc.) is not Preact's `props.children`.
    if (!isNodeOfType(object, "Identifier") || object.name !== "children") return false;
    // A nearer local declaration (`const children = getItems()`) shadows the
    // prop — resolve the binding and bail when it isn't the parameter.
    const symbol = scopes.symbolFor(object);
    if (symbol && symbol.kind !== "parameter") return false;
    return isDestructuredChildrenParam(object);
  }

  // `props.children` or `this.props.children`
  if (!isNodeOfType(object.property, "Identifier") || object.property.name !== "children") {
    return false;
  }

  const propsObject = object.object;

  // `this.props.children` only exists in a class component — strong enough
  // evidence on its own (the `render()` method body need not contain JSX).
  if (
    isNodeOfType(propsObject, "MemberExpression") &&
    isNodeOfType(propsObject.property, "Identifier") &&
    propsObject.property.name === "props" &&
    isNodeOfType(propsObject.object, "ThisExpression")
  ) {
    return true;
  }

  // Plain `props.children` — gate on the enclosing function looking like a
  // component, mirroring the destructured `{ children }` path. A data helper
  // (`flattenTree(props)`) reading a tree node's `children` array is not it.
  if (isNodeOfType(propsObject, "Identifier") && propsObject.name === "props") {
    return isInsideComponentLikeFunction(node);
  }

  return false;
};

// In Preact, `props.children` is a single VNode (not an array) when there
// is exactly one child. Calling `.map()`, `.length`, `.forEach()`, etc. on
// it throws at runtime. The fix is `toChildArray(children)` from `preact`,
// which normalises the value to a flat array regardless of how many children
// exist. This rule flags direct array-method access on `props.children`,
// `this.props.children`, and destructured `children`.
export const preactNoChildrenLength = defineRule({
  id: "preact-no-children-length",
  title: "Array methods on Preact children can crash",
  requires: ["preact"],
  severity: "warn",
  recommendation:
    "Wrap with `toChildArray(children)` because Preact's `props.children` is not always an array and array methods can crash.",
  create: (context) => ({
    MemberExpression(node: EsTreeNodeOfType<"MemberExpression">) {
      if (node.computed) return;
      if (!isNodeOfType(node.property, "Identifier")) return;
      if (!ARRAY_READ_METHOD_NAMES.has(node.property.name)) return;
      if (!isChildrenMemberExpression(node, context.scopes)) return;
      context.report({ node, message: CHILDREN_ARRAY_MESSAGE });
    },
  }),
});
