import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenGlobalObjectReference } from "../../../utils/is-proven-global-namespace-reference.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  GUARDED_MAP_CALLBACK_PARAMETER_LIMIT,
  GUARDED_MAP_DYNAMIC_PROVIDER_NAMES,
  GUARDED_MAP_EMPTY_ARGUMENT_COUNT,
  GUARDED_MAP_ERASED_PROVIDER_NAMES,
  GUARDED_MAP_GET_ARGUMENT_COUNT,
  GUARDED_MAP_KEY_ARGUMENT_INDEX,
  GUARDED_MAP_METHOD_NAMES,
  GUARDED_MAP_SET_ARGUMENT_COUNT,
} from "./constants.js";

const hasClosedLocalMapReferences = (
  receiver: EsTreeNodeOfType<"Identifier">,
  context: RuleContext,
): boolean => {
  const symbol = context.scopes.symbolFor(receiver);
  const initializer = symbol ? getDirectConstInitializer(symbol) : null;
  const construction = initializer ? stripParenExpression(initializer) : null;
  if (
    !symbol ||
    !isNodeOfType(construction, "NewExpression") ||
    !isNodeOfType(construction.callee, "Identifier") ||
    construction.callee.name !== "Map" ||
    !context.scopes.isGlobalReference(construction.callee) ||
    construction.arguments.length !== GUARDED_MAP_EMPTY_ARGUMENT_COUNT
  ) {
    return false;
  }
  for (const reference of symbol.references) {
    if (reference.flag !== "read") return false;
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const member = referenceRoot.parent;
    if (
      isNodeOfType(member, "CallExpression") &&
      member.arguments.length === GUARDED_MAP_GET_ARGUMENT_COUNT &&
      member.arguments[GUARDED_MAP_KEY_ARGUMENT_INDEX] === referenceRoot
    ) {
      const conversion = stripParenExpression(member.callee);
      if (
        isNodeOfType(conversion, "MemberExpression") &&
        !conversion.computed &&
        !conversion.optional &&
        !member.optional &&
        isNodeOfType(conversion.object, "Identifier") &&
        conversion.object.name === "Array" &&
        context.scopes.isGlobalReference(conversion.object) &&
        isNodeOfType(conversion.property, "Identifier") &&
        conversion.property.name === "from"
      )
        continue;
      return false;
    }
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== referenceRoot ||
      member.computed ||
      member.optional ||
      !isNodeOfType(member.property, "Identifier") ||
      !GUARDED_MAP_METHOD_NAMES.has(member.property.name)
    ) {
      return false;
    }
    const call = findTransparentExpressionRoot(member).parent;
    if (
      !isNodeOfType(call, "CallExpression") ||
      stripParenExpression(call.callee) !== member ||
      call.optional ||
      call.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
    ) {
      return false;
    }
    const argumentCount =
      member.property.name === "set"
        ? GUARDED_MAP_SET_ARGUMENT_COUNT
        : GUARDED_MAP_GET_ARGUMENT_COUNT;
    if (call.arguments.length !== argumentCount) return false;
    if (member.property.name !== "forEach") continue;
    const callback = stripParenExpression(call.arguments[GUARDED_MAP_KEY_ARGUMENT_INDEX]);
    if (
      !isNodeOfType(callback, "ArrowFunctionExpression") ||
      callback.async ||
      callback.generator ||
      callback.params.length > GUARDED_MAP_CALLBACK_PARAMETER_LIMIT ||
      callback.params.some((parameter) => !isNodeOfType(parameter, "Identifier"))
    ) {
      return false;
    }
  }
  const program = findProgramRoot(receiver);
  if (!program) return false;
  let hasProviderExposure = false;
  walkAst(program, (node) => {
    if (hasProviderExposure || isTypeScriptTypePosition(node)) return false;
    if (isNodeOfType(node, "WithStatement")) {
      hasProviderExposure = true;
      return false;
    }
    if (
      (isNodeOfType(node, "MemberExpression") ||
        (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"))) &&
      getResolvedStaticPropertyName(node, context.scopes) === "constructor"
    ) {
      hasProviderExposure = true;
      return false;
    }
    if (!isNodeOfType(node, "Identifier") || !context.scopes.referenceFor(node)) return;
    const providerSymbol = context.scopes.symbolFor(node);
    if (
      GUARDED_MAP_ERASED_PROVIDER_NAMES.has(node.name) &&
      providerSymbol &&
      providerSymbol.bindingIdentifier !== node &&
      isErasedTypeScriptBinding(providerSymbol) &&
      !hasRuntimeValueBinding(providerSymbol)
    ) {
      hasProviderExposure = true;
      return false;
    }
    if (
      GUARDED_MAP_DYNAMIC_PROVIDER_NAMES.has(node.name) &&
      context.scopes.isGlobalReference(node)
    ) {
      hasProviderExposure = true;
      return;
    }
    if (node.name === "Map" && context.scopes.isGlobalReference(node)) {
      if (node !== construction.callee) hasProviderExposure = true;
      return;
    }
    if (node.name === "Array" && context.scopes.isGlobalReference(node)) {
      const member = findTransparentExpressionRoot(node).parent;
      const call = member ? findTransparentExpressionRoot(member).parent : null;
      const argument = isNodeOfType(call, "CallExpression")
        ? call.arguments[GUARDED_MAP_KEY_ARGUMENT_INDEX]
        : null;
      if (
        !isNodeOfType(member, "MemberExpression") ||
        member.computed ||
        member.optional ||
        !isNodeOfType(member.property, "Identifier") ||
        member.property.name !== "from" ||
        !isNodeOfType(call, "CallExpression") ||
        stripParenExpression(call.callee) !== member ||
        call.optional ||
        call.arguments.length !== GUARDED_MAP_GET_ARGUMENT_COUNT ||
        !argument ||
        !isNodeOfType(stripParenExpression(argument), "Identifier") ||
        context.scopes.symbolFor(stripParenExpression(argument))?.id !== symbol.id
      )
        hasProviderExposure = true;
      return;
    }
    if (isProvenGlobalObjectReference(node, context.scopes)) hasProviderExposure = true;
  });
  return !hasProviderExposure;
};

const closedMapReferencesBySymbol = new WeakMap<SymbolDescriptor, boolean>();

export const isClosedLocalMapReference = (
  receiver: EsTreeNodeOfType<"Identifier">,
  context: RuleContext,
): boolean => {
  const symbol = context.scopes.symbolFor(receiver);
  if (!symbol) return false;
  const cached = closedMapReferencesBySymbol.get(symbol);
  if (cached !== undefined) return cached;
  const isClosed = hasClosedLocalMapReferences(receiver, context);
  closedMapReferencesBySymbol.set(symbol, isClosed);
  return isClosed;
};
