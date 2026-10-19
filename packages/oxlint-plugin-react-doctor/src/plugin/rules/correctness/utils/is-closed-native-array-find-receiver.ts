import {
  DYNAMIC_PROVIDER_NAMES,
  FIND_METHOD_NAMES,
  PROVIDER_KEYS,
  RUNTIME_TYPESCRIPT_PROVIDER_NODES,
} from "./native-array-find/constants.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

const providerSafetyByAnalysis = new WeakMap<ScopeAnalysis, boolean>();
const receiverSafetyByAnalysis = new WeakMap<ScopeAnalysis, Map<number, boolean>>();

const isNativeProviderReference = (
  identifier: EsTreeNodeOfType<"Identifier">,
  scopes: ScopeAnalysis,
): boolean => {
  if (scopes.isGlobalReference(identifier)) return true;
  const symbol = scopes.symbolFor(identifier);
  return Boolean(
    symbol &&
    (symbol.kind === "ts-interface" || symbol.kind === "ts-type-alias") &&
    !hasRuntimeValueBinding(symbol),
  );
};

const hasClosedProvider = (scopes: ScopeAnalysis): boolean => {
  const cached = providerSafetyByAnalysis.get(scopes);
  if (cached !== undefined) return cached;
  let isClosed = true;
  walkAst(scopes.rootScope.node, (node) => {
    if (
      !isClosed ||
      isNodeOfType(node, "TSInterfaceDeclaration") ||
      isNodeOfType(node, "TSTypeAliasDeclaration")
    ) {
      return false;
    }
    if (RUNTIME_TYPESCRIPT_PROVIDER_NODES.has(node.type)) {
      isClosed = false;
      return false;
    }
    if (
      isNodeOfType(node, "Identifier") &&
      !isTypeScriptTypePosition(node) &&
      DYNAMIC_PROVIDER_NAMES.has(node.name) &&
      isNativeProviderReference(node, scopes)
    ) {
      isClosed = false;
    }
    if (isNodeOfType(node, "MemberExpression")) {
      const propertyName = getStaticPropertyName(node);
      if (
        PROVIDER_KEYS.has(propertyName ?? "") ||
        (node.computed && propertyName === null) ||
        (isWithinAssignmentTarget(node) &&
          (propertyName === null || FIND_METHOD_NAMES.has(propertyName)))
      ) {
        isClosed = false;
      }
    }
    if (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern")) {
      const propertyName = getStaticPropertyKeyName(node, { allowComputedString: true });
      if (node.computed || propertyName === null || PROVIDER_KEYS.has(propertyName)) {
        isClosed = false;
      }
    }
    if (isNodeOfType(node, "RestElement") && isNodeOfType(node.parent, "ObjectPattern")) {
      isClosed = false;
    }
    return undefined;
  });
  providerSafetyByAnalysis.set(scopes, isClosed);
  return isClosed;
};

const isClosedFindReceiverRead = (identifier: EsTreeNode): boolean => {
  const receiverRoot = findTransparentExpressionRoot(identifier);
  const member = receiverRoot.parent;
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.object !== receiverRoot ||
    member.optional ||
    !FIND_METHOD_NAMES.has(getStaticPropertyName(member) ?? "")
  ) {
    return false;
  }
  const call = member.parent;
  if (!isNodeOfType(call, "CallExpression") || call.callee !== member || call.optional) {
    return false;
  }
  const [callbackArgument, ...remainingArguments] = call.arguments;
  if (!callbackArgument || remainingArguments.length > 0) return false;
  const callback = stripParenExpression(callbackArgument);
  if (!isNodeOfType(callback, "ArrowFunctionExpression") || callback.async) return false;
  const [parameter, ...remainingParameters] = callback.params;
  return remainingParameters.length === 0 && (!parameter || isNodeOfType(parameter, "Identifier"));
};

export const isClosedNativeArrayFindReceiver = (
  receiver: EsTreeNodeOfType<"Identifier">,
  context: RuleContext,
): boolean => {
  const symbol = context.scopes.symbolFor(receiver);
  if (!symbol) return false;
  const cached = receiverSafetyByAnalysis.get(context.scopes)?.get(symbol.id);
  if (cached !== undefined) return cached;
  const safetyBySymbol = receiverSafetyByAnalysis.get(context.scopes) ?? new Map<number, boolean>();
  receiverSafetyByAnalysis.set(context.scopes, safetyBySymbol);
  const initializer = getDirectConstInitializer(symbol);
  const declaration = symbol.declarationNode.parent;
  const isClosed = Boolean(
    initializer &&
    isNodeOfType(stripParenExpression(initializer), "ArrayExpression") &&
    isNodeOfType(declaration, "VariableDeclaration") &&
    !isNodeOfType(declaration.parent, "ExportNamedDeclaration") &&
    hasClosedProvider(context.scopes) &&
    symbol.references.every((reference) =>
      isTypeScriptTypePosition(reference.identifier)
        ? true
        : reference.flag === "read" && isClosedFindReceiverRead(reference.identifier),
    ),
  );
  safetyBySymbol.set(symbol.id, isClosed);
  return isClosed;
};
