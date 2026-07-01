import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "This reads a second property off `child.props`/`child.type` inside a `React.Children` iteration with no `isValidElement` guard; string, number, and boolean children have no `.props`/`.type`, so dereferencing them throws `TypeError` at render time once a caller interpolates text between elements. Narrow with `React.isValidElement(child)` (or a `typeof` string/number check) first.";

const CHILDREN_ITERATION_METHODS = new Set(["map", "forEach", "toArray"]);
const ARRAY_ITERATION_METHODS = new Set(["map", "filter", "forEach"]);
const ELEMENT_ONLY_BASE_PROPERTIES = new Set(["props", "type"]);

const isChildrenObject = (node: EsTreeNode): boolean => {
  const inner = stripParenExpression(node);
  if (isNodeOfType(inner, "Identifier")) return inner.name === "Children";
  return (
    isNodeOfType(inner, "MemberExpression") &&
    isNodeOfType(inner.property, "Identifier") &&
    inner.property.name === "Children"
  );
};

const isChildrenIterationCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = stripParenExpression(node.callee as EsTreeNode);
  return (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.property, "Identifier") &&
    CHILDREN_ITERATION_METHODS.has(callee.property.name) &&
    isChildrenObject(callee.object as EsTreeNode)
  );
};

// The callback whose param is a `React.Children`-iterated node: the second
// argument of `Children.map/forEach(...)`, or the first argument of a
// `.map`/`.filter`/`.forEach` chained onto a `Children.toArray(...)` result.
const getIteratedChildCallback = (node: EsTreeNodeOfType<"CallExpression">): EsTreeNode | null => {
  const callee = stripParenExpression(node.callee as EsTreeNode);
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return null;
  if (!isNodeOfType(callee.property, "Identifier")) return null;
  const methodName = callee.property.name;

  if (
    (methodName === "map" || methodName === "forEach") &&
    isChildrenObject(callee.object as EsTreeNode)
  ) {
    const callback = node.arguments[1];
    return callback ? stripParenExpression(callback as EsTreeNode) : null;
  }
  if (ARRAY_ITERATION_METHODS.has(methodName)) {
    const receiver = stripParenExpression(callee.object as EsTreeNode);
    if (isChildrenIterationCall(receiver)) {
      const callback = node.arguments[0];
      return callback ? stripParenExpression(callback as EsTreeNode) : null;
    }
  }
  return null;
};

const referencesParam = (node: EsTreeNode, paramName: string): boolean => {
  let found = false;
  walkAst(node, (child: EsTreeNode) => {
    if (found) return false;
    if (isNodeOfType(child, "Identifier") && child.name === paramName) {
      found = true;
      return false;
    }
  });
  return found;
};

// An `isValidElement`/`typeof`/optional-chaining/`get()` narrowing on the
// callback param anywhere in scope — the guarded idiom that must stay quiet.
const callbackHasGuard = (callback: EsTreeNode, paramName: string): boolean => {
  let guarded = false;
  walkAst(callback, (child: EsTreeNode) => {
    if (guarded) return;
    if (isNodeOfType(child, "CallExpression")) {
      const callee = child.callee;
      const calleeName = isNodeOfType(callee, "Identifier")
        ? callee.name
        : isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")
          ? callee.property.name
          : null;
      if (
        (calleeName === "isValidElement" || calleeName === "get") &&
        child.arguments.some((argument) => referencesParam(argument as EsTreeNode, paramName))
      ) {
        guarded = true;
      }
      return;
    }
    if (
      isNodeOfType(child, "UnaryExpression") &&
      child.operator === "typeof" &&
      referencesParam(child.argument as EsTreeNode, paramName)
    ) {
      guarded = true;
      return;
    }
    // Optional chaining on the param (`child?.props`) narrows the primitive arm.
    if (
      isNodeOfType(child, "MemberExpression") &&
      child.optional &&
      isNodeOfType(stripParenExpression(child.object as EsTreeNode), "Identifier") &&
      (stripParenExpression(child.object as EsTreeNode) as EsTreeNodeOfType<"Identifier">).name ===
        paramName
    ) {
      guarded = true;
    }
  });
  return guarded;
};

// A `child.props.X` / `child.type.X` double member read with no optional
// chaining — the shape that throws on a string/number child.
const findUnguardedDoubleAccess = (callback: EsTreeNode, paramName: string): EsTreeNode | null => {
  let offending: EsTreeNode | null = null;
  walkAst(callback, (child: EsTreeNode) => {
    if (offending) return false;
    if (!isNodeOfType(child, "MemberExpression") || child.optional) return;
    const base = child.object;
    if (!isNodeOfType(base, "MemberExpression") || base.optional || base.computed) return;
    if (!isNodeOfType(base.property, "Identifier")) return;
    if (!ELEMENT_ONLY_BASE_PROPERTIES.has(base.property.name)) return;
    if (!isNodeOfType(base.object, "Identifier") || base.object.name !== paramName) return;
    offending = child;
    return false;
  });
  return offending;
};

export const noChildrenMapMemberAccessWithoutIsvalidelementGuard = defineRule({
  id: "no-children-map-member-access-without-isvalidelement-guard",
  title: "Children member access without isValidElement guard",
  severity: "warn",
  category: "Correctness",
  requires: ["react"],
  recommendation:
    "Reading `child.props.X`/`child.type.X` inside a `React.Children` iteration throws on string/number/boolean children; filter with `React.isValidElement` (or narrow with a `typeof` string/number check) before touching element-only properties.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const callback = getIteratedChildCallback(node);
      if (!callback || !isFunctionLike(callback)) return;
      const firstParam = callback.params[0];
      if (!firstParam || !isNodeOfType(firstParam as EsTreeNode, "Identifier")) return;
      const paramName = (firstParam as EsTreeNodeOfType<"Identifier">).name;

      const body = callback.body as EsTreeNode;
      if (callbackHasGuard(body, paramName)) return;
      const offending = findUnguardedDoubleAccess(body, paramName);
      if (offending) context.report({ node: offending, message: MESSAGE });
    },
  }),
});
