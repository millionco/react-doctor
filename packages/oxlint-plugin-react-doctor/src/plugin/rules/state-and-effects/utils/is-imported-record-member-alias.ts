import type { Reference } from "eslint-scope";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveConstIdentifierAlias } from "../../../utils/resolve-const-identifier-alias.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { getRef, getUpstreamRefs } from "./effect/ast.js";
import type { ProgramAnalysis } from "./effect/get-program-analysis.js";
import { getStaticMemberPropertyName } from "./static-member-property-name.js";

interface ImportedRecordMemberAliasOptions {
  analysis: ProgramAnalysis;
  expression: EsTreeNode;
  scopes: ScopeAnalysis;
}

interface ImportedRecordMemberAliasFacts {
  callbacks: WeakMap<SymbolDescriptor, boolean>;
  records: WeakMap<SymbolDescriptor, ReadonlyMap<string, EsTreeNode> | null>;
  importedOrigins: WeakMap<SymbolDescriptor, boolean>;
  variableWrites: WeakMap<NonNullable<Reference["resolved"]>, boolean>;
}

const factsByAnalysis = new WeakMap<
  ProgramAnalysis,
  WeakMap<ScopeAnalysis, ImportedRecordMemberAliasFacts>
>();

const getRecordProperties = (
  recordSymbol: SymbolDescriptor,
): ReadonlyMap<string, EsTreeNode> | null => {
  if (
    recordSymbol.kind !== "const" ||
    !recordSymbol.initializer ||
    !isNodeOfType(recordSymbol.declarationNode, "VariableDeclarator") ||
    recordSymbol.declarationNode.id !== recordSymbol.bindingIdentifier
  ) {
    return null;
  }
  const record = stripParenExpression(recordSymbol.initializer);
  if (!isNodeOfType(record, "ObjectExpression")) return null;
  for (const reference of recordSymbol.references) {
    if (reference.flag !== "read") return null;
    const receiverRoot = findTransparentExpressionRoot(reference.identifier);
    const member = receiverRoot.parent;
    if (
      !member ||
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== receiverRoot ||
      !getStaticMemberPropertyName(member)
    ) {
      return null;
    }
    const memberRoot = findTransparentExpressionRoot(member);
    const declarator = memberRoot.parent;
    if (
      !declarator ||
      !isNodeOfType(declarator, "VariableDeclarator") ||
      declarator.init !== memberRoot ||
      !isNodeOfType(declarator.id, "Identifier") ||
      !isNodeOfType(declarator.parent, "VariableDeclaration") ||
      declarator.parent.kind !== "const"
    ) {
      return null;
    }
  }
  const properties = new Map<string, EsTreeNode>();
  for (const property of record.properties) {
    if (!isNodeOfType(property, "Property") || property.kind !== "init" || property.method) {
      return null;
    }
    const candidateName = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (!candidateName || candidateName === "__proto__" || properties.has(candidateName)) {
      return null;
    }
    properties.set(candidateName, stripParenExpression(property.value));
  }
  return properties;
};

export const isImportedRecordMemberAlias = ({
  analysis,
  expression,
  scopes,
}: ImportedRecordMemberAliasOptions): boolean => {
  const callee = stripParenExpression(expression);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const callbackSymbol = scopes.symbolFor(callee);
  if (!callbackSymbol) return false;
  let factsByScope = factsByAnalysis.get(analysis);
  if (!factsByScope) {
    factsByScope = new WeakMap();
    factsByAnalysis.set(analysis, factsByScope);
  }
  let facts = factsByScope.get(scopes);
  if (!facts) {
    facts = {
      callbacks: new WeakMap(),
      records: new WeakMap(),
      importedOrigins: new WeakMap(),
      variableWrites: new WeakMap(),
    };
    factsByScope.set(scopes, facts);
  }
  const cachedCallback = facts.callbacks.get(callbackSymbol);
  if (cachedCallback !== undefined) return cachedCallback;
  const resolveCallback = (): boolean => {
    if (
      callbackSymbol.kind !== "const" ||
      !callbackSymbol.initializer ||
      !isNodeOfType(callbackSymbol.declarationNode, "VariableDeclarator") ||
      callbackSymbol.declarationNode.id !== callbackSymbol.bindingIdentifier ||
      callbackSymbol.references.some((reference) => reference.flag !== "read")
    ) {
      return false;
    }
    const selection = stripParenExpression(callbackSymbol.initializer);
    if (!isNodeOfType(selection, "MemberExpression")) return false;
    const propertyName = getStaticMemberPropertyName(selection);
    const receiver = stripParenExpression(selection.object);
    if (!propertyName || !isNodeOfType(receiver, "Identifier")) return false;
    const recordSymbol = scopes.symbolFor(receiver);
    if (!recordSymbol) return false;
    let properties = facts.records.get(recordSymbol);
    if (properties === undefined) {
      properties = getRecordProperties(recordSymbol);
      facts.records.set(recordSymbol, properties);
    }
    const selectedValue = properties?.get(propertyName);
    if (!selectedValue || !isNodeOfType(selectedValue, "Identifier")) return false;
    const selectedSymbol = scopes.symbolFor(selectedValue);
    if (!selectedSymbol) return false;
    const cachedOrigin = facts.importedOrigins.get(selectedSymbol);
    if (cachedOrigin !== undefined) return cachedOrigin;
    const selectedReference = getRef(analysis, selectedValue);
    const hasImportedOrigin = Boolean(
      resolveConstIdentifierAlias(selectedValue, scopes)?.kind === "import" &&
      selectedReference &&
      getUpstreamRefs(analysis, selectedReference).every((reference) => {
        const variable = reference.resolved;
        if (!variable) return true;
        let hasWrite = facts.variableWrites.get(variable);
        if (hasWrite === undefined) {
          hasWrite = variable.references.some(
            (candidateReference) => candidateReference.isWrite() && !candidateReference.init,
          );
          facts.variableWrites.set(variable, hasWrite);
        }
        return !hasWrite;
      }),
    );
    facts.importedOrigins.set(selectedSymbol, hasImportedOrigin);
    return hasImportedOrigin;
  };
  const result = resolveCallback();
  facts.callbacks.set(callbackSymbol, result);
  return result;
};
