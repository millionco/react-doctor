import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { getStaticStringExpression } from "../../../utils/get-static-string-expression.js";
import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import { isMemberMutationTarget } from "../../../utils/is-member-mutation-target.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isImportedFromReact, isReactNamespaceImport } from "../../../utils/is-react-api-call.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  NO_VALUE_COUNT,
  SINGLE_VALUE_COUNT,
  UNSUPPORTED_PROVIDER_GLOBALS,
  UNSUPPORTED_PROVIDER_SELECTORS,
  UNSUPPORTED_RUNTIME_TYPES,
} from "./callback-map-snapshot/constants.js";
import { isReadonlyCallbackMapSymbol as isReadonly } from "./is-readonly-callback-map-symbol.js";

const emptyPermissions: ReadonlySet<EsTreeNode> = new Set();
const supportedPrograms = new WeakMap<ScopeAnalysis, WeakMap<ReadonlySet<EsTreeNode>, boolean>>();

export const isRuntimeGlobalReference = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (scopes.isGlobalReference(identifier)) return true;
  const symbol = scopes.symbolFor(identifier);
  return Boolean(symbol && isErasedTypeScriptBinding(symbol) && !hasRuntimeValueBinding(symbol));
};

const hasReadonlyLoadedReactUse = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let current = findTransparentExpressionRoot(expression);
  while (isNodeOfType(current.parent, "MemberExpression") && current.parent.object === current) {
    const member = current.parent;
    if (getResolvedStaticPropertyName(member, scopes) === null || isMemberMutationTarget(member))
      return false;
    current = findTransparentExpressionRoot(member);
  }
  const parent = current.parent;
  return (
    isNodeOfType(parent, "ExpressionStatement") ||
    (isNodeOfType(parent, "UnaryExpression") &&
      (parent.operator === "typeof" || parent.operator === "void")) ||
    (isNodeOfType(parent, "CallExpression") && parent.callee === current && !parent.optional)
  );
};

const hasSupportedLoaderUse = (identifier: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const root = findTransparentExpressionRoot(identifier);
  if (
    isNodeOfType(root.parent, "UnaryExpression") &&
    (root.parent.operator === "typeof" || root.parent.operator === "void")
  )
    return true;
  const callee =
    identifier.name === "module" &&
    isNodeOfType(root.parent, "MemberExpression") &&
    root.parent.object === root &&
    !root.parent.optional &&
    getResolvedStaticPropertyName(root.parent, scopes) === "require"
      ? findTransparentExpressionRoot(root.parent)
      : root;
  const call = callee.parent;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.callee !== callee ||
    call.arguments.length !== SINGLE_VALUE_COUNT ||
    (identifier.name === "module" && callee === root)
  )
    return false;
  const source = getStaticStringExpression(call.arguments[NO_VALUE_COUNT]);
  return Boolean(source && (source !== "react" || hasReadonlyLoadedReactUse(call, scopes)));
};

const isDirectInvocation = (node: EsTreeNode): boolean => {
  const expression = findTransparentExpressionRoot(node);
  const parent = expression.parent;
  return Boolean(
    parent &&
    (isNodeOfType(parent, "CallExpression") || isNodeOfType(parent, "NewExpression")) &&
    parent.callee === expression,
  );
};

const hasCallableUse = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  visited = new Set<number>(),
): boolean => {
  const expression = findTransparentExpressionRoot(node);
  const parent = expression.parent;
  if (!parent) return true;
  if (isDirectInvocation(expression) || isWithinAssignmentTarget(expression)) return true;
  if (isNodeOfType(parent, "MemberExpression") && parent.object === expression) {
    return hasCallableUse(parent, scopes, visited);
  }
  if (
    (isNodeOfType(parent, "LogicalExpression") &&
      (parent.left === expression || parent.right === expression)) ||
    (isNodeOfType(parent, "ConditionalExpression") &&
      (parent.consequent === expression || parent.alternate === expression))
  ) {
    return hasCallableUse(parent, scopes, visited);
  }
  if (
    isNodeOfType(parent, "TaggedTemplateExpression") ||
    isNodeOfType(parent, "AwaitExpression") ||
    isNodeOfType(parent, "YieldExpression") ||
    isNodeOfType(parent, "SequenceExpression") ||
    isNodeOfType(parent, "AssignmentExpression") ||
    isNodeOfType(parent, "SpreadElement") ||
    isNodeOfType(parent, "Property") ||
    isNodeOfType(parent, "ArrayExpression") ||
    isNodeOfType(parent, "ReturnStatement")
  )
    return true;
  if (isNodeOfType(parent, "VariableDeclarator") && parent.init === expression) {
    if (!isNodeOfType(parent.id, "Identifier")) return true;
    const symbol = scopes.symbolFor(parent.id);
    if (!symbol || symbol.kind !== "const" || !isReadonly(symbol) || visited.has(symbol.id))
      return true;
    const nextVisited = new Set([...visited, symbol.id]);
    return symbol.references.some((reference) =>
      hasCallableUse(reference.identifier, scopes, nextVisited),
    );
  }
  return false;
};

