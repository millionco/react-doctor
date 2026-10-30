import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { getShopifyDataProperties } from "./get-shopify-data-properties.js";
import { isShopifyDataValue } from "./is-shopify-data-value.js";
import {
  SHOPIFY_API_MODULE,
  SHOPIFY_FIRST_STATEMENT_INDEX,
  SHOPIFY_SELF_EXTENSION_PROPERTY_COUNT,
  SHOPIFY_VALIDATION_ARGUMENT_COUNT,
} from "./shopify-webhook-constants.js";

const isTopLevelStatement = (node: EsTreeNode): boolean => isNodeOfType(node.parent, "Program");

export const isCanonicalShopifyClient = (
  client: SymbolDescriptor,
  scopes: ScopeAnalysis,
  selectedRead: EsTreeNode,
): boolean => {
  if (
    (client.kind !== "const" && client.kind !== "let") ||
    !client.initializer ||
    !isNodeOfType(client.declarationNode, "VariableDeclarator") ||
    !isNodeOfType(client.declarationNode.parent, "VariableDeclaration") ||
    !isNodeOfType(client.declarationNode.id, "Identifier") ||
    client.declarationNode.id !== client.bindingIdentifier ||
    client.declarationNode.parent.declarations.length !== SHOPIFY_VALIDATION_ARGUMENT_COUNT ||
    client.declarationNode.parent.declarations[SHOPIFY_FIRST_STATEMENT_INDEX] !==
      client.declarationNode ||
    !isTopLevelStatement(client.declarationNode.parent)
  )
    return false;
  const declarationStatement = client.declarationNode.parent;
  const factoryCall = stripParenExpression(client.initializer);
  if (
    !isNodeOfType(factoryCall, "CallExpression") ||
    factoryCall.optional ||
    !isNodeOfType(factoryCall.callee, "Identifier") ||
    factoryCall.arguments.length !== SHOPIFY_VALIDATION_ARGUMENT_COUNT
  )
    return false;
  const factory = scopes.symbolFor(factoryCall.callee);
  if (
    !factory ||
    getValueImportSource(factory) !== SHOPIFY_API_MODULE ||
    !isNodeOfType(factory.declarationNode, "ImportSpecifier") ||
    getImportedName(factory.declarationNode) !== "shopifyApi" ||
    !factory.references.every(
      (reference) => reference.flag === "read" && reference.identifier === factoryCall.callee,
    )
  )
    return false;
  const config = factoryCall.arguments[SHOPIFY_FIRST_STATEMENT_INDEX];
  if (!config) return false;
  const properties = getShopifyDataProperties(config, scopes);
  if (
    !properties?.has("apiSecretKey") ||
    ![...properties.values()].every((value) => isShopifyDataValue(value, scopes))
  )
    return false;
  const permittedReferences = new Set<EsTreeNode>([selectedRead]);
  let extensionStatement: EsTreeNode | null = null;
  const writes = client.references.filter((reference) => reference.flag !== "read");
  if (writes.length > SHOPIFY_VALIDATION_ARGUMENT_COUNT) return false;
  if (writes.length === SHOPIFY_VALIDATION_ARGUMENT_COUNT) {
    if (client.kind !== "let") return false;
    const write = writes[SHOPIFY_FIRST_STATEMENT_INDEX]?.identifier;
    const assignment = write?.parent;
    if (
      !write ||
      !isNodeOfType(assignment, "AssignmentExpression") ||
      assignment.operator !== "=" ||
      assignment.left !== write ||
      !isNodeOfType(assignment.parent, "ExpressionStatement") ||
      !isTopLevelStatement(assignment.parent) ||
      !isNodeOfType(assignment.right, "ObjectExpression") ||
      assignment.right.properties.length !== SHOPIFY_SELF_EXTENSION_PROPERTY_COUNT
    )
      return false;
    const [spread, extension] = assignment.right.properties;
    if (
      !isNodeOfType(spread, "SpreadElement") ||
      !isNodeOfType(spread.argument, "Identifier") ||
      scopes.symbolFor(spread.argument) !== client ||
      !isNodeOfType(extension, "Property") ||
      extension.computed ||
      extension.method ||
      extension.kind !== "init" ||
      !isNodeOfType(extension.key, "Identifier") ||
      extension.key.name !== "user" ||
      !isShopifyDataValue(extension.value, scopes, true)
    )
      return false;
    const program = declarationStatement.parent;
    if (!isNodeOfType(program, "Program")) return false;
    const statements: ReadonlyArray<EsTreeNode> = program.body;
    if (
      !isNodeOfType(selectedRead.parent, "ExportDefaultDeclaration") ||
      statements.indexOf(declarationStatement) >= statements.indexOf(assignment.parent) ||
      statements.indexOf(assignment.parent) >= statements.indexOf(selectedRead.parent)
    )
      return false;
    extensionStatement = assignment.parent;
    permittedReferences.add(write);
    permittedReferences.add(spread.argument);
  }
  if (!client.references.every((reference) => permittedReferences.has(reference.identifier)))
    return false;
  const program = declarationStatement.parent;
  if (!isNodeOfType(program, "Program")) return false;
  const isProviderExport = isNodeOfType(selectedRead.parent, "ExportDefaultDeclaration");
  if (!isProviderExport) return true;
  return program.body.every((statement) => {
    if (
      isNodeOfType(statement, "ImportDeclaration") ||
      statement === declarationStatement ||
      statement === extensionStatement ||
      statement === selectedRead.parent
    )
      return true;
    return (
      isNodeOfType(statement, "VariableDeclaration") &&
      statement.kind === "const" &&
      statement.declarations.every((declaration) => {
        if (!isNodeOfType(declaration.id, "Identifier") || !declaration.init) return false;
        const symbol = scopes.symbolFor(declaration.id);
        return (
          symbol !== null &&
          symbol.references.every((reference) => reference.flag === "read") &&
          isShopifyDataValue(declaration.init, scopes)
        );
      })
    );
  });
};
