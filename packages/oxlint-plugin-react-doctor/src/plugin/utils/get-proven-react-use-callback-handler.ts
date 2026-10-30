import { hasRuntimeValueBinding } from "./has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "./is-erased-typescript-binding.js";
import {
  PASSIVE_CALLBACK_ARGUMENT_COUNT,
  PASSIVE_CALLBACK_ARGUMENT_INDEX,
  PASSIVE_CALLBACK_DEPENDENCIES_ARGUMENT_INDEX,
  PASSIVE_CALLBACK_PARAMETER_COUNT,
  PASSIVE_CALLBACK_UNSUPPORTED_GLOBALS,
  PASSIVE_CALLBACK_GLOBAL_NAMESPACES,
} from "../constants/passive-listeners.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findProgramRoot } from "./find-program-root.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getImportedName } from "./get-imported-name.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getRootIdentifier } from "./get-root-identifier.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isBindingAssignmentTarget } from "./is-binding-assignment-target.js";
import { isMemberMutationTarget } from "./is-member-mutation-target.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const hasUnsupportedProviderExecution = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const program = findProgramRoot(node);
  if (!program) return true;
  let hasUnsupportedExecution = false;
  walkAst(program, (candidate) => {
    if (isNodeOfType(candidate, "Identifier") && !isTypeScriptTypePosition(candidate)) {
      const reference = findTransparentExpressionRoot(candidate);
      const member = reference.parent;
      const isGlobalCarrier = ["globalThis", "window", "self", "global"].includes(candidate.name);
      const providerName = isGlobalCarrier
        ? isNodeOfType(member, "MemberExpression") && member.object === reference
          ? getStaticPropertyName(member)
          : null
        : candidate.name;
      const hasOpaqueCarrierUse =
        isGlobalCarrier &&
        !(
          isNodeOfType(member, "MemberExpression") &&
          member.object === reference &&
          getStaticPropertyName(member) !== null
        ) &&
        !(
          isNodeOfType(member, "UnaryExpression") &&
          (member.operator === "typeof" || member.operator === "void")
        );
      const symbol =
        hasOpaqueCarrierUse ||
        (providerName &&
          [
            "Function",
            "require",
            "module",
            "Event",
            "UIEvent",
            "MouseEvent",
            "WheelEvent",
            "TouchEvent",
          ].includes(providerName))
          ? scopes.symbolFor(candidate)
          : null;
      if (
        symbol &&
        symbol.bindingIdentifier !== candidate &&
        isErasedTypeScriptBinding(symbol) &&
        !hasRuntimeValueBinding(symbol)
      ) {
        hasUnsupportedExecution = true;
        return false;
      }
    }
    if (hasUnsupportedExecution) return false;
    if (isTypeScriptTypePosition(candidate)) return false;
    if (
      isNodeOfType(candidate, "ImportExpression") ||
      (isNodeOfType(candidate, "ImportDeclaration") &&
        candidate.importKind !== "type" &&
        (candidate.source.value === "module" || candidate.source.value === "node:module"))
    ) {
      hasUnsupportedExecution = true;
      return false;
    }
    if (isNodeOfType(candidate, "MemberExpression")) {
      const propertyName = getStaticPropertyName(candidate);
      if (propertyName === "constructor" || propertyName === "__proto__") {
        hasUnsupportedExecution = true;
        return false;
      }
    }
    if (!isNodeOfType(candidate, "Identifier") || !scopes.isGlobalReference(candidate)) return;
    if (PASSIVE_CALLBACK_UNSUPPORTED_GLOBALS.has(candidate.name)) {
      hasUnsupportedExecution = true;
      return false;
    }
    if (!PASSIVE_CALLBACK_GLOBAL_NAMESPACES.has(candidate.name)) return;
    const referenceRoot = findTransparentExpressionRoot(candidate);
    const member = referenceRoot.parent;
    const propertyName =
      isNodeOfType(member, "MemberExpression") && member.object === referenceRoot
        ? getStaticPropertyName(member)
        : null;
    if (!propertyName || PASSIVE_CALLBACK_UNSUPPORTED_GLOBALS.has(propertyName)) {
      hasUnsupportedExecution = true;
      return false;
    }
  });
  return hasUnsupportedExecution;
};

const supportedProvidersByScopes = new WeakMap<ScopeAnalysis, boolean>();

