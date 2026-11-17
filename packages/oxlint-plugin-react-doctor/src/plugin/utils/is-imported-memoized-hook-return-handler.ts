import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { collectFunctionReturnStatements } from "./collect-function-return-statements.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getImportedName } from "./get-imported-name.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getValueImportSource } from "./get-value-import-declaration.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactHookName } from "./is-react-hook-name.js";
import { isSymbolReadOnly } from "./is-symbol-read-only.js";
import { isTypeOnlyImport } from "./is-type-only-import.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { resolveCrossFileFunctionExportWithFilePath } from "./resolve-cross-file-function-export.js";
import { resolveModulePath } from "./resolve-module-path.js";
import type { RuleContext } from "./rule-context.js";
import { someAst } from "./some-ast.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const CODE_LOADING_SOURCES = new Set([
  "module",
  "node:module",
  "process",
  "node:process",
  "vm",
  "node:vm",
]);
const PROVIDER_CAPABILITIES = new Set([
  "eval",
  "require",
  "Function",
  "module",
  "exports",
  "process",
]);
const PROVIDER_MEMBER_NAMES = new Set([
  "useCallback",
  "createRequire",
  "getBuiltinModule",
  "require",
  "eval",
]);

const hasRuntimeReactFacadeUse = (specifier: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (isNodeOfType(specifier, "ImportSpecifier")) {
    if (specifier.importKind === "type") return false;
    const importedName = getImportedName(specifier);
    if (importedName !== "default") return Boolean(importedName?.startsWith("__"));
  } else if (
    !isNodeOfType(specifier, "ImportDefaultSpecifier") &&
    !isNodeOfType(specifier, "ImportNamespaceSpecifier")
  ) {
    return true;
  }
  const binding = scopes.symbolFor(specifier.local);
  return (
    !binding ||
    binding.references.some((reference) => !isTypeScriptTypePosition(reference.identifier))
  );
};

const hasReactProviderUncertainty = (scopes: ScopeAnalysis): boolean =>
  someAst(scopes.rootScope.node, (node) => {
    if (isTypeScriptTypePosition(node)) return false;
    if (isNodeOfType(node, "ImportExpression") || isNodeOfType(node, "TSImportEqualsDeclaration")) {
      return !isNodeOfType(node, "TSImportEqualsDeclaration") || node.importKind !== "type";
    }
    if (isNodeOfType(node, "ImportDeclaration") && !isTypeOnlyImport(node)) {
      const source = node.source.value;
      return (
        CODE_LOADING_SOURCES.has(source) ||
        source.startsWith("react/") ||
        (source === "react" &&
          (!node.specifiers.length ||
            node.specifiers.some((specifier) => hasRuntimeReactFacadeUse(specifier, scopes))))
      );
    }
    if (isNodeOfType(node, "Identifier") && PROVIDER_CAPABILITIES.has(node.name)) {
      return scopes.isGlobalReference(node);
    }
    if (isNodeOfType(node, "CallExpression")) {
      const callee = stripParenExpression(node.callee);
      return isNodeOfType(callee, "Identifier") && callee.name === "eval" && !node.optional;
    }
    if (isNodeOfType(node, "Literal") && typeof node.value === "string") {
      return PROVIDER_MEMBER_NAMES.has(node.value);
    }
    const propertyName = getStaticPropertyKeyName(node, { allowComputedString: true });
    return propertyName !== null && PROVIDER_MEMBER_NAMES.has(propertyName);
  });

