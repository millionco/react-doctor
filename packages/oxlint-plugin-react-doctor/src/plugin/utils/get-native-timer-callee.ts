import { TIMER_CALLEE_NAMES_REQUIRING_CLEANUP } from "../constants/dom.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getImportedName } from "./get-imported-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "./is-proven-unmodified-global-namespace-reference.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const NODE_TIMER_MODULE_NAMES = new Set(["node:timers", "timers"]);
const NODE_MODULE_API_NAMES = new Set(["node:module", "module"]);
const mutableNodeTimerAccessByScope = new WeakMap<ScopeAnalysis, boolean>();
const closedNamespaceUsesBySymbol = new WeakMap<SymbolDescriptor, boolean>();

interface NativeTimerCallee {
  readonly name: string;
  readonly provider: "global" | "node";
  readonly source?: string;
}

const isNodeBuiltinModuleSpecifier = (node: EsTreeNode | null | undefined): boolean =>
  isNodeOfType(node, "Literal") &&
  typeof node.value === "string" &&
  (NODE_TIMER_MODULE_NAMES.has(node.value) || NODE_MODULE_API_NAMES.has(node.value));

const hasMutableNodeTimerAccess = (scopes: ScopeAnalysis): boolean => {
  const cachedAccess = mutableNodeTimerAccessByScope.get(scopes);
  if (cachedAccess !== undefined) return cachedAccess;
  let hasMutableAccess = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (hasMutableAccess) return false;
    if (
      isNodeOfType(node, "ImportDeclaration") &&
      node.importKind !== "type" &&
      typeof node.source.value === "string"
    ) {
      const source = node.source.value;
      hasMutableAccess =
        (NODE_TIMER_MODULE_NAMES.has(source) &&
          node.specifiers.some((specifier) => isNodeOfType(specifier, "ImportDefaultSpecifier"))) ||
        (NODE_MODULE_API_NAMES.has(source) &&
          node.specifiers.some(
            (specifier) =>
              !isNodeOfType(specifier, "ImportSpecifier") ||
              (specifier.importKind !== "type" &&
                getImportedName(specifier) === "syncBuiltinESMExports"),
          ));
    } else if (isNodeOfType(node, "ImportExpression")) {
      hasMutableAccess = isNodeBuiltinModuleSpecifier(node.source);
    } else if (
      isNodeOfType(node, "CallExpression") &&
      isNodeBuiltinModuleSpecifier(node.arguments[0])
    ) {
      const callee = stripParenExpression(node.callee);
      const receiver = isNodeOfType(callee, "MemberExpression")
        ? stripParenExpression(callee.object)
        : null;
      hasMutableAccess =
        (isNodeOfType(callee, "Identifier") &&
          callee.name === "require" &&
          scopes.isGlobalReference(callee)) ||
        (isNodeOfType(callee, "MemberExpression") &&
          getStaticPropertyName(callee) === "getBuiltinModule" &&
          isNodeOfType(receiver, "Identifier") &&
          receiver.name === "process" &&
          scopes.isGlobalReference(receiver));
    }
  });
  mutableNodeTimerAccessByScope.set(scopes, hasMutableAccess);
  return hasMutableAccess;
};

const hasClosedTimerNamespaceUses = (symbol: SymbolDescriptor): boolean => {
  const cachedUses = closedNamespaceUsesBySymbol.get(symbol);
  if (cachedUses !== undefined) return cachedUses;
  const hasClosedUses = symbol.references.every(({ identifier, flag }) => {
    const receiver = findTransparentExpressionRoot(identifier);
    const member = receiver.parent;
    const name = isNodeOfType(member, "MemberExpression") ? getStaticPropertyName(member) : null;
    return (
      flag === "read" &&
      isNodeOfType(member, "MemberExpression") &&
      member.object === receiver &&
      name !== null &&
      name !== "default" &&
      !isWithinAssignmentTarget(member)
    );
  });
  closedNamespaceUsesBySymbol.set(symbol, hasClosedUses);
  return hasClosedUses;
};

export const getNativeTimerCallee = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  calleeNames: ReadonlySet<string> = TIMER_CALLEE_NAMES_REQUIRING_CLEANUP,
): NativeTimerCallee | null => {
  const callee = stripParenExpression(expression);
  if (isNodeOfType(callee, "Identifier") && scopes.isGlobalReference(callee)) {
    return calleeNames.has(callee.name) ? { name: callee.name, provider: "global" } : null;
  }
  const receiver = isNodeOfType(callee, "MemberExpression")
    ? stripParenExpression(callee.object)
    : callee;
  if (isNodeOfType(callee, "MemberExpression")) {
    const memberName = getStaticPropertyName(callee);
    if (!memberName || !calleeNames.has(memberName)) return null;
    if (isProvenUnmodifiedGlobalNamespaceReference(callee.object, null, scopes, memberName)) {
      return { name: memberName, provider: "global" };
    }
  }
  if (!isNodeOfType(receiver, "Identifier")) return null;
  const symbol = scopes.symbolFor(receiver);
  if (!symbol || symbol.kind !== "import") return null;
  if (
    isNodeOfType(callee, "MemberExpression")
      ? !isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier") ||
        !hasClosedTimerNamespaceUses(symbol)
      : !isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
        symbol.references.some((reference) => reference.flag !== "read")
  ) {
    return null;
  }
  const imported = resolveImportedApiReference(callee, scopes);
  if (
    !imported?.importedName ||
    !NODE_TIMER_MODULE_NAMES.has(imported.source) ||
    !calleeNames.has(imported.importedName)
  ) {
    return null;
  }
  const isLegacyDirectRegistration =
    isNodeOfType(callee, "Identifier") &&
    callee.name === imported.importedName &&
    TIMER_CALLEE_NAMES_REQUIRING_CLEANUP.has(callee.name);
  return isLegacyDirectRegistration || !hasMutableNodeTimerAccess(scopes)
    ? { name: imported.importedName, provider: "node", source: imported.source }
    : null;
};
