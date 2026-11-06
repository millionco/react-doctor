import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findProgramRoot } from "./find-program-root.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getDestructuredBindingPropertyName } from "./get-destructured-binding-property-name.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getStaticStringExpression } from "./get-static-string-expression.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
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

const getRuntimeImportEqualsSource = (declaration: EsTreeNode | null | undefined): string | null =>
  isNodeOfType(declaration, "TSImportEqualsDeclaration") &&
  declaration.importKind !== "type" &&
  isNodeOfType(declaration.moduleReference, "TSExternalModuleReference")
    ? declaration.moduleReference.expression.value
    : null;

const isNodeModuleSource = (source: string | null): boolean =>
  source === "node:module" || source === "module";

const getConstDestructuredPropertySource = (
  binding: SymbolDescriptor | null,
  propertyNames: readonly string[],
): EsTreeNode | null => {
  if (
    binding?.kind !== "const" ||
    !binding.initializer ||
    !isNodeOfType(binding.declarationNode, "VariableDeclarator")
  ) {
    return null;
  }
  let pattern: EsTreeNode = binding.bindingIdentifier;
  for (const propertyName of propertyNames) {
    const parentPattern = pattern.parent?.parent;
    if (!parentPattern || getDestructuredBindingPropertyName(pattern) !== propertyName) {
      return null;
    }
    pattern = parentPattern;
  }
  return pattern === binding.declarationNode.id ? binding.initializer : null;
};

const getDirectPropertyReceiver = (
  reference: EsTreeNode,
  propertyName: string,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  const expression = stripParenExpression(reference);
  const binding = resolveConstIdentifierAlias(expression, scopes, true);
  const destructuredReceiver = getConstDestructuredPropertySource(binding, [propertyName]);
  if (destructuredReceiver) return destructuredReceiver;
  const initializer = binding ? getDirectConstInitializer(binding) : expression;
  const member = initializer && stripParenExpression(initializer);
  return isNodeOfType(member, "MemberExpression") && getStaticPropertyName(member) === propertyName
    ? member.object
    : null;
};

const isNodeModuleReceiver = (
  receiver: EsTreeNode,
  scopes: ScopeAnalysis,
  allowModuleClass = true,
): boolean => {
  const imported = resolveImportedApiReference(receiver, scopes);
  if (imported) {
    return (
      isNodeModuleSource(imported.source) &&
      (imported.isNamespace ||
        imported.importedName === "default" ||
        (allowModuleClass && imported.importedName === "Module"))
    );
  }

  const binding = resolveConstIdentifierAlias(stripParenExpression(receiver), scopes);
  if (isNodeModuleSource(getRuntimeImportEqualsSource(binding?.declarationNode))) return true;
  if (!allowModuleClass) return false;
  const namespace = getDirectPropertyReceiver(receiver, "Module", scopes);
  return namespace !== null && isNodeModuleReceiver(namespace, scopes, false);
};

const isNodeCreateRequireFactory = (factory: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const imported = resolveImportedApiReference(factory, scopes);
  if (imported?.importedName === "createRequire") return isNodeModuleSource(imported.source);
  const receiver = getDirectPropertyReceiver(factory, "createRequire", scopes);
  if (receiver) return isNodeModuleReceiver(receiver, scopes);
  const binding = resolveConstIdentifierAlias(stripParenExpression(factory), scopes, true);
  const namespace = getConstDestructuredPropertySource(binding, ["createRequire", "Module"]);
  return namespace !== null && isNodeModuleReceiver(namespace, scopes, false);
};

const loadsVsCodeWithNodeCreateRequire = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const rawSpecifier = node.arguments[0];
  if (!rawSpecifier || isNodeOfType(rawSpecifier, "SpreadElement")) return false;
  const specifier = stripParenExpression(rawSpecifier);
  const specifierBinding = resolveConstIdentifierAlias(specifier, scopes);
  const specifierValue = specifierBinding ? getDirectConstInitializer(specifierBinding) : specifier;
  if (!specifierValue) return false;
  const resolvedSpecifier = stripParenExpression(specifierValue);
  let moduleName = getStaticStringExpression(resolvedSpecifier);
  if (isNodeOfType(resolvedSpecifier, "BinaryExpression") && resolvedSpecifier.operator === "+") {
    const prefix = getStaticStringExpression(resolvedSpecifier.left);
    const suffix = getStaticStringExpression(resolvedSpecifier.right);
    if (prefix !== null && suffix !== null) moduleName = prefix + suffix;
  }
  if (moduleName !== "vscode") return false;

  const loader = stripParenExpression(node.callee);
  const loaderBinding = resolveConstIdentifierAlias(loader, scopes);
  const factoryCall = loaderBinding ? getDirectConstInitializer(loaderBinding) : loader;
  if (!factoryCall) return false;
  const factory = stripParenExpression(factoryCall);
  return (
    isNodeOfType(factory, "CallExpression") && isNodeCreateRequireFactory(factory.callee, scopes)
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
      loadsVsCodeWithNodeCreateRequire(candidate, scopes) ||
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
      getRuntimeImportEqualsSource(candidate) === "vscode" ||
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