export const isImportedMemoizedHookReturnHandler = (
  handler: EsTreeNode,
  dependency: EsTreeNode,
  effect: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!context.filename) return false;
  const consumer = context.scopes.symbolFor(handler);
  if (
    consumer?.kind !== "const" ||
    context.scopes.symbolFor(dependency) !== consumer ||
    !isSymbolReadOnly(consumer) ||
    !isNodeOfType(consumer.declarationNode, "VariableDeclarator") ||
    !isNodeOfType(consumer.declarationNode.id, "ObjectPattern")
  ) {
    return false;
  }
  const declaration = consumer.declarationNode;
  const field = consumer.bindingIdentifier.parent;
  if (
    !isNodeOfType(field, "Property") ||
    field.value !== consumer.bindingIdentifier ||
    field.computed
  )
    return false;
  const fieldName = getStaticPropertyKeyName(field);
  if (fieldName === null || fieldName === "__proto__") return false;
  const call = declaration.init && stripParenExpression(declaration.init);
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.some((argument) => isNodeOfType(argument, "SpreadElement")) ||
    !isNodeOfType(call.callee, "Identifier")
  )
    return false;
  const owner = findEnclosingFunction(call);
  if (
    !isFunctionLike(owner) ||
    owner.async ||
    owner.generator ||
    declaration.parent?.parent !== owner.body ||
    findEnclosingFunction(effect) !== owner
  )
    return false;
  const imported = context.scopes.symbolFor(call.callee);
  const importedName = imported && getImportedName(imported.declarationNode);
  const source = imported && getValueImportSource(imported);
  if (!importedName || !source || !isReactHookName(importedName)) return false;
  const directPath = resolveModulePath(context.filename, source);
  if (!directPath) return false;
  const resolved = resolveCrossFileFunctionExportWithFilePath(
    context.filename,
    source,
    importedName,
  );
  if (!resolved || resolved.filePath !== directPath) return false;
  const provider = resolved.functionNode;
  const providerDeclaration = provider.parent;
  if (
    !isNodeOfType(provider, "ArrowFunctionExpression") ||
    provider.async ||
    !provider.params.every((parameter) => isNodeOfType(parameter, "Identifier")) ||
    !isNodeOfType(provider.body, "BlockStatement") ||
    !isNodeOfType(providerDeclaration, "VariableDeclarator") ||
    !isNodeOfType(providerDeclaration.id, "Identifier") ||
    providerDeclaration.id.name !== importedName ||
    !isNodeOfType(providerDeclaration.parent, "VariableDeclaration") ||
    !isNodeOfType(providerDeclaration.parent.parent, "ExportNamedDeclaration")
  )
    return false;
  const providerScopes = analyzeScopes(resolved.programNode);
  const providerBinding = providerScopes.symbolFor(providerDeclaration.id);
  if (
    !providerBinding ||
    getDirectConstInitializer(providerBinding) !== provider ||
    !isSymbolReadOnly(providerBinding)
  )
    return false;
  const [returnStatement, ...otherReturns] = collectFunctionReturnStatements(provider);
  if (
    otherReturns.length ||
    returnStatement !== provider.body.body.at(-1) ||
    !isNodeOfType(returnStatement?.argument, "ObjectExpression")
  )
    return false;
  let selectedField: EsTreeNode | null = null;
  for (const property of returnStatement.argument.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.method ||
      property.kind !== "init"
    )
      return false;
    const propertyName = getStaticPropertyKeyName(property);
    if (propertyName === null || propertyName === "__proto__") return false;
    if (propertyName !== fieldName) continue;
    if (selectedField) return false;
    selectedField = property.value;
  }
  if (!isNodeOfType(selectedField, "Identifier")) return false;
  const memo = providerScopes.symbolFor(selectedField);
  if (!memo || !isSymbolReadOnly(memo) || memo.declarationNode.parent?.parent !== provider.body)
    return false;
  const initializer = getDirectConstInitializer(memo);
  const memoCall = initializer && stripParenExpression(initializer);
  if (
    !isNodeOfType(memoCall, "CallExpression") ||
    memoCall.optional ||
    !isNodeOfType(memoCall.callee, "Identifier")
  )
    return false;
  const [callback, dependencies, ...otherArguments] = memoCall.arguments;
  if (
    otherArguments.length ||
    !isFunctionLike(callback) ||
    !isNodeOfType(dependencies, "ArrayExpression") ||
    dependencies.elements.length
  )
    return false;
  const native = providerScopes.symbolFor(memoCall.callee);
  return Boolean(
    native &&
    isSymbolReadOnly(native) &&
    getImportedName(native.declarationNode) === "useCallback" &&
    getValueImportSource(native) === "react" &&
    !resolveModulePath(resolved.filePath, "react") &&
    !hasReactProviderUncertainty(providerScopes) &&
    !hasReactProviderUncertainty(context.scopes),
  );
};
