import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findProgramRoot } from "./find-program-root.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const closedProviderByAnalysis = new WeakMap<ScopeAnalysis, Map<SymbolDescriptor, boolean>>();

const getWindowMethodProvider = (call: EsTreeNode, methodName: string): EsTreeNode | null => {
  if (!isNodeOfType(call, "CallExpression") || call.optional) return null;
  const callee = stripParenExpression(call.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    callee.optional ||
    getStaticPropertyName(callee) !== methodName
  )
    return null;
  const receiver = stripParenExpression(callee.object);
  if (
    !isNodeOfType(receiver, "MemberExpression") ||
    receiver.computed ||
    receiver.optional ||
    getStaticPropertyName(receiver) !== "window"
  )
    return null;
  const provider = stripParenExpression(receiver.object);
  return isNodeOfType(provider, "Identifier") ? provider : null;
};

const isProviderTypeReference = (identifier: EsTreeNode): boolean => {
  let qualifiedName = identifier;
  while (isNodeOfType(qualifiedName.parent, "TSQualifiedName")) {
    if (qualifiedName.parent.left !== qualifiedName) return false;
    qualifiedName = qualifiedName.parent;
  }
  return (
    isNodeOfType(qualifiedName.parent, "TSTypeReference") ||
    isNodeOfType(qualifiedName.parent, "TSTypeQuery")
  );
};

const isReadonlyProviderUse = (identifier: EsTreeNode): boolean => {
  if (isProviderTypeReference(identifier)) return true;
  if (isWithinAssignmentTarget(identifier)) return false;
  const namespaceMember = findTransparentExpressionRoot(identifier).parent;
  if (
    !isNodeOfType(namespaceMember, "MemberExpression") ||
    namespaceMember.computed ||
    namespaceMember.optional
  )
    return false;
  const member = findTransparentExpressionRoot(namespaceMember).parent;
  if (!isNodeOfType(member, "MemberExpression") || member.computed || member.optional) return false;
  if (getStaticPropertyName(namespaceMember) === "ProgressLocation") {
    const location = getStaticPropertyName(member);
    return location === "Notification" || location === "Window" || location === "SourceControl";
  }
  const call = findTransparentExpressionRoot(member).parent;
  return Boolean(
    call &&
    (getWindowMethodProvider(call, "showQuickPick") === identifier ||
      getWindowMethodProvider(call, "showInformationMessage") === identifier),
  );
};

const isClosedProvider = (provider: SymbolDescriptor, scopes: ScopeAnalysis): boolean => {
  const cached = closedProviderByAnalysis.get(scopes)?.get(provider);
  if (cached !== undefined) return cached;
  const providers = closedProviderByAnalysis.get(scopes) ?? new Map<SymbolDescriptor, boolean>();
  closedProviderByAnalysis.set(scopes, providers);
  providers.set(provider, false);
  const declaration = getImportDeclarationForSymbol(provider);
  const program = findProgramRoot(provider.declarationNode);
  if (!declaration || !program) return false;
  for (const reference of provider.references) {
    if (!isReadonlyProviderUse(reference.identifier)) return false;
  }
  let isClosed = true;
  walkAst(program, (candidate) => {
    if (!isClosed) return false;
    if (
      isNodeOfType(candidate, "AssignmentPattern") ||
      isNodeOfType(candidate, "ImportExpression") ||
      isNodeOfType(candidate, "WithStatement") ||
      (isNodeOfType(candidate, "Identifier") &&
        candidate.name === provider.name &&
        candidate !== provider.bindingIdentifier &&
        !isProviderTypeReference(candidate) &&
        scopes.referenceFor(candidate)?.resolvedSymbol !== provider) ||
      (isNodeOfType(candidate, "Identifier") &&
        ["require", "eval", "Function"].includes(candidate.name)) ||
      (isNodeOfType(candidate, "ImportDeclaration") &&
        candidate !== declaration &&
        candidate.source.value === "vscode") ||
      ((isNodeOfType(candidate, "ExportNamedDeclaration") ||
        isNodeOfType(candidate, "ExportAllDeclaration")) &&
        candidate.source?.value === "vscode")
    )
      isClosed = false;
  });
  providers.set(provider, isClosed);
  return isClosed;
};

const getAwaitedQuickPickProvider = (
  statement: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  if (!isNodeOfType(statement, "VariableDeclaration") || statement.declarations.length !== 1)
    return null;
  const initializer = statement.declarations[0].init;
  if (!isNodeOfType(initializer, "AwaitExpression")) return null;
  const provider = getWindowMethodProvider(
    stripParenExpression(initializer.argument),
    "showQuickPick",
  );
  if (!provider) return null;
  const imported = resolveImportedApiReference(provider, scopes);
  const symbol = scopes.symbolFor(provider);
  return imported?.source === "vscode" &&
    imported.isNamespace &&
    symbol &&
    isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier")
    ? symbol
    : null;
};

export const awaitedStatementsShareVsCodeQuickPick = (
  firstStatement: EsTreeNode,
  secondStatement: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const provider = getAwaitedQuickPickProvider(firstStatement, scopes);
  return Boolean(
    provider &&
    getAwaitedQuickPickProvider(secondStatement, scopes) === provider &&
    isClosedProvider(provider, scopes),
  );
};
