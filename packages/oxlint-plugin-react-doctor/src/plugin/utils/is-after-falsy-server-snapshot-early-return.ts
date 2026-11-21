import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { getGlobalRequireModuleSource } from "./get-global-require-module-source.js";
import { walkAst } from "./walk-ast.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { executesDuringRender } from "./executes-during-render.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { readServerSnapshotBoolean } from "./read-server-snapshot-boolean.js";
import { statementAlwaysExits } from "./statement-always-exits.js";

export const isAfterFalsyServerSnapshotEarlyReturn = (
  node: EsTreeNode,
  componentOrHookNode: EsTreeNode,
  scopes: ScopeAnalysis,
  filename?: string,
): boolean => {
  const enclosingFunction = findEnclosingFunction(node);
  if (
    !enclosingFunction ||
    (enclosingFunction !== componentOrHookNode &&
      !executesDuringRender(enclosingFunction, scopes)) ||
    !isFunctionLike(enclosingFunction) ||
    !isNodeOfType(enclosingFunction.body, "BlockStatement")
  ) {
    return false;
  }
  let currentNode: EsTreeNode = node;
  while (currentNode !== enclosingFunction) {
    const parentNode = currentNode.parent;
    if (!parentNode) return false;
    if (isNodeOfType(parentNode, "BlockStatement")) {
      for (const statement of parentNode.body) {
        if (statement === currentNode) break;
        if (!isNodeOfType(statement, "IfStatement")) continue;
        const serverResult = readServerSnapshotBoolean(statement.test, scopes, filename);
        if (serverResult === true && statementAlwaysExits(statement.consequent)) return true;
        if (
          serverResult === false &&
          statement.alternate &&
          statementAlwaysExits(statement.alternate)
        ) {
          return true;
        }
      }
    }
    currentNode = parentNode;
  }
  return false;
};

const alternateReactProviderByScope = new WeakMap<ScopeAnalysis, boolean>();

const hasAlternateReactProvider = (scopes: ScopeAnalysis): boolean => {
  const cached = alternateReactProviderByScope.get(scopes);
  if (cached !== undefined) return cached;
  let found = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (found) return false;
    const required = getGlobalRequireModuleSource(node, scopes);
    if (required === "react" || required === "module" || required === "node:module") {
      found = true;
      return false;
    }
    if (
      isNodeOfType(node, "ImportExpression") &&
      isNodeOfType(node.source, "Literal") &&
      (node.source.value === "react" ||
        node.source.value === "module" ||
        node.source.value === "node:module")
    ) {
      found = true;
      return false;
    }
    if (
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.callee, "MemberExpression") &&
      (node.callee.computed
        ? isNodeOfType(node.callee.property, "Literal") && node.callee.property.value === "require"
        : isNodeOfType(node.callee.property, "Identifier") &&
          node.callee.property.name === "require") &&
      isNodeOfType(node.arguments[0], "Literal") &&
      node.arguments[0].value === "react"
    ) {
      found = true;
      return false;
    }
    if (!isNodeOfType(node, "ImportDeclaration") || node.importKind === "type") return;
    if (node.source.value === "module" || node.source.value === "node:module") {
      found = true;
      return false;
    }
    if (node.source.value !== "react") return;
    if (
      node.specifiers.some(
        (entry) =>
          !isNodeOfType(entry, "ImportSpecifier") ||
          (entry.importKind !== "type" &&
            isNodeOfType(entry.imported, "Identifier") &&
            entry.imported.name === "default"),
      )
    ) {
      found = true;
      return false;
    }
  });
  alternateReactProviderByScope.set(scopes, found);
  return found;
};

