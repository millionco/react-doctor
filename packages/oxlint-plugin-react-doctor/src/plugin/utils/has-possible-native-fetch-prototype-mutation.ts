import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getDestructuredBindingPropertyName } from "./get-destructured-binding-property-name.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getEquivalentSymbols } from "./get-equivalent-symbols.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { getSymbolMutationInspector } from "./get-symbol-mutation-inspector.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenGlobalNamespaceReference } from "./is-proven-global-namespace-reference.js";
import { isSymbolReadOnly } from "./is-symbol-read-only.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const FETCH_PROTOTYPE_PROPERTIES = new Set([
  "__proto__",
  "catch",
  "constructor",
  "finally",
  "signal",
  "then",
]);
const possibleMutationByAnalysis = new WeakMap<ScopeAnalysis, boolean>();

const isReflectionNamespace = (receiver: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  isProvenGlobalNamespaceReference(receiver, "Object", scopes) ||
  isProvenGlobalNamespaceReference(receiver, "Reflect", scopes);

const isGlobalPrototypeReader = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  allowUnknownComputedMethod = false,
): boolean => {
  let callee = stripParenExpression(expression);
  if (isNodeOfType(callee, "Identifier")) {
    const symbol = resolveConstIdentifierAlias(callee, scopes, true);
    if (!symbol?.initializer) return false;
    if (getDestructuredBindingPropertyName(symbol.bindingIdentifier) === "getPrototypeOf") {
      return isReflectionNamespace(symbol.initializer, scopes);
    }
    const initializer = getDirectConstInitializer(symbol);
    if (!initializer) return false;
    callee = stripParenExpression(initializer);
  }
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const methodName = getResolvedStaticPropertyName(callee, scopes);
  return (
    (methodName === "getPrototypeOf" ||
      (allowUnknownComputedMethod && callee.computed && methodName === null)) &&
    isReflectionNamespace(callee.object, scopes)
  );
};

const usesClosedPrototypeReader = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  isBinding = false,
): boolean => {
  const pendingReferences: EsTreeNode[] = [];
  const visitedBindings = new Set<number>();
  const addBindingReferences = (binding: EsTreeNode): boolean => {
    if (!isNodeOfType(binding, "Identifier")) return false;
    const symbol = scopes.symbolFor(binding);
    if (!symbol || symbol.kind !== "const" || !isSymbolReadOnly(symbol)) return false;
    if (!visitedBindings.has(symbol.id)) {
      visitedBindings.add(symbol.id);
      for (const { identifier } of symbol.references) pendingReferences.push(identifier);
    }
    return true;
  };
  if (isBinding) {
    if (!addBindingReferences(expression)) return false;
  } else {
    pendingReferences.push(expression);
  }
  while (pendingReferences.length > 0) {
    const reference = pendingReferences.pop();
    if (!reference) break;
    const root = findTransparentExpressionRoot(reference);
    const consumer = root.parent;
    if (
      isNodeOfType(consumer, "CallExpression") &&
      consumer.callee === root &&
      isGlobalPrototypeReader(root, scopes, true)
    ) {
      continue;
    }
    if (
      isNodeOfType(consumer, "VariableDeclarator") &&
      consumer.init === root &&
      addBindingReferences(consumer.id)
    ) {
      continue;
    }
    if (
      isNodeOfType(consumer, "ExpressionStatement") ||
      (isNodeOfType(consumer, "UnaryExpression") && consumer.operator === "typeof") ||
      (isNodeOfType(consumer, "BinaryExpression") &&
        (consumer.operator === "===" || consumer.operator === "!=="))
    ) {
      continue;
    }
    return false;
  }
  return true;
};

const extractsOpaquePrototypeReader = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (isNodeOfType(node, "AssignmentExpression")) {
    return isReflectionNamespace(node.right, scopes);
  }
  if (!isNodeOfType(node, "VariableDeclarator") || !node.init) return false;
  if (!isReflectionNamespace(node.init, scopes)) return false;
  if (!isNodeOfType(node.parent, "VariableDeclaration") || node.parent.kind !== "const") {
    return true;
  }
  if (!isNodeOfType(node.id, "ObjectPattern")) return false;
  return node.id.properties.some((property) => {
    if (!isNodeOfType(property, "Property")) return true;
    const name = getStaticPropertyKeyName(property, { allowComputedString: true });
    return (
      name === null ||
      (name === "getPrototypeOf" && !usesClosedPrototypeReader(property.value, scopes, true))
    );
  });
};

