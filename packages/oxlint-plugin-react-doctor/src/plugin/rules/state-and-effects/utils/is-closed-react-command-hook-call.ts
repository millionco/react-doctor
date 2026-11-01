import { getDefaultOrNamespaceImportKind } from "../../../utils/get-default-or-namespace-import-kind.js";
import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
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
import { IMPERATIVE_COMMAND_PROVIDER_HAZARD_NAMES } from "./constants.js";

const closedProvidersByAnalysis = new WeakMap<ScopeAnalysis, boolean>();

const hasClosedReactCommandProvider = (scopes: ScopeAnalysis): boolean => {
  const cached = closedProvidersByAnalysis.get(scopes);
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
          ["Object", "Reflect", "Function", "require", "module", "React"].includes(providerName))
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
      IMPERATIVE_COMMAND_PROVIDER_HAZARD_NAMES.some((name) =>
        isProvenGlobalNamespaceReference(node, name, scopes),
      ) ||
      (isNodeOfType(node, "MemberExpression") &&
        (getStaticPropertyName(node) === "constructor" ||
          getStaticPropertyName(node) === "__proto__")) ||
      (isNodeOfType(node, "Property") &&
        isNodeOfType(node.parent, "ObjectPattern") &&
        (getStaticPropertyKeyName(node, { allowComputedString: true }) === "constructor" ||
          getStaticPropertyKeyName(node, { allowComputedString: true }) === "__proto__"))
    )
      closed = false;
  });
  const pending = [scopes.rootScope];
  while (closed && pending.length) {
    const scope = pending.pop();
    if (!scope) break;
    pending.push(...scope.children);
    for (const symbol of scope.symbols) {
      if (getValueImportSource(symbol) !== "react") continue;
      for (const reference of symbol.references) {
        if (isTypeScriptTypePosition(reference.identifier)) continue;
        if (reference.flag !== "read" || isWithinAssignmentTarget(reference.identifier)) {
          closed = false;
          break;
        }
        let target = findTransparentExpressionRoot(reference.identifier);
        if (getDefaultOrNamespaceImportKind(symbol) !== null) {
          let member = target.parent;
          if (!isNodeOfType(member, "MemberExpression") || member.object !== target) {
            closed = false;
            break;
          }
          while (isNodeOfType(member, "MemberExpression") && member.object === target) {
            if (
              member.computed ||
              member.optional ||
              !isNodeOfType(member.property, "Identifier")
            ) {
              closed = false;
              break;
            }
            target = findTransparentExpressionRoot(member);
            member = target.parent;
          }
        }
        const call = target.parent;
        if (!isNodeOfType(call, "CallExpression") || call.callee !== target || call.optional) {
          closed = false;
          break;
        }
      }
    }
  }
  closedProvidersByAnalysis.set(scopes, closed);
  return closed;
};

export const isClosedReactCommandHookCall = (
  expression: EsTreeNode,
  hookName: string,
  scopes: ScopeAnalysis,
): boolean => {
  const call = stripParenExpression(expression);
  if (!isNodeOfType(call, "CallExpression") || call.optional) return false;
  const callee = stripParenExpression(call.callee);
  const identifier = isNodeOfType(callee, "Identifier")
    ? callee
    : isNodeOfType(callee, "MemberExpression") &&
        !callee.computed &&
        !callee.optional &&
        isNodeOfType(callee.object, "Identifier") &&
        isNodeOfType(callee.property, "Identifier") &&
        callee.property.name === hookName
      ? callee.object
      : null;
  if (!identifier) return false;
  const symbol = scopes.symbolFor(identifier);
  return Boolean(
    symbol &&
    getValueImportSource(symbol) === "react" &&
    (isNodeOfType(callee, "Identifier")
      ? getImportedName(symbol.declarationNode) === hookName
      : getDefaultOrNamespaceImportKind(symbol) !== null) &&
    hasClosedReactCommandProvider(scopes),
  );
};
