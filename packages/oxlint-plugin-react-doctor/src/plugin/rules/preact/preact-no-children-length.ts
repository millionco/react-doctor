import { HOOK_NAME_PATTERN } from "../../constants/react.js";
import { containsJsxElement } from "../../utils/contains-jsx-element.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getFunctionBindingName } from "../../utils/get-function-binding-name.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { isCreateElementCall } from "../../utils/is-create-element-call.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactComponentName } from "../../utils/is-react-component-name.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";

// Preact components are also authored without JSX: `h(...)` (the classic
// hyperscript export) and `createElement(...)` both produce VNodes, so a
// body built from them is render evidence just like a JSX body.
const containsVnodeFactoryCall = (root: EsTreeNode): boolean => {
  let didFindFactoryCall = false;
  walkAst(root, (node) => {
    if (didFindFactoryCall) return false;
    if (!isNodeOfType(node, "CallExpression")) return;
    if (
      (isNodeOfType(node.callee, "Identifier") && node.callee.name === "h") ||
      isCreateElementCall(node)
    ) {
      didFindFactoryCall = true;
      return false;
    }
  });
  return didFindFactoryCall;
};

// A function destructuring `{ children }` is only a Preact/React component
// (where `children` is VNode children) when there's corroborating evidence:
// a component/hook name, or a body that renders VNodes (JSX or
// h()/createElement calls). A plain helper like `flattenTree({ children })`
// over a tree-node data array has neither, so its `children.flatMap(...)`
// is a normal array operation, not Preact children.
const isComponentLikeFunction = (functionNode: EsTreeNode): boolean => {
  const bindingName = getFunctionBindingName(functionNode);
  if (bindingName && (isReactComponentName(bindingName) || HOOK_NAME_PATTERN.test(bindingName))) {
    return true;
  }
  const body = "body" in functionNode ? functionNode.body : null;
  if (!body || !isAstNode(body)) return false;
  return containsJsxElement(body) || containsVnodeFactoryCall(body);
};

// Any ancestor function of `node` (inclusive of the nearest) that looks
// like a component/hook.
const hasComponentLikeAncestorFunction = (node: EsTreeNode): boolean => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor) {
    if (isFunctionLike(cursor) && isComponentLikeFunction(cursor)) return true;
    cursor = cursor.parent ?? null;
  }
  return false;
};

// The declaring function itself being component-like is the strong signal.
// An anonymous declaring function (a callback, a `memo(...)` body) inherits
// component-likeness from an ancestor; a NAMED non-component function
// (`flattenTree`) is negative evidence and does not.
const isDeclaringFunctionComponentLike = (declaringFunction: EsTreeNode): boolean => {
  if (isComponentLikeFunction(declaringFunction)) return true;
  if (getFunctionBindingName(declaringFunction) !== null) return false;
  return hasComponentLikeAncestorFunction(declaringFunction);
};

const destructuresChildrenAsFirstParam = (functionNode: EsTreeNode): boolean => {
  if (!isFunctionLike(functionNode)) return false;
  const firstParam = functionNode.params[0];
  if (!firstParam || !isNodeOfType(firstParam, "ObjectPattern")) return false;
  return firstParam.properties.some(
    (property) =>
      isNodeOfType(property, "Property") &&
      isNodeOfType(property.key, "Identifier") &&
      property.key.name === "children",
  );
};

// The function whose first parameter destructures a `children` property —
// the `({ children }) => …` pattern that signals a component receiving
// props. Resolved via the identifier's binding (so reads inside nested
// callbacks still map back to the declaring component), falling back to an
// ancestor walk when the binding can't be resolved.
const findChildrenDestructuringFunction = (
  identifier: EsTreeNodeOfType<"Identifier">,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  const symbol = scopes.symbolFor(identifier);
  if (symbol) {
    if (symbol.kind !== "parameter") return null;
    const declaringFunction = findEnclosingFunction(symbol.bindingIdentifier);
    if (declaringFunction && destructuresChildrenAsFirstParam(declaringFunction)) {
      return declaringFunction;
    }
    return null;
  }
  let cursor: EsTreeNode | null | undefined = identifier.parent;
  while (cursor) {
    if (isFunctionLike(cursor)) {
      if (destructuresChildrenAsFirstParam(cursor)) return cursor;
      return null;
    }
    cursor = cursor.parent ?? null;
  }
  return null;
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
    const declaringFunction = findChildrenDestructuringFunction(object, scopes);
    return declaringFunction ? isDeclaringFunctionComponentLike(declaringFunction) : false;
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

  // Plain `props.children` — gate on the function DECLARING the `props`
  // binding looking like a component (not the nearest enclosing function,
  // which may be an event handler or hook callback). A data helper
  // (`flattenTree(props)`) reading a tree node's `children` array is not it.
  if (isNodeOfType(propsObject, "Identifier") && propsObject.name === "props") {
    const symbol = scopes.symbolFor(propsObject);
    if (symbol) {
      if (symbol.kind !== "parameter") return false;
      const declaringFunction = findEnclosingFunction(symbol.bindingIdentifier);
      return declaringFunction ? isDeclaringFunctionComponentLike(declaringFunction) : false;
    }
    return hasComponentLikeAncestorFunction(node);
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
