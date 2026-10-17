import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { functionIsReferencedAsJsxElement } from "../../../utils/function-is-referenced-as-jsx-element.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getFunctionBindingSymbols } from "../../../utils/get-function-binding-symbols.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeOnlyImport } from "../../../utils/is-type-only-import.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { isResourceKeyRenderedChild } from "./is-resource-key-rendered-child.js";

const isJsxTagReference = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  return Boolean(
    parent &&
    (isNodeOfType(parent, "JSXOpeningElement") || isNodeOfType(parent, "JSXClosingElement")) &&
    parent.name === node,
  );
};

const isFinalGridColumns = (expression: EsTreeNode, context: RuleContext): boolean => {
  const container = findTransparentExpressionRoot(expression).parent;
  if (!isNodeOfType(container, "JSXExpressionContainer")) return false;
  const attribute = container.parent;
  if (
    !isNodeOfType(attribute, "JSXAttribute") ||
    attribute.value !== container ||
    !isNodeOfType(attribute.name, "JSXIdentifier") ||
    attribute.name.name !== "columns"
  )
    return false;
  const opening = attribute.parent;
  if (!isNodeOfType(opening, "JSXOpeningElement") || !isNodeOfType(opening.name, "JSXIdentifier"))
    return false;
  const symbol = context.scopes.symbolFor(opening.name);
  if (!symbol) return false;
  const declaration = getImportDeclarationForSymbol(symbol);
  if (
    !declaration ||
    isTypeOnlyImport(declaration) ||
    declaration.source.value !== "@mui/x-data-grid" ||
    !isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
    symbol.declarationNode.importKind === "type" ||
    getImportedName(symbol.declarationNode) !== "DataGrid" ||
    !symbol.references.every(
      (reference) =>
        reference.flag === "read" &&
        !isWithinAssignmentTarget(reference.identifier) &&
        isJsxTagReference(reference.identifier),
    )
  )
    return false;
  const following = opening.attributes.slice(
    opening.attributes.findIndex((candidate) => candidate === attribute) + 1,
  );
  return !following.some(
    (candidate) =>
      isNodeOfType(candidate, "JSXSpreadAttribute") ||
      (isNodeOfType(candidate, "JSXAttribute") &&
        isNodeOfType(candidate.name, "JSXIdentifier") &&
        candidate.name.name === "columns"),
  );
};

const isColumnsUse = (node: EsTreeNode, context: RuleContext): boolean => {
  const root = findTransparentExpressionRoot(node);
  const spread = root.parent;
  if (
    isNodeOfType(spread, "SpreadElement") &&
    spread.argument === root &&
    isNodeOfType(spread.parent, "ArrayExpression")
  )
    return isFinalGridColumns(spread.parent, context);
  return isFinalGridColumns(root, context);
};

const preservesSourceColumn = (call: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(call, "CallExpression") || call.optional) return false;
  const [callback, ...otherArguments] = call.arguments;
  if (otherArguments.length || !isNodeOfType(callback, "ArrowFunctionExpression") || callback.async)
    return false;
  const [parameter, ...otherParameters] = callback.params;
  const body = stripParenExpression(callback.body);
  if (
    otherParameters.length ||
    !isNodeOfType(parameter, "Identifier") ||
    !isNodeOfType(body, "ObjectExpression")
  )
    return false;
  const lastProperty = body.properties.at(-1);
  if (
    !isNodeOfType(lastProperty, "SpreadElement") ||
    !isNodeOfType(lastProperty.argument, "Identifier")
  )
    return false;
  const symbol = context.scopes.symbolFor(parameter);
  return Boolean(
    symbol &&
    context.scopes.symbolFor(lastProperty.argument) === symbol &&
    symbol.references.every(
      (reference) =>
        reference.flag === "read" &&
        !isWithinAssignmentTarget(reference.identifier) &&
        reference.identifier === lastProperty.argument,
    ),
  );
};

export const isLocalResourceKeyRenderFrame = (
  frame: EsTreeNode,
  mapCall: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (
    !isNodeOfType(frame, "ArrowFunctionExpression") ||
    frame.async ||
    !isNodeOfType(frame.body, "BlockStatement") ||
    !isResourceKeyRenderedChild(mapCall, frame, context)
  )
    return false;
  let cursor: EsTreeNode | null | undefined = mapCall;
  while (cursor && cursor !== frame.body && !isNodeOfType(cursor, "ReturnStatement"))
    cursor = cursor.parent;
  if (
    !isNodeOfType(cursor, "ReturnStatement") ||
    !cursor.argument ||
    findEnclosingFunction(cursor) !== frame ||
    (!isNodeOfType(stripParenExpression(cursor.argument), "JSXElement") &&
      !isNodeOfType(stripParenExpression(cursor.argument), "JSXFragment"))
  )
    return false;
  const functionSymbols = getFunctionBindingSymbols(frame, context.scopes);
  if (
    functionIsReferencedAsJsxElement(frame, context.scopes) &&
    functionSymbols.length &&
    functionSymbols.every((symbol) =>
      symbol.references.every(
        (reference) =>
          reference.flag === "read" &&
          !isWithinAssignmentTarget(reference.identifier) &&
          (isJsxTagReference(reference.identifier) ||
            isNodeOfType(reference.identifier.parent, "ExportSpecifier")),
      ),
    )
  )
    return true;
  const property = findTransparentExpressionRoot(frame).parent;
  if (
    !isNodeOfType(property, "Property") ||
    property.kind !== "init" ||
    property.method ||
    getStaticPropertyKeyName(property) !== "renderCell" ||
    property.value !== frame ||
    !isNodeOfType(property.parent, "ObjectExpression")
  )
    return false;
  const column = property.parent;
  const propertyNames = column.properties.map((candidate) => getStaticPropertyKeyName(candidate));
  if (
    propertyNames.some((name) => name === null) ||
    new Set(propertyNames).size !== propertyNames.length ||
    column.properties.some(
      (candidate) =>
        !isNodeOfType(candidate, "Property") || candidate.kind !== "init" || candidate.method,
    )
  )
    return false;
  const array = findTransparentExpressionRoot(column).parent;
  if (!isNodeOfType(array, "ArrayExpression")) return false;
  let columns = findTransparentExpressionRoot(array);
  const member = columns.parent;
  if (
    isNodeOfType(member, "MemberExpression") &&
    member.object === columns &&
    !member.optional &&
    !member.computed &&
    getStaticPropertyName(member) === "map"
  ) {
    const call = findTransparentExpressionRoot(member).parent;
    if (
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== findTransparentExpressionRoot(member) ||
      !preservesSourceColumn(call, context)
    )
      return false;
    columns = findTransparentExpressionRoot(call);
  }
  const declarator = columns.parent;
  if (!isNodeOfType(declarator, "VariableDeclarator")) return isColumnsUse(columns, context);
  if (declarator.init !== columns || !isNodeOfType(declarator.id, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(declarator.id);
  return Boolean(
    symbol &&
    getDirectConstInitializer(symbol) === columns &&
    symbol.references.length &&
    symbol.references.every(
      (reference) =>
        reference.flag === "read" &&
        !isWithinAssignmentTarget(reference.identifier) &&
        isColumnsUse(reference.identifier, context),
    ),
  );
};