// Only a direct component use site is covered. A sibling or hoisted producer
// may have run before this guard, even when its result is rendered later.
const readsLocalFalseServerSnapshot = (
  identifier: EsTreeNode,
  component: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const snapshot = scopes.symbolFor(identifier);
  if (
    snapshot?.kind !== "const" ||
    !hasCompleteSymbolReferences(snapshot, scopes.rootScope.node, scopes) ||
    snapshot.references.some((reference) => reference.flag !== "read") ||
    findEnclosingFunction(snapshot.bindingIdentifier) !== component ||
    !isNodeOfType(snapshot.initializer, "CallExpression") ||
    snapshot.initializer.optional ||
    snapshot.initializer.arguments.length !== 0 ||
    !isNodeOfType(snapshot.initializer.callee, "Identifier")
  )
    return false;
  const hook = scopes.symbolFor(snapshot.initializer.callee);
  const factory = hook?.initializer;
  if (
    hook?.kind !== "const" ||
    hook.scope.kind !== "module" ||
    !hasCompleteSymbolReferences(hook, scopes.rootScope.node, scopes) ||
    hook.references.some((reference) => {
      const call = reference.identifier.parent;
      return (
        reference.flag !== "read" ||
        !isNodeOfType(call, "CallExpression") ||
        call.callee !== reference.identifier ||
        call.optional ||
        call.arguments.length !== 0
      );
    }) ||
    !isNodeOfType(factory, "ArrowFunctionExpression") ||
    factory.async ||
    factory.params.length !== 0 ||
    !isNodeOfType(factory.body, "CallExpression")
  )
    return false;
  const store = factory.body;
  if (
    store.optional ||
    store.arguments.length !== 3 ||
    store.arguments.some((argument) => isNodeOfType(argument, "SpreadElement")) ||
    !isNodeOfType(store.callee, "Identifier")
  )
    return false;
  const imported = scopes.symbolFor(store.callee);
  const specifier = imported?.declarationNode;
  const declaration = specifier?.parent;
  if (
    imported?.kind !== "import" ||
    !isNodeOfType(specifier, "ImportSpecifier") ||
    specifier.importKind === "type" ||
    !isNodeOfType(specifier.imported, "Identifier") ||
    specifier.imported.name !== "useSyncExternalStore" ||
    !isNodeOfType(declaration, "ImportDeclaration") ||
    declaration.importKind === "type" ||
    declaration.source.value !== "react" ||
    !hasCompleteSymbolReferences(imported, scopes.rootScope.node, scopes) ||
    imported.references.some((reference) => {
      const call = reference.identifier.parent;
      return (
        reference.flag !== "read" ||
        !isNodeOfType(call, "CallExpression") ||
        call.callee !== reference.identifier
      );
    })
  )
    return false;
  const literalGetter = (node: EsTreeNode | null | undefined, value: boolean): boolean =>
    Boolean(
      node &&
      isNodeOfType(node, "ArrowFunctionExpression") &&
      !node.async &&
      node.params.length === 0 &&
      isNodeOfType(node.body, "Literal") &&
      node.body.value === value,
    );
  if (!literalGetter(store.arguments[1], true) || !literalGetter(store.arguments[2], false))
    return false;
  return !hasAlternateReactProvider(scopes);
};

export const isAfterLocalFalseServerSnapshotReturn = (
  node: EsTreeNode,
  component: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    findEnclosingFunction(node) !== component ||
    !isFunctionLike(component) ||
    !isNodeOfType(component.body, "BlockStatement")
  )
    return false;
  let statement = node;
  while (statement.parent && statement.parent !== component.body) statement = statement.parent;
  if (statement.parent !== component.body) return false;
  for (const preceding of component.body.body) {
    if (preceding === statement) return false;
    if (
      !isNodeOfType(preceding, "IfStatement") ||
      preceding.alternate ||
      !isNodeOfType(preceding.test, "UnaryExpression") ||
      preceding.test.operator !== "!" ||
      !readsLocalFalseServerSnapshot(preceding.test.argument, component, scopes)
    )
      continue;
    const branch = preceding.consequent;
    const returned =
      isNodeOfType(branch, "BlockStatement") && branch.body.length === 1 ? branch.body[0] : branch;
    if (
      isNodeOfType(returned, "ReturnStatement") &&
      isNodeOfType(returned.argument, "Literal") &&
      returned.argument.value === null
    )
      return true;
  }
  return false;
};
