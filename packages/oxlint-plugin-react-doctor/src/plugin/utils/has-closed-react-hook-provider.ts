import { getDefaultOrNamespaceImportKind } from "./get-default-or-namespace-import-kind.js";
import { hasRuntimeValueBinding } from "./has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "./is-erased-typescript-binding.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getGlobalRequireModuleSource } from "./get-global-require-module-source.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getValueImportSource } from "./get-value-import-declaration.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { isProvenGlobalNamespaceReference } from "./is-proven-global-namespace-reference.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const closedReactImportsByAnalysis = new WeakMap<ScopeAnalysis, boolean>();

const hasClosedReactImports = (scopes: ScopeAnalysis): boolean => {
  const cached = closedReactImportsByAnalysis.get(scopes);
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
        (providerName && ["Function", "require", "module", "React"].includes(providerName))
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
    if (isTypeScriptTypePosition(node)) return false;
    if (
      isNodeOfType(node, "WithStatement") ||
      (isNodeOfType(node, "ImportDeclaration") &&
        node.importKind !== "type" &&
        (node.source.value === "node:module" || node.source.value === "module")) ||
      isProvenGlobalNamespaceReference(node, "eval", scopes) ||
      isProvenGlobalNamespaceReference(node, "Function", scopes) ||
      isProvenGlobalNamespaceReference(node, "require", scopes) ||
      isProvenGlobalNamespaceReference(node, "module", scopes) ||
      (isNodeOfType(node, "MemberExpression") && getStaticPropertyName(node) === "constructor") ||
      (isNodeOfType(node, "Property") &&
        isNodeOfType(node.parent, "ObjectPattern") &&
        getStaticPropertyKeyName(node, { allowComputedString: true }) === "constructor") ||
      isProvenGlobalNamespaceReference(node, "React", scopes) ||
      (isNodeOfType(node, "CallExpression") &&
        getGlobalRequireModuleSource(node, scopes) === "react") ||
      (isNodeOfType(node, "ImportExpression") &&
        isNodeOfType(node.source, "Literal") &&
        (node.source.value === "react" ||
          node.source.value === "node:module" ||
          node.source.value === "module"))
    )
      closed = false;
  });
  const pending = [scopes.rootScope];
  while (closed && pending.length > 0) {
    const scope = pending.pop();
    if (!scope) break;
    pending.push(...scope.children);
    for (const reference of scope.references) {
      const identifier = reference.identifier;
      if (isTypeScriptTypePosition(identifier)) continue;
      if (
        isNodeOfType(identifier, "Identifier") &&
        identifier.name === "React" &&
        scopes.isGlobalReference(identifier)
      )
        closed = false;
    }
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
          const member = target.parent;
          if (
            !isNodeOfType(member, "MemberExpression") ||
            member.object !== target ||
            member.computed ||
            member.optional ||
            !isNodeOfType(member.property, "Identifier") ||
            isWithinAssignmentTarget(member)
          ) {
            closed = false;
            break;
          }
          target = findTransparentExpressionRoot(member);
        }
        const call = target.parent;
        if (!isNodeOfType(call, "CallExpression") || call.callee !== target || call.optional) {
          closed = false;
          break;
        }
      }
    }
  }
  closedReactImportsByAnalysis.set(scopes, closed);
  return closed;
};

export const hasClosedReactHookProvider = (
  call: EsTreeNodeOfType<"CallExpression">,
  apiNames: string | ReadonlySet<string>,
  scopes: ScopeAnalysis,
): boolean => {
  if (call.optional || !isReactApiCall(call, apiNames, scopes)) return false;
  const callee = stripParenExpression(call.callee);
  let identifier: EsTreeNodeOfType<"Identifier"> | null = null;
  if (isNodeOfType(callee, "Identifier")) identifier = callee;
  else if (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    !callee.optional &&
    isNodeOfType(callee.property, "Identifier") &&
    isNodeOfType(callee.object, "Identifier")
  )
    identifier = callee.object;
  if (!identifier) return false;
  const symbol = scopes.symbolFor(identifier);
  if (
    !symbol ||
    getValueImportSource(symbol) !== "react" ||
    (isNodeOfType(callee, "MemberExpression") && getDefaultOrNamespaceImportKind(symbol) === null)
  )
    return false;
  return hasClosedReactImports(scopes);
};