const hasClosedReactProvider = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
  allowedNodes: ReadonlySet<EsTreeNode>,
): boolean => {
  const symbol = scopes.symbolFor(identifier);
  if (
    !symbol ||
    !isReadonly(symbol) ||
    (isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
      symbol.declarationNode.importKind === "type") ||
    (isNodeOfType(symbol.declarationNode.parent, "ImportDeclaration") &&
      symbol.declarationNode.parent.importKind === "type")
  )
    return false;
  const isNamespace = isReactNamespaceImport(identifier, scopes);
  if (
    !isNamespace &&
    (!isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
      getImportedName(symbol.declarationNode) === "default")
  )
    return false;
  return symbol.references.every(({ identifier: reference }) => {
    if (isTypeScriptTypePosition(reference)) return true;
    if (!isNamespace) return isDirectInvocation(reference);
    const member = reference.parent;
    return Boolean(
      member &&
      isNodeOfType(member, "MemberExpression") &&
      member.object === reference &&
      !member.computed &&
      !member.optional &&
      (allowedNodes.has(member) || isDirectInvocation(member)),
    );
  });
};

export const hasSupportedCallbackMapProgram = (
  scopes: ScopeAnalysis,
  allowedNodes: ReadonlySet<EsTreeNode> = emptyPermissions,
): boolean => {
  let permissions = supportedPrograms.get(scopes);
  if (!permissions) {
    permissions = new WeakMap();
    supportedPrograms.set(scopes, permissions);
  }
  const cached = permissions.get(allowedNodes);
  if (cached !== undefined) return cached;
  let supported = true;
  const checkedReactSymbols = new Set<number>();
  walkAst(scopes.rootScope.node, (node) => {
    if (!supported) return false;
    if (("declare" in node && node.declare === true) || UNSUPPORTED_RUNTIME_TYPES.has(node.type)) {
      supported = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (isNodeOfType(node, "Identifier")) {
      const reference = scopes.referenceFor(node);
      const symbol = reference?.resolvedSymbol;
      const isRuntimeGlobal = reference && isRuntimeGlobalReference(node, scopes);
      const isLoader = node.name === "require" || node.name === "module";
      if (
        reference &&
        ((isLoader && isRuntimeGlobal && !hasSupportedLoaderUse(node, scopes)) ||
          (symbol &&
            isErasedTypeScriptBinding(symbol) &&
            !hasRuntimeValueBinding(symbol) &&
            node.name !== "Map" &&
            !isLoader &&
            !allowedNodes.has(node)) ||
          (UNSUPPORTED_PROVIDER_GLOBALS.has(node.name) &&
            (node.name === "eval" || isRuntimeGlobal) &&
            !allowedNodes.has(node)))
      )
        supported = false;
      if (symbol && isImportedFromReact(symbol) && !checkedReactSymbols.has(symbol.id)) {
        checkedReactSymbols.add(symbol.id);
        if (!hasClosedReactProvider(node, scopes, allowedNodes)) supported = false;
      }
      if (reference && node.name === "Map" && isRuntimeGlobal && !isDirectInvocation(node))
        supported = false;
    }
    if (
      isNodeOfType(node, "MemberExpression") ||
      (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"))
    ) {
      const propertyName = getResolvedStaticPropertyName(node, scopes, {
        allowConstTemplateLiteral: true,
        allowConstNumericLiteral: true,
        stringifyNonStringLiterals: true,
      });
      if (propertyName && UNSUPPORTED_PROVIDER_SELECTORS.has(propertyName)) supported = false;
      if (
        !propertyName &&
        node.computed &&
        (isNodeOfType(node, "Property") || hasCallableUse(node, scopes))
      )
        supported = false;
    }
    return undefined;
  });
  permissions.set(allowedNodes, supported);
  return supported;
};