const hasClosedReactProviders = (scopes: ScopeAnalysis): boolean => {
  return scopes.rootScope.symbols.every((symbol) => {
    const declaration = getImportDeclarationForSymbol(symbol);
    if (!declaration || declaration.source.value !== "react") return true;
    if (
      declaration.importKind === "type" ||
      (isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
        symbol.declarationNode.importKind === "type")
    ) {
      return true;
    }
    const isNamespace =
      isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") ||
      isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier") ||
      getImportedName(symbol.declarationNode) === "default";
    return symbol.references.every((reference) => {
      if (isTypeScriptTypePosition(reference.identifier)) return true;
      if (reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier)) {
        return false;
      }
      let expression = findTransparentExpressionRoot(reference.identifier);
      if (isNamespace) {
        const member = expression.parent;
        if (
          !isNodeOfType(member, "MemberExpression") ||
          member.object !== expression ||
          member.optional ||
          isMemberMutationTarget(member)
        ) {
          return false;
        }
        const propertyName = getStaticPropertyName(member);
        if (!propertyName || propertyName === "default") return false;
        expression = findTransparentExpressionRoot(member);
      }
      const invocation = expression.parent;
      return (
        isNodeOfType(invocation, "CallExpression") &&
        invocation.callee === expression &&
        !invocation.optional
      );
    });
  });
};

const hasSupportedReactProviders = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const cached = supportedProvidersByScopes.get(scopes);
  if (cached !== undefined) return cached;
  const supported =
    hasClosedReactProviders(scopes) && !hasUnsupportedProviderExecution(node, scopes);
  supportedProvidersByScopes.set(scopes, supported);
  return supported;
};

const hasReadonlyEventParameter = (
  callback: EsTreeNodeOfType<"ArrowFunctionExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const parameter = callback.params[PASSIVE_CALLBACK_ARGUMENT_INDEX];
  if (!isNodeOfType(parameter, "Identifier")) return false;
  const symbol = scopes.symbolFor(parameter);
  if (
    !symbol ||
    symbol.references.some(
      (reference) => reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier),
    )
  ) {
    return false;
  }
  let hasMemberWrite = false;
  walkAst(callback.body, (node) => {
    if (hasMemberWrite) return false;
    if (isNodeOfType(node, "MemberExpression") && isMemberMutationTarget(node)) {
      hasMemberWrite = true;
    }
  });
  return !hasMemberWrite;
};

export const getProvenReactUseCallbackHandler = (
  rawHandler: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNodeOfType<"ArrowFunctionExpression"> | null => {
  const handler = stripParenExpression(rawHandler);
  if (!isNodeOfType(handler, "Identifier")) return null;
  const symbol = scopes.symbolFor(handler);
  if (
    symbol?.kind !== "const" ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier ||
    !symbol.initializer ||
    symbol.references.some(
      (reference) => reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier),
    )
  ) {
    return null;
  }
  const invocation = stripParenExpression(symbol.initializer);
  if (
    !isNodeOfType(invocation, "CallExpression") ||
    invocation.optional ||
    invocation.arguments.length !== PASSIVE_CALLBACK_ARGUMENT_COUNT ||
    invocation.arguments.some((argument) => isNodeOfType(argument, "SpreadElement")) ||
    !isReactApiCall(invocation, "useCallback", scopes)
  ) {
    return null;
  }
  const providerIdentifier = getRootIdentifier(invocation.callee);
  const provider = providerIdentifier ? scopes.symbolFor(providerIdentifier) : null;
  const declaration = provider ? getImportDeclarationForSymbol(provider) : null;
  if (
    !declaration ||
    declaration.source.value !== "react" ||
    declaration.importKind === "type" ||
    (provider &&
      isNodeOfType(provider.declarationNode, "ImportSpecifier") &&
      provider.declarationNode.importKind === "type") ||
    !hasSupportedReactProviders(invocation, scopes)
  ) {
    return null;
  }
  const callback = invocation.arguments[PASSIVE_CALLBACK_ARGUMENT_INDEX];
  const dependencies = invocation.arguments[PASSIVE_CALLBACK_DEPENDENCIES_ARGUMENT_INDEX];
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== PASSIVE_CALLBACK_PARAMETER_COUNT ||
    !isNodeOfType(dependencies, "ArrayExpression") ||
    dependencies.elements.some((element) => isNodeOfType(element, "SpreadElement")) ||
    !hasReadonlyEventParameter(callback, scopes)
  ) {
    return null;
  }
  return callback;
};
