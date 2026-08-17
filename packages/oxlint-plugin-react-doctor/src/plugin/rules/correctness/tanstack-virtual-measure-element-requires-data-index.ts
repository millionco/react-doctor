import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticStringExpression } from "../../utils/get-static-string-expression.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { resolveImportedApiReference } from "../../utils/resolve-imported-api-reference.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const TANSTACK_VIRTUAL_MODULE = "@tanstack/react-virtual";
const VIRTUALIZER_HOOK_NAMES: ReadonlySet<string> = new Set([
  "useVirtualizer",
  "useWindowVirtualizer",
]);
const MEASURE_ELEMENT_NAME = "measureElement";
const DEFAULT_INDEX_ATTRIBUTE = "data-index";

const isVirtualizerHookCall = (node: EsTreeNode, context: RuleContext): boolean => {
  const expression = stripParenExpression(node);
  if (!isNodeOfType(expression, "CallExpression")) return false;
  const reference = resolveImportedApiReference(expression.callee, context.scopes);
  return Boolean(
    reference?.source === TANSTACK_VIRTUAL_MODULE &&
    reference.importedName &&
    VIRTUALIZER_HOOK_NAMES.has(reference.importedName),
  );
};

const resolveOptionsObject = (
  rawExpression: EsTreeNode,
  context: RuleContext,
): EsTreeNodeOfType<"ObjectExpression"> | null => {
  const expression = stripParenExpression(rawExpression);
  if (isNodeOfType(expression, "ObjectExpression")) return expression;
  if (!isNodeOfType(expression, "Identifier")) return null;
  const symbol = resolveConstIdentifierAlias(expression, context.scopes);
  if (symbol?.kind !== "const" || !symbol.initializer) return null;
  const initializer = stripParenExpression(symbol.initializer);
  return isNodeOfType(initializer, "ObjectExpression") ? initializer : null;
};

const getVirtualizerIndexAttribute = (
  hookCall: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): string | null => {
  const optionsArgument = hookCall.arguments[0];
  if (!optionsArgument) return null;
  const options = resolveOptionsObject(optionsArgument, context);
  if (!options) return null;
  let indexAttribute: string | null = DEFAULT_INDEX_ATTRIBUTE;
  for (const property of options.properties) {
    if (isNodeOfType(property, "SpreadElement")) {
      indexAttribute = null;
      continue;
    }
    if (
      isNodeOfType(property, "Property") &&
      getStaticPropertyKeyName(property) === "indexAttribute"
    ) {
      indexAttribute = getStaticStringExpression(property.value);
    }
  }
  return indexAttribute;
};

const getVirtualizerHookCall = (
  rawExpression: EsTreeNode,
  context: RuleContext,
): EsTreeNodeOfType<"CallExpression"> | null => {
  const expression = stripParenExpression(rawExpression);
  if (isNodeOfType(expression, "CallExpression")) {
    return isVirtualizerHookCall(expression, context) ? expression : null;
  }
  if (!isNodeOfType(expression, "Identifier")) return null;
  const symbol = resolveConstIdentifierAlias(expression, context.scopes);
  if (symbol?.kind !== "const" || !symbol.initializer) return null;
  const initializer = stripParenExpression(symbol.initializer);
  return isNodeOfType(initializer, "CallExpression") && isVirtualizerHookCall(initializer, context)
    ? initializer
    : null;
};

const isMeasureElementBinding = (symbol: SymbolDescriptor): boolean => {
  const declaration = symbol.declarationNode;
  if (!isNodeOfType(declaration, "VariableDeclarator")) return false;
  const pattern = declaration.id;
  if (!isNodeOfType(pattern, "ObjectPattern")) return false;
  return pattern.properties.some(
    (property) =>
      isNodeOfType(property, "Property") &&
      getStaticPropertyKeyName(property) === MEASURE_ELEMENT_NAME &&
      property.value === symbol.bindingIdentifier,
  );
};

const getMeasureElementHookCall = (
  rawExpression: EsTreeNode,
  context: RuleContext,
): EsTreeNodeOfType<"CallExpression"> | null => {
  const expression = stripParenExpression(rawExpression);
  if (
    isNodeOfType(expression, "MemberExpression") &&
    getStaticPropertyName(expression) === MEASURE_ELEMENT_NAME
  ) {
    return getVirtualizerHookCall(expression.object, context);
  }
  if (!isNodeOfType(expression, "Identifier")) return null;
  const symbol =
    context.scopes.referenceFor(expression)?.resolvedSymbol ??
    context.scopes.symbolFor(expression) ??
    resolveConstIdentifierAlias(expression, context.scopes);
  if (symbol?.kind !== "const" || !symbol.initializer) return null;
  if (isMeasureElementBinding(symbol)) {
    return getVirtualizerHookCall(symbol.initializer, context);
  }
  return getMeasureElementHookCall(symbol.initializer, context);
};

const getMeasureElementRefHookCall = (
  rawExpression: EsTreeNode,
  context: RuleContext,
): EsTreeNodeOfType<"CallExpression"> | null => {
  const expression = stripParenExpression(rawExpression);
  const directHookCall = getMeasureElementHookCall(expression, context);
  if (directHookCall) return directHookCall;
  if (
    !isNodeOfType(expression, "ArrowFunctionExpression") &&
    !isNodeOfType(expression, "FunctionExpression")
  ) {
    return null;
  }
  let hookCall: EsTreeNodeOfType<"CallExpression"> | null = null;
  walkAst(expression.body, (node) => {
    if (hookCall) return false;
    if (node !== expression.body && isFunctionLike(node)) return false;
    if (!isNodeOfType(node, "CallExpression")) return;
    hookCall = getMeasureElementHookCall(node.callee, context);
    return hookCall ? false : undefined;
  });
  return hookCall;
};

export const tanstackVirtualMeasureElementRequiresDataIndex = defineRule({
  id: "tanstack-virtual-measure-element-requires-data-index",
  title: "Measured virtual item without data-index",
  severity: "warn",
  category: "Correctness",
  requires: ["tanstack-virtual"],
  matchByOccurrence: true,
  recommendation:
    "Add data-index={virtualItem.index} to every element whose ref is the virtualizer's measureElement, so dynamic measurement can attribute the size to the right row.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const refAttribute = findJsxAttribute(node.attributes, "ref");
      if (
        !refAttribute?.value ||
        !isNodeOfType(refAttribute.value, "JSXExpressionContainer") ||
        !refAttribute.value.expression
      ) {
        return;
      }
      const hookCall = getMeasureElementRefHookCall(refAttribute.value.expression, context);
      if (!hookCall) return;
      const indexAttribute = getVirtualizerIndexAttribute(hookCall, context);
      if (indexAttribute === null) return;
      if (hasJsxSpreadAttribute(node.attributes)) return;
      if (findJsxAttribute(node.attributes, indexAttribute)) return;
      context.report({
        node: node.name,
        message: `This element's ref is the virtualizer's measureElement, but it has no ${indexAttribute} attribute, so the virtualizer cannot attribute the measured size to a row and drops it with a console warning. Add ${indexAttribute}={virtualItem.index}.`,
      });
    },
  }),
});