const prototypeValueMayMutate = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const mutations = getSymbolMutationInspector(scopes);
  const visited = new Set<EsTreeNode>();
  const visitedSymbols = new Set<number>();
  const checkUse = (value: EsTreeNode): boolean => {
    const root = findTransparentExpressionRoot(value);
    const consumer = root.parent;
    if (!consumer || visited.has(root)) return false;
    visited.add(root);
    if (isNodeOfType(consumer, "VariableDeclarator") && consumer.init === root) {
      if (!isNodeOfType(consumer.id, "Identifier")) return true;
      const binding = scopes.symbolFor(consumer.id);
      if (!binding) return true;
      if (visitedSymbols.has(binding.id)) return false;
      const aliases = getEquivalentSymbols(consumer.id, scopes);
      for (const alias of aliases) visitedSymbols.add(alias.id);
      return aliases.some((alias) =>
        alias.references.some((reference) => checkUse(reference.identifier)),
      );
    }
    const properties = mutations.getMutationPropertyNames(root);
    if (isNodeOfType(consumer, "MemberExpression") && consumer.object === root) {
      const member = findTransparentExpressionRoot(consumer);
      return (
        properties === null ||
        Boolean(
          properties &&
          [...properties].some((property) => FETCH_PROTOTYPE_PROPERTIES.has(property)),
        ) ||
        (isNodeOfType(member.parent, "CallExpression") && member.parent.callee === member)
      );
    }
    if (
      isNodeOfType(consumer, "CallExpression") &&
      consumer.arguments.some((argument) => argument === root)
    ) {
      if (isGlobalPrototypeReader(consumer.callee, scopes)) return false;
      return (
        !properties || [...properties].some((property) => FETCH_PROTOTYPE_PROPERTIES.has(property))
      );
    }
    if (
      isNodeOfType(consumer, "BinaryExpression") &&
      (consumer.operator === "===" || consumer.operator === "!==")
    ) {
      return false;
    }
    return (
      !isNodeOfType(consumer, "ExpressionStatement") &&
      !(isNodeOfType(consumer, "AssignmentExpression") && consumer.left === root)
    );
  };
  return checkUse(expression);
};

export const hasPossibleNativeFetchPrototypeMutation = (scopes: ScopeAnalysis): boolean => {
  const cached = possibleMutationByAnalysis.get(scopes);
  if (cached !== undefined) return cached;
  let hasPossibleMutation = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (hasPossibleMutation) return false;
    const memberName = isNodeOfType(node, "MemberExpression")
      ? getResolvedStaticPropertyName(node, scopes)
      : null;
    if (
      memberName === "constructor" ||
      (isNodeOfType(node, "MemberExpression") &&
        isGlobalPrototypeReader(node, scopes, true) &&
        !usesClosedPrototypeReader(node, scopes)) ||
      extractsOpaquePrototypeReader(node, scopes) ||
      (isNodeOfType(node, "Property") &&
        isNodeOfType(node.parent, "ObjectPattern") &&
        getStaticPropertyKeyName(node, { allowComputedString: true }) === "constructor") ||
      ((memberName === "eval" || (isNodeOfType(node, "Identifier") && node.name === "eval")) &&
        isProvenGlobalNamespaceReference(node, "eval", scopes)) ||
      (isNodeOfType(node, "CallExpression") &&
        isProvenGlobalNamespaceReference(node.callee, "eval", scopes)) ||
      ((memberName === "__proto__" ||
        (isNodeOfType(node, "CallExpression") &&
          isGlobalPrototypeReader(node.callee, scopes, true))) &&
        prototypeValueMayMutate(node, scopes))
    ) {
      hasPossibleMutation = true;
    }
  });
  possibleMutationByAnalysis.set(scopes, hasPossibleMutation);
  return hasPossibleMutation;
};
