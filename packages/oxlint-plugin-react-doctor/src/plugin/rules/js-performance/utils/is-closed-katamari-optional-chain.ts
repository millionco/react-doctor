import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenGlobalNamespaceReference } from "../../../utils/is-proven-global-namespace-reference.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  OPTIONAL_BINDER_METHOD_NAMES,
  OPTIONAL_FACTORY_METHOD_NAMES,
  OPTIONAL_WRAPPER_METHOD_NAMES,
  OPTIONAL_PROVIDER_MUTATION_METHOD_NAMES,
  OPTIONAL_PROVIDER_HAZARD_NAMES,
  OPTIONAL_SINGLE_ARGUMENT_COUNT,
  OPTIONAL_NO_ARGUMENT_COUNT,
} from "./constants.js";

const closedProviderByAnalysis = new WeakMap<ScopeAnalysis, boolean>();

const getProviderRole = (symbol: SymbolDescriptor): string | null => {
  const importedName = getImportedName(symbol.declarationNode);
  const source = getValueImportSource(symbol);
  if (source === "@ephox/katamari" && importedName === "Optional") return "Optional";
  if (source === "@ephox/sugar" && importedName === "Traverse") return "Traverse";
  return null;
};

const isSupportedProviderReference = (identifier: EsTreeNode, role: string): boolean => {
  const receiver = findTransparentExpressionRoot(identifier);
  const member = receiver.parent;
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.object !== receiver ||
    member.computed ||
    member.optional ||
    !isNodeOfType(member.property, "Identifier")
  )
    return false;
  if (
    role === "Optional"
      ? !OPTIONAL_FACTORY_METHOD_NAMES.has(member.property.name)
      : member.property.name !== "firstChild"
  )
    return false;
  const target = findTransparentExpressionRoot(member);
  const call = target.parent;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
  )
    return false;
  if (call.callee === target) return true;
  return (
    role === "Traverse" &&
    call.arguments.length === OPTIONAL_SINGLE_ARGUMENT_COUNT &&
    call.arguments[0] === target &&
    isNodeOfType(call.callee, "MemberExpression") &&
    !call.callee.computed &&
    !call.callee.optional &&
    isNodeOfType(call.callee.property, "Identifier") &&
    call.callee.property.name === "bind"
  );
};

const hasClosedOptionalProviders = (scopes: ScopeAnalysis): boolean => {
  const cached = closedProviderByAnalysis.get(scopes);
  if (cached !== undefined) return cached;
  let closed = true;
  walkAst(scopes.rootScope.node, (node) => {
    if (isNodeOfType(node, "Identifier") && !isTypeScriptTypePosition(node)) {
      const reference = findTransparentExpressionRoot(node);
      const member = reference.parent;
      const isGlobalCarrier = ["globalThis", "window", "self", "global"].includes(node.name);
      const providerName = isGlobalCarrier
        ? isNodeOfType(member, "MemberExpression") && member.object === reference
          ? getStaticPropertyName(member)
          : null
        : node.name;
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
          ["Object", "Reflect", "Function", "require", "module"].includes(providerName))
          ? scopes.symbolFor(node)
          : null;
      if (
        symbol &&
        symbol.bindingIdentifier !== node &&
        isErasedTypeScriptBinding(symbol) &&
        !hasRuntimeValueBinding(symbol)
      ) {
        closed = false;
        return false;
      }
    }
    if (!closed || isTypeScriptTypePosition(node)) return false;
    if (
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "ImportExpression") ||
      (isNodeOfType(node, "ImportDeclaration") &&
        node.importKind !== "type" &&
        (node.source.value === "module" || node.source.value === "node:module")) ||
      OPTIONAL_PROVIDER_HAZARD_NAMES.some((name) =>
        isProvenGlobalNamespaceReference(node, name, scopes),
      )
    )
      closed = false;
    if (isNodeOfType(node, "MemberExpression")) {
      const name = getStaticPropertyName(node);
      if (
        name === "constructor" ||
        name === "__proto__" ||
        (isWithinAssignmentTarget(node) &&
          (node.computed || (name !== null && OPTIONAL_PROVIDER_MUTATION_METHOD_NAMES.has(name))))
      )
        closed = false;
    }
    if (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern")) {
      const name = getStaticPropertyKeyName(node, { allowComputedString: true });
      if (name === "constructor" || name === "__proto__") closed = false;
    }
  });
  const pending = [scopes.rootScope];
  while (closed && pending.length) {
    const scope = pending.pop();
    if (!scope) break;
    pending.push(...scope.children);
    for (const symbol of scope.symbols) {
      const source = getValueImportSource(symbol);
      if (
        (source === "@ephox/katamari" || source === "@ephox/sugar") &&
        (isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") ||
          isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier"))
      ) {
        closed = false;
        break;
      }
      const role = getProviderRole(symbol);
      if (!role) continue;
      if (
        symbol.references.some(
          (reference) =>
            !isTypeScriptTypePosition(reference.identifier) &&
            (reference.flag !== "read" ||
              isWithinAssignmentTarget(reference.identifier) ||
              !isSupportedProviderReference(reference.identifier, role)),
        )
      ) {
        closed = false;
        break;
      }
    }
  }
  closedProviderByAnalysis.set(scopes, closed);
  return closed;
};

const isCanonicalProviderMember = (
  expression: EsTreeNode,
  role: string,
  methodNames: ReadonlySet<string>,
  scopes: ScopeAnalysis,
): boolean => {
  const member = stripParenExpression(expression);
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.computed ||
    member.optional ||
    !isNodeOfType(member.property, "Identifier") ||
    !methodNames.has(member.property.name)
  )
    return false;
  const receiver = stripParenExpression(member.object);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const symbol = scopes.symbolFor(receiver);
  return Boolean(symbol && getProviderRole(symbol) === role);
};

export const isClosedKatamariOptionalChain = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!hasClosedOptionalProviders(scopes)) return false;
  let cursor = stripParenExpression(expression);
  while (
    isNodeOfType(cursor, "CallExpression") &&
    !cursor.optional &&
    !cursor.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
  ) {
    const callee = stripParenExpression(cursor.callee);
    if (
      !isNodeOfType(callee, "MemberExpression") ||
      callee.computed ||
      callee.optional ||
      !isNodeOfType(callee.property, "Identifier")
    )
      return false;
    const method = callee.property.name;
    if (isCanonicalProviderMember(callee, "Optional", OPTIONAL_FACTORY_METHOD_NAMES, scopes))
      return (
        cursor.arguments.length ===
        (method === "none" ? OPTIONAL_NO_ARGUMENT_COUNT : OPTIONAL_SINGLE_ARGUMENT_COUNT)
      );
    if (cursor.arguments.length !== OPTIONAL_SINGLE_ARGUMENT_COUNT) return false;
    if (
      !OPTIONAL_WRAPPER_METHOD_NAMES.has(method) &&
      !(
        method === "bind" &&
        isCanonicalProviderMember(
          cursor.arguments[0],
          "Traverse",
          OPTIONAL_BINDER_METHOD_NAMES,
          scopes,
        )
      )
    )
      return false;
    cursor = stripParenExpression(callee.object);
  }
  return false;
};
