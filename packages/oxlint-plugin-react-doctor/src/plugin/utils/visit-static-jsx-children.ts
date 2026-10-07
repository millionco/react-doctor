import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export interface StaticJsxChildrenCallbacks {
  // Called for every element reachable through static rendering structure.
  // Return false to skip the element's own children; anything else recurses.
  onElement: (element: EsTreeNodeOfType<"JSXElement">) => boolean | void;
  // Called for a child expression that renders content the walk cannot
  // statically enumerate ({children}, calls, member reads, spreads).
  onOpaqueExpression?: (expression: EsTreeNode) => void;
  // Called with the value of statically-known rendered text: non-whitespace
  // JSXText and string/number/template children.
  onStaticText?: (textValue: string) => void;
}

const visitExpression = (
  rawExpression: EsTreeNode,
  callbacks: StaticJsxChildrenCallbacks,
): void => {
  const expression = stripParenExpression(rawExpression);
  if (isNodeOfType(expression, "JSXElement")) {
    visitElement(expression, callbacks);
    return;
  }
  if (isNodeOfType(expression, "JSXFragment")) {
    visitStaticJsxChildren(expression.children, callbacks);
    return;
  }
  if (isNodeOfType(expression, "ConditionalExpression")) {
    visitExpression(expression.consequent, callbacks);
    visitExpression(expression.alternate, callbacks);
    return;
  }
  if (isNodeOfType(expression, "LogicalExpression")) {
    // `guard && <Jsx/>` renders the right side (the left renders only when
    // falsy, i.e. nothing-ish); `||` / `??` can render either side.
    if (expression.operator !== "&&") {
      visitExpression(expression.left, callbacks);
    }
    visitExpression(expression.right, callbacks);
    return;
  }
  if (isNodeOfType(expression, "ArrayExpression")) {
    for (const element of expression.elements) {
      if (!element) continue;
      if (isNodeOfType(element, "SpreadElement")) {
        callbacks.onOpaqueExpression?.(element);
      } else {
        visitExpression(element, callbacks);
      }
    }
    return;
  }
  if (isNodeOfType(expression, "Literal")) {
    if (typeof expression.value === "string" || typeof expression.value === "number") {
      const textValue = String(expression.value);
      if (textValue.trim().length > 0) callbacks.onStaticText?.(textValue);
    }
    return;
  }
  if (isNodeOfType(expression, "TemplateLiteral")) {
    // A template child renders text no matter what its expressions hold.
    const textValue = expression.quasis
      .map((quasi) => quasi.value.cooked ?? quasi.value.raw ?? "")
      .join(" ");
    if (textValue.trim().length > 0 || expression.expressions.length > 0) {
      callbacks.onStaticText?.(textValue);
    }
    return;
  }
  if (
    isNodeOfType(expression, "JSXEmptyExpression") ||
    (isNodeOfType(expression, "Identifier") && expression.name === "undefined")
  ) {
    return;
  }
  callbacks.onOpaqueExpression?.(expression);
};

const visitElement = (
  element: EsTreeNodeOfType<"JSXElement">,
  callbacks: StaticJsxChildrenCallbacks,
): void => {
  if (callbacks.onElement(element) === false) return;
  visitStaticJsxChildren(element.children, callbacks);
};

// Walks the statically-visible rendering structure below a JSX element's
// children: nested elements, fragments, and the JSX reachable through
// conditional, logical, and array expression children. Callbacks classify
// what the walker cannot: which elements match, which are opaque wrappers,
// and what rendered text means for the rule's claim.
export const visitStaticJsxChildren = (
  children: ReadonlyArray<EsTreeNode>,
  callbacks: StaticJsxChildrenCallbacks,
): void => {
  for (const child of children) {
    if (isNodeOfType(child, "JSXElement")) {
      visitElement(child, callbacks);
    } else if (isNodeOfType(child, "JSXFragment")) {
      visitStaticJsxChildren(child.children, callbacks);
    } else if (isNodeOfType(child, "JSXExpressionContainer")) {
      visitExpression(child.expression, callbacks);
    } else if (isNodeOfType(child, "JSXText")) {
      if (child.value.trim().length > 0) callbacks.onStaticText?.(child.value);
    }
  }
};
