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
import { NATIVE_REACT_PROVIDER_HAZARD_NAMES } from "./constants.js";

const closedProvidersByAnalysis = new WeakMap<ScopeAnalysis, boolean>();

const hasClosedReactNamedHookProvider = (scopes: ScopeAnalysis): boolean => {
  const cached = closedProvidersByAnalysis.get(scopes);
  if (cached !== undefined) return cached;
  const program = scopes.rootScope.node;
  if (!isNodeOfType(program, "Program")) return false;
  let closed = true;
  walkAst(program, (node) => {
    if (!closed) return false;
    if (isNodeOfType(node, "TSImportEqualsDeclaration")) {
      if (node.importKind !== "type") closed = false;
      return false;
    }
    if (
      ((isNodeOfType(node, "TSModuleDeclaration") || isNodeOfType(node, "TSEnumDeclaration")) &&
        !node.declare) ||
      isNodeOfType(node, "TSExportAssignment") ||
      isNodeOfType(node, "TSParameterProperty")
    ) {
      closed = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (isNodeOfType(node, "Identifier") && !isTypeScriptTypePosition(node)) {
      const binding = scopes.symbolFor(node);
      if (
        binding &&
        binding.bindingIdentifier !== node &&
        [...NATIVE_REACT_PROVIDER_HAZARD_NAMES, "globalThis", "window", "self", "global"].includes(
          node.name,
        ) &&
        isErasedTypeScriptBinding(binding) &&
        !hasRuntimeValueBinding(binding)
      ) {
        closed = false;
        return false;
      }
    }
    if (
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "ImportExpression") ||
      (isNodeOfType(node, "ImportDeclaration") &&
        node.importKind !== "type" &&
        (node.source.value === "module" || node.source.value === "node:module")) ||
      NATIVE_REACT_PROVIDER_HAZARD_NAMES.some((name) =>
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
      if (
        !isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
        getImportedName(symbol.declarationNode) === "default"
      ) {
        closed = false;
        break;
      }
      for (const reference of symbol.references) {
        if (isTypeScriptTypePosition(reference.identifier)) continue;
        if (reference.flag !== "read" || isWithinAssignmentTarget(reference.identifier)) {
          closed = false;
          break;
        }
        const target = findTransparentExpressionRoot(reference.identifier);
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

export const isClosedReactNamedHookCall = (
  expression: EsTreeNode,
  hookName: string,
  scopes: ScopeAnalysis,
): boolean => {
  const call = stripParenExpression(expression);
  if (!isNodeOfType(call, "CallExpression") || call.optional) return false;
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const symbol = scopes.symbolFor(callee);
  return Boolean(
    symbol &&
    getValueImportSource(symbol) === "react" &&
    isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
    getImportedName(symbol.declarationNode) === hookName &&
    hasClosedReactNamedHookProvider(scopes),
  );
};
