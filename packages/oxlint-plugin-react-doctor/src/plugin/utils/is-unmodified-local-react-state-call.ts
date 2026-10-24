import {
  CANONICAL_REACT_REQUIRE_ARGUMENT_COUNT,
  REACT_PROVIDER_MUTATION_CAPABILITY_NAMES,
} from "../constants/react.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getEquivalentSymbols } from "./get-equivalent-symbols.js";
import { getGlobalRequireModuleSource } from "./get-global-require-module-source.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getRuntimeStaticDependencySource } from "./get-runtime-static-dependency-source.js";
import {
  isProvenGlobalNamespaceReference,
  isProvenGlobalObjectReference,
} from "./is-proven-global-namespace-reference.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { getRootIdentifier } from "./get-root-identifier.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasReactDefaultProviderMutation } from "./has-react-default-provider-mutation.js";
import { hasPossibleStaticPropertyMutationOrEscape } from "./has-static-property-write-before.js";
import { isBindingAssignmentTarget } from "./is-binding-assignment-target.js";
import { hasRuntimeValueBinding } from "./has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "./is-erased-typescript-binding.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNumericDataMemberAccess } from "./is-numeric-data-member-access.js";
import { isMemberMutationTarget } from "./is-member-mutation-target.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNonEscapingReactApiReference } from "./is-non-escaping-react-api-reference.js";
import { isProvenUnmodifiedReactApiCall } from "./is-proven-unmodified-react-api-call.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { walkAst } from "./walk-ast.js";

const PROVIDER_GLOBAL_NAMES = new Set([
  "require",
  "module",
  "process",
  "Function",
  "eval",
  "Object",
  "Reflect",
  "globalThis",
  "global",
  "window",
  "self",
]);

interface LocalReactStateCallOptions {
  readonly hookName?: "useState" | "useReducer";
  readonly allowNumericDataAccess?: boolean;
  readonly allowDataOperations?: boolean;
  readonly allowedComputedDataMember?: EsTreeNode;
}

