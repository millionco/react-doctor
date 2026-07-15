import { HTML_TAGS } from "../constants/html-tags.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getElementType } from "./get-element-type.js";
import { hasJsxPropIgnoreCase } from "./has-jsx-prop-ignore-case.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

interface ContentEditablePossibilities {
  canBeDisabled: boolean;
  canBeEnabled: boolean;
  canBeInherited: boolean;
}

const ENABLED_CONTENT_EDITABLE_VALUES: ReadonlySet<string> = new Set([
  "",
  "plaintext-only",
  "true",
]);

const ENABLED_CONTENT_EDITABLE: ContentEditablePossibilities = {
  canBeDisabled: false,
  canBeEnabled: true,
  canBeInherited: false,
};

const DISABLED_CONTENT_EDITABLE: ContentEditablePossibilities = {
  canBeDisabled: true,
  canBeEnabled: false,
  canBeInherited: false,
};

const INHERITED_CONTENT_EDITABLE: ContentEditablePossibilities = {
  canBeDisabled: false,
  canBeEnabled: false,
  canBeInherited: true,
};

const UNKNOWN_CONTENT_EDITABLE: ContentEditablePossibilities = {
  canBeDisabled: true,
  canBeEnabled: true,
  canBeInherited: true,
};

const mergeContentEditablePossibilities = (
  left: ContentEditablePossibilities,
  right: ContentEditablePossibilities,
): ContentEditablePossibilities => ({
  canBeDisabled: left.canBeDisabled || right.canBeDisabled,
  canBeEnabled: left.canBeEnabled || right.canBeEnabled,
  canBeInherited: left.canBeInherited || right.canBeInherited,
});

const resolveContentEditableExpression = (
  rawExpression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): ContentEditablePossibilities => {
  const expression = stripParenExpression(rawExpression);
  if (isNodeOfType(expression, "Literal")) {
    if (typeof expression.value === "boolean") {
      return expression.value ? ENABLED_CONTENT_EDITABLE : DISABLED_CONTENT_EDITABLE;
    }
    if (typeof expression.value === "string") {
      const contentEditableValue = expression.value.toLowerCase();
      if (ENABLED_CONTENT_EDITABLE_VALUES.has(contentEditableValue)) {
        return ENABLED_CONTENT_EDITABLE;
      }
      return contentEditableValue === "false"
        ? DISABLED_CONTENT_EDITABLE
        : INHERITED_CONTENT_EDITABLE;
    }
    return INHERITED_CONTENT_EDITABLE;
  }
  if (isNodeOfType(expression, "ConditionalExpression")) {
    return mergeContentEditablePossibilities(
      resolveContentEditableExpression(expression.consequent, scopes, visitedSymbolIds),
      resolveContentEditableExpression(expression.alternate, scopes, visitedSymbolIds),
    );
  }
  if (isNodeOfType(expression, "Identifier")) {
    const symbol = scopes.referenceFor(expression)?.resolvedSymbol;
    if (!symbol || visitedSymbolIds.has(symbol.id)) return UNKNOWN_CONTENT_EDITABLE;
    const initializer = getDirectConstInitializer(symbol);
    if (!initializer) return UNKNOWN_CONTENT_EDITABLE;
    const nextVisitedSymbolIds = new Set(visitedSymbolIds);
    nextVisitedSymbolIds.add(symbol.id);
    return resolveContentEditableExpression(initializer, scopes, nextVisitedSymbolIds);
  }
  return UNKNOWN_CONTENT_EDITABLE;
};

const getContentEditablePossibilities = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  scopes: ScopeAnalysis,
): ContentEditablePossibilities | null => {
  const attribute = hasJsxPropIgnoreCase(node.attributes, "contenteditable");
  if (!attribute) return null;
  if (!attribute.value) return ENABLED_CONTENT_EDITABLE;
  if (isNodeOfType(attribute.value, "Literal")) {
    return resolveContentEditableExpression(attribute.value, scopes, new Set());
  }
  if (isNodeOfType(attribute.value, "JSXExpressionContainer")) {
    return resolveContentEditableExpression(attribute.value.expression, scopes, new Set());
  }
  return UNKNOWN_CONTENT_EDITABLE;
};

const hasDefinitelyEnabledContentEditableAncestor = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  scopes: ScopeAnalysis,
  settings: Readonly<Record<string, unknown>> | undefined,
): boolean => {
  let ancestor = node.parent?.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXElement")) {
      const openingElement = ancestor.openingElement;
      if (!HTML_TAGS.has(getElementType(openingElement, settings))) return false;
      const possibilities = getContentEditablePossibilities(openingElement, scopes);
      if (possibilities) {
        if (
          possibilities.canBeEnabled &&
          !possibilities.canBeDisabled &&
          !possibilities.canBeInherited
        ) {
          return true;
        }
        const isDefinitelyInherited =
          possibilities.canBeInherited &&
          !possibilities.canBeDisabled &&
          !possibilities.canBeEnabled;
        if (!isDefinitelyInherited) return false;
      }
    }
    ancestor = ancestor.parent;
  }
  return false;
};

export const canContentEditableBeTabbable = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  scopes: ScopeAnalysis,
  settings: Readonly<Record<string, unknown>> | undefined,
): boolean => {
  const possibilities = getContentEditablePossibilities(node, scopes);
  if (!possibilities?.canBeEnabled) return false;
  return !hasDefinitelyEnabledContentEditableAncestor(node, scopes, settings);
};
