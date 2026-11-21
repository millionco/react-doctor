import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getImportedName } from "./get-imported-name.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getValueImportSource } from "./get-value-import-declaration.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const opaqueProviderNames = new Set([
  "React",
  "Object",
  "Reflect",
  "Function",
  "eval",
  "require",
  "module",
  "global",
  "globalThis",
  "self",
  "window",
]);
const closedProviderByAnalysis = new WeakMap<ScopeAnalysis, boolean>();

const isReactNamespaceImport = (symbol: SymbolDescriptor): boolean =>
  isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") ||
  isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier") ||
  getImportedName(symbol.declarationNode) === "default";

const isDirectReactNamespaceMember = (member: EsTreeNode | null | undefined): boolean =>
  isNodeOfType(member, "MemberExpression") &&
  !member.computed &&
  !member.optional &&
  isNodeOfType(member.property, "Identifier");

const isDirectReactImportUse = (identifier: EsTreeNode, symbol: SymbolDescriptor): boolean => {
  if (isWithinAssignmentTarget(identifier)) return false;
  let target = findTransparentExpressionRoot(identifier);
  if (isReactNamespaceImport(symbol)) {
    const member = target.parent;
    if (
      !isNodeOfType(member, "MemberExpression") ||
      !isDirectReactNamespaceMember(member) ||
      member.object !== target
    )
      return false;
    target = findTransparentExpressionRoot(member);
  }
  const call = target.parent;
  return isNodeOfType(call, "CallExpression") && call.callee === target && !call.optional;
};

const readsOpaqueProviderCapability = (node: EsTreeNode): boolean => {
  const isMember = isNodeOfType(node, "MemberExpression");
  if (!isMember && (!isNodeOfType(node, "Property") || !isNodeOfType(node.parent, "ObjectPattern")))
    return false;
  const key = isMember ? node.property : node.key;
  if (
    node.computed &&
    isNodeOfType(key, "Literal") &&
    typeof key.value === "number" &&
    Number.isSafeInteger(key.value) &&
    key.value >= 0
  )
    return false;
  const name = getStaticPropertyKeyName(node, { allowComputedString: true });
  return name === "constructor" || name === "__proto__" || (node.computed && name === null);
};

const hasClosedReactHookProvider = (scopes: ScopeAnalysis): boolean => {
  const cached = closedProviderByAnalysis.get(scopes);
  if (cached !== undefined) return cached;
  let closed = true;
  walkAst(scopes.rootScope.node, (node) => {
    if (!closed || isTypeScriptTypePosition(node)) return false;
    if (
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "ImportExpression") ||
      (isNodeOfType(node, "ImportDeclaration") &&
        node.importKind !== "type" &&
        (node.source.value === "module" || node.source.value === "node:module")) ||
      readsOpaqueProviderCapability(node)
    )
      closed = false;
  });
  const pending = [scopes.rootScope];
  while (closed && pending.length > 0) {
    const scope = pending.pop();
    if (!scope) break;
    pending.push(...scope.children);
    for (const reference of scope.references) {
      if (isTypeScriptTypePosition(reference.identifier)) continue;
      const symbol = reference.resolvedSymbol;
      if (symbol && getValueImportSource(symbol) === "react") {
        if (reference.flag !== "read" || !isDirectReactImportUse(reference.identifier, symbol)) {
          closed = false;
          break;
        }
      } else if (
        isNodeOfType(reference.identifier, "Identifier") &&
        opaqueProviderNames.has(reference.identifier.name)
      ) {
        closed = false;
        break;
      }
    }
  }
  closedProviderByAnalysis.set(scopes, closed);
  return closed;
};

export const isClosedReactHookCall = (
  expression: EsTreeNode,
  hookName: string,
  scopes: ScopeAnalysis,
): boolean => {
  const call = stripParenExpression(expression);
  if (!isNodeOfType(call, "CallExpression") || call.optional) return false;
  const callee = stripParenExpression(call.callee);
  const member = isNodeOfType(callee, "MemberExpression") ? callee : null;
  if (member && !isDirectReactNamespaceMember(member)) return false;
  const identifier = member ? stripParenExpression(member.object) : callee;
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const symbol = scopes.symbolFor(identifier);
  return Boolean(
    symbol &&
    getValueImportSource(symbol) === "react" &&
    (member
      ? isReactNamespaceImport(symbol) && getStaticPropertyName(member) === hookName
      : getImportedName(symbol.declarationNode) === hookName) &&
    hasClosedReactHookProvider(scopes),
  );
};