export const isUnmodifiedLocalReactStateCall = (
  call: EsTreeNode,
  scopes: ScopeAnalysis,
  options: LocalReactStateCallOptions = {},
): boolean => {
  const hookName = options.hookName ?? "useState";
  if (!isNodeOfType(call, "CallExpression")) return false;
  const callee = stripParenExpression(call.callee);
  const receiver = getRootIdentifier(callee);
  const symbol = receiver ? scopes.symbolFor(receiver) : null;
  if (!receiver || !symbol) return false;
  const importDeclaration = getImportDeclarationForSymbol(symbol);
  let allowedRequire: EsTreeNode | null = null;
  if (importDeclaration) {
    if (
      importDeclaration.importKind === "type" ||
      (isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
        symbol.declarationNode.importKind === "type") ||
      !isProvenUnmodifiedReactApiCall(call, hookName, scopes)
    ) {
      return false;
    }
  } else {
    const declaration = symbol.declarationNode;
    const initializer = symbol.initializer ? stripParenExpression(symbol.initializer) : null;
    if (
      !isNodeOfType(callee, "MemberExpression") ||
      stripParenExpression(callee.object) !== receiver ||
      getStaticPropertyName(callee) !== hookName ||
      symbol.kind !== "const" ||
      !isNodeOfType(declaration, "VariableDeclarator") ||
      declaration.id !== symbol.bindingIdentifier ||
      !isNodeOfType(initializer, "CallExpression") ||
      initializer.arguments.length !== CANONICAL_REACT_REQUIRE_ARGUMENT_COUNT ||
      initializer.optional ||
      initializer.range[1] > call.range[0] ||
      getGlobalRequireModuleSource(initializer, scopes) !== "react" ||
      symbol.references.some((reference) => {
        if (reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier)) {
          return true;
        }
        const referenceRoot = findTransparentExpressionRoot(reference.identifier);
        const member = referenceRoot.parent;
        if (!isNodeOfType(member, "MemberExpression") || member.object !== referenceRoot) {
          return true;
        }
        const propertyName = getStaticPropertyName(member);
        return (
          propertyName === null ||
          REACT_PROVIDER_MUTATION_CAPABILITY_NAMES.has(propertyName) ||
          propertyName === "default" ||
          (propertyName === hookName && !isNonEscapingReactApiReference(member))
        );
      }) ||
      hasPossibleStaticPropertyMutationOrEscape(receiver, hookName, scopes)
    ) {
      return false;
    }
    allowedRequire = initializer;
  }
  if (hasReactDefaultProviderMutation(hookName, scopes)) return false;
  const providerSymbolIds = new Set<number>();
  for (const provider of scopes.rootScope.symbols) {
    const declaration = getImportDeclarationForSymbol(provider);
    if (declaration?.source.value !== "react") continue;
    for (const equivalent of getEquivalentSymbols(provider.bindingIdentifier, scopes)) {
      providerSymbolIds.add(equivalent.id);
    }
  }
  if (allowedRequire) providerSymbolIds.add(symbol.id);
  let hasProviderHazard = false;
  walkAst(scopes.rootScope.node, (child) => {
    if (hasProviderHazard) return false;
    const objectReference =
      options.allowDataOperations && isNodeOfType(child, "Identifier") && child.name === "Object"
        ? findTransparentExpressionRoot(child)
        : null;
    const member = objectReference?.parent;
    const memberRoot = isNodeOfType(member, "MemberExpression")
      ? findTransparentExpressionRoot(member)
      : null;
    const invocation = memberRoot?.parent;
    const isObjectDataCall = Boolean(
      options.allowDataOperations &&
      isNodeOfType(child, "Identifier") &&
      child.name === "Object" &&
      isNodeOfType(member, "MemberExpression") &&
      member.object === objectReference &&
      !member.optional &&
      (getStaticPropertyName(member) === "keys" ||
        getStaticPropertyName(member) === "values" ||
        getStaticPropertyName(member) === "entries") &&
      isNodeOfType(invocation, "CallExpression") &&
      invocation.callee === memberRoot &&
      !invocation.optional,
    );
    const dataPattern =
      isNodeOfType(child, "Property") && isNodeOfType(child.parent, "ObjectPattern")
        ? child.parent
        : null;
    const dataDeclaration = dataPattern?.parent;
    const dataSource =
      isNodeOfType(child, "MemberExpression") && child.computed
        ? child.object
        : isNodeOfType(child, "Property") &&
            child.computed &&
            dataPattern &&
            isNodeOfType(dataDeclaration, "VariableDeclarator") &&
            dataDeclaration.id === dataPattern
          ? dataDeclaration.init
          : null;
    const dataReceiver = options.allowDataOperations ? getRootIdentifier(dataSource) : null;
    const dataBinding = dataReceiver
      ? resolveConstIdentifierAlias(dataReceiver, scopes, true)
      : null;
    const isLocalDataAccess = Boolean(
      dataBinding &&
      !providerSymbolIds.has(dataBinding.id) &&
      !isErasedTypeScriptBinding(dataBinding) &&
      !isFunctionLike(dataBinding.declarationNode) &&
      !(dataBinding.initializer && isFunctionLike(stripParenExpression(dataBinding.initializer))),
    );
    if (isNodeOfType(child, "Identifier") && PROVIDER_GLOBAL_NAMES.has(child.name)) {
      const binding = scopes.symbolFor(child);
      if (
        binding &&
        scopes.referenceFor(child) &&
        isErasedTypeScriptBinding(binding) &&
        !hasRuntimeValueBinding(binding)
      ) {
        hasProviderHazard = true;
        return false;
      }
    }
    const dependency =
      getRuntimeStaticDependencySource(child) ?? getGlobalRequireModuleSource(child, scopes);
    if (
      dependency === "module" ||
      dependency === "node:module" ||
      isProvenGlobalNamespaceReference(child, "module", scopes)
    ) {
      hasProviderHazard = true;
    }
    if (isProvenGlobalNamespaceReference(child, "process", scopes)) {
      const referenceRoot = findTransparentExpressionRoot(child);
      const member = referenceRoot.parent;
      if (
        !isNodeOfType(member, "MemberExpression") ||
        member.object !== referenceRoot ||
        getStaticPropertyName(member) !== "env" ||
        isMemberMutationTarget(member)
      ) {
        hasProviderHazard = true;
      }
    }
    if (
      isNodeOfType(child, "WithStatement") ||
      isNodeOfType(child, "ImportExpression") ||
      isProvenGlobalNamespaceReference(child, "Function", scopes) ||
      isProvenGlobalNamespaceReference(child, "eval", scopes) ||
      (isProvenGlobalNamespaceReference(child, "Object", scopes) && !isObjectDataCall) ||
      isProvenGlobalNamespaceReference(child, "Reflect", scopes)
    ) {
      hasProviderHazard = true;
    }
    if (isProvenGlobalObjectReference(child, scopes)) {
      const referenceRoot = findTransparentExpressionRoot(child);
      const member = referenceRoot.parent;
      const propertyName = isNodeOfType(member, "MemberExpression")
        ? getResolvedStaticPropertyName(member, scopes)
        : null;
      if (
        propertyName === null ||
        propertyName === "Function" ||
        propertyName === "eval" ||
        propertyName === "Object" ||
        propertyName === "Reflect" ||
        propertyName === "module" ||
        propertyName === "process" ||
        propertyName === "require"
      ) {
        hasProviderHazard = true;
      }
    }
    if (
      (isNodeOfType(child, "MemberExpression") ||
        (isNodeOfType(child, "Property") && isNodeOfType(child.parent, "ObjectPattern"))) &&
      child.computed &&
      getResolvedStaticPropertyName(child, scopes, {
        allowConstNumericLiteral: true,
        allowConstTemplateLiteral: true,
        stringifyNonStringLiterals: true,
      }) === null &&
      !(options.allowNumericDataAccess && isNumericDataMemberAccess(child, scopes)) &&
      !isLocalDataAccess &&
      child !== options.allowedComputedDataMember
    ) {
      hasProviderHazard = true;
    }
    if (
      (isNodeOfType(child, "MemberExpression") ||
        (isNodeOfType(child, "Property") && isNodeOfType(child.parent, "ObjectPattern"))) &&
      getResolvedStaticPropertyName(child, scopes) === "constructor"
    ) {
      const constructorRoot = findTransparentExpressionRoot(child);
      const metadata = constructorRoot.parent;
      const metadataRoot = isNodeOfType(metadata, "MemberExpression")
        ? findTransparentExpressionRoot(metadata)
        : null;
      const consumer = metadataRoot?.parent;
      if (
        !isNodeOfType(child, "MemberExpression") ||
        !isNodeOfType(metadata, "MemberExpression") ||
        metadata.object !== constructorRoot ||
        (getStaticPropertyName(metadata) !== "name" &&
          getStaticPropertyName(metadata) !== "length") ||
        isMemberMutationTarget(metadata) ||
        (isNodeOfType(consumer, "CallExpression") && consumer.callee === metadataRoot)
      ) {
        hasProviderHazard = true;
      }
    }
    if (isNodeOfType(child, "Identifier") && scopes.isGlobalReference(child)) {
      if (child.name === "require") {
        const referenceRoot = findTransparentExpressionRoot(child);
        const invocation = referenceRoot.parent;
        if (
          !isNodeOfType(invocation, "CallExpression") ||
          invocation.callee !== referenceRoot ||
          invocation.optional ||
          invocation.arguments.length !== CANONICAL_REACT_REQUIRE_ARGUMENT_COUNT ||
          !isNodeOfType(invocation.arguments[0], "Literal") ||
          typeof invocation.arguments[0].value !== "string"
        ) {
          hasProviderHazard = true;
        }
      }
    }
    if (
      isNodeOfType(child, "CallExpression") &&
      child !== allowedRequire &&
      getGlobalRequireModuleSource(child, scopes) === "react"
    ) {
      hasProviderHazard = true;
    }
    if (!isNodeOfType(child, "MemberExpression") || !isMemberMutationTarget(child)) return;
    const identifier = getRootIdentifier(child.object);
    const provider = identifier ? scopes.symbolFor(identifier) : null;
    const propertyName = getStaticPropertyName(child);
    if (
      provider &&
      providerSymbolIds.has(provider.id) &&
      (propertyName === null || propertyName === hookName)
    ) {
      hasProviderHazard = true;
    }
  });
  return !hasProviderHazard;
};
