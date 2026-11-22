import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getExecutableValueReferences } from "../../../utils/get-executable-value-references.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import { someAst } from "../../../utils/some-ast.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

export interface ClosedListenerRefCallback {
  readonly callback: EsTreeNodeOfType<"ArrowFunctionExpression">;
  readonly returnedField: "ref";
  readonly nodeParameter: SymbolDescriptor;
  readonly nodeRef: SymbolDescriptor;
  readonly handlerEventNames: readonly string[];
  readonly handlerCallbacks: ReadonlyArray<EsTreeNode>;
}
const member = (node: EsTreeNode, name: string): node is EsTreeNodeOfType<"MemberExpression"> =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  !node.optional &&
  isNodeOfType(node.property, "Identifier") &&
  node.property.name === name;
const same = (node: EsTreeNode, symbol: SymbolDescriptor, scopes: ScopeAnalysis): boolean =>
  isNodeOfType(node, "Identifier") && scopes.symbolFor(node) === symbol;
const completeReads = (symbol: SymbolDescriptor, scopes: ScopeAnalysis): boolean =>
  hasCompleteSymbolReferences(symbol, scopes.rootScope.node, scopes) &&
  getExecutableValueReferences(symbol).every((reference) => reference.flag === "read");
const reactCall = (node: EsTreeNode, name: string, scopes: ScopeAnalysis): boolean => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    node.optional ||
    !isNodeOfType(node.callee, "Identifier")
  )
    return false;
  const symbol = scopes.symbolFor(node.callee);
  const specifier = symbol?.declarationNode;
  const declaration = specifier?.parent;
  const api = resolveImportedApiReference(node.callee, scopes);
  return Boolean(
    isNodeOfType(specifier, "ImportSpecifier") &&
    specifier.importKind !== "type" &&
    isNodeOfType(declaration, "ImportDeclaration") &&
    declaration.importKind !== "type" &&
    api?.source === "react" &&
    api.importedName === name,
  );
};
const nullRef = (symbol: SymbolDescriptor, scopes: ScopeAnalysis): boolean => {
  const init = getDirectConstInitializer(symbol);
  return Boolean(
    init &&
    reactCall(init, "useRef", scopes) &&
    isNodeOfType(init, "CallExpression") &&
    init.arguments.length === 1 &&
    isNodeOfType(init.arguments[0], "Literal") &&
    init.arguments[0].value === null,
  );
};
const onlyReferences = (
  symbol: SymbolDescriptor,
  nodes: ReadonlyArray<EsTreeNode>,
  scopes: ScopeAnalysis,
): boolean => {
  const refs = getExecutableValueReferences(symbol);
  return (
    completeReads(symbol, scopes) &&
    refs.length === nodes.length &&
    refs.every((ref) => nodes.includes(ref.identifier))
  );
};

/** Proves synchronous ref attachment is add/remove-only; listener bodies and
 * effective stock React/DOM providers remain caller-owned obligations. */
export const readClosedListenerRefCallback = (
  hook: EsTreeNode,
  scopes: ScopeAnalysis,
): ClosedListenerRefCallback | null => {
  if (
    !isFunctionLike(hook) ||
    hook.async ||
    !isNodeOfType(hook.body, "BlockStatement") ||
    someAst(
      scopes.rootScope.node,
      (node) =>
        isNodeOfType(node, "WithStatement") ||
        (isNodeOfType(node, "Identifier") && node.name === "eval"),
    )
  )
    return null;
  const ret = hook.body.body.at(-1);
  if (
    someAst(
      hook.body,
      (node) =>
        isNodeOfType(node, "ReturnStatement") &&
        node !== ret &&
        findEnclosingFunction(node) === hook,
    )
  )
    return null;
  if (
    !isNodeOfType(ret, "ReturnStatement") ||
    !isNodeOfType(ret.argument, "ObjectExpression") ||
    ret.argument.properties.length !== 1
  )
    return null;
  const prop = ret.argument.properties[0];
  if (
    !isNodeOfType(prop, "Property") ||
    prop.computed ||
    prop.method ||
    prop.kind !== "init" ||
    !isNodeOfType(prop.key, "Identifier") ||
    prop.key.name !== "ref" ||
    !isNodeOfType(prop.value, "Identifier")
  )
    return null;
  const binding = scopes.symbolFor(prop.value);
  const init = binding && getDirectConstInitializer(binding);
  if (
    !binding ||
    !onlyReferences(binding, [prop.value], scopes) ||
    !init ||
    !reactCall(init, "useCallback", scopes) ||
    !isNodeOfType(init, "CallExpression") ||
    init.arguments.length !== 2 ||
    !isNodeOfType(init.arguments[1], "ArrayExpression") ||
    init.arguments[1].elements.length !== 0
  )
    return null;
  const callback = init.arguments[0];
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 1 ||
    !isNodeOfType(callback.params[0], "Identifier") ||
    !isNodeOfType(callback.body, "BlockStatement") ||
    callback.body.body.length !== 4 ||
    findEnclosingFunction(init) !== hook
  )
    return null;
  const node = scopes.symbolFor(callback.params[0]);
  if (!node) return null;
  const [aliasDeclaration, remove, store, add] = callback.body.body;
  if (
    !isNodeOfType(aliasDeclaration, "VariableDeclaration") ||
    aliasDeclaration.kind !== "const" ||
    aliasDeclaration.declarations.length !== 1 ||
    !isNodeOfType(remove, "IfStatement") ||
    remove.alternate ||
    !isNodeOfType(remove.consequent, "BlockStatement") ||
    !isNodeOfType(store, "ExpressionStatement") ||
    !isNodeOfType(add, "IfStatement") ||
    add.alternate ||
    !isNodeOfType(add.consequent, "BlockStatement")
  )
    return null;
  const aliasDecl = aliasDeclaration.declarations[0];
  const assignment = stripParenExpression(store.expression);
  if (
    !isNodeOfType(aliasDecl.id, "Identifier") ||
    !aliasDecl.init ||
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    !member(assignment.left, "current") ||
    !isNodeOfType(assignment.left.object, "Identifier") ||
    !same(assignment.right, node, scopes) ||
    !same(add.test, node, scopes)
  )
    return null;
  const alias = scopes.symbolFor(aliasDecl.id);
  const handlerCurrent = stripParenExpression(aliasDecl.init);
  const nodeRef = scopes.symbolFor(assignment.left.object);
  if (
    !alias ||
    !nodeRef ||
    !nullRef(nodeRef, scopes) ||
    findEnclosingFunction(nodeRef.bindingIdentifier) !== hook ||
    !member(remove.test, "current") ||
    !same(remove.test.object, nodeRef, scopes) ||
    !member(handlerCurrent, "current") ||
    !isNodeOfType(handlerCurrent.object, "Identifier")
  )
    return null;
  const handlers = scopes.symbolFor(handlerCurrent.object);
  if (
    !handlers ||
    handlers === nodeRef ||
    !nullRef(handlers, scopes) ||
    findEnclosingFunction(handlers.bindingIdentifier) !== hook
  )
    return null;
  const oldReads: EsTreeNode[] = [remove.test.object, assignment.left.object];
  const newReads: EsTreeNode[] = [assignment.right, add.test];
  const handlerReads: EsTreeNode[] = [];
  const keys: string[] = [];
  if (remove.consequent.body.length !== 3 || add.consequent.body.length !== 3) return null;
  for (let index = 0; index < 3; index++) {
    for (const [statement, method] of [
      [remove.consequent.body[index], "removeEventListener"],
      [add.consequent.body[index], "addEventListener"],
    ] as const) {
      if (
        !isNodeOfType(statement, "ExpressionStatement") ||
        !isNodeOfType(statement.expression, "CallExpression")
      )
        return null;
      const call = statement.expression;
      if (
        call.optional ||
        !member(call.callee, method) ||
        call.arguments.length !== (method === "addEventListener" ? 3 : 2)
      )
        return null;
      const [event, listener, options] = call.arguments;
      if (
        !isNodeOfType(event, "Literal") ||
        typeof event.value !== "string" ||
        !isNodeOfType(listener, "MemberExpression") ||
        listener.computed ||
        listener.optional ||
        !same(listener.object, alias, scopes) ||
        !isNodeOfType(listener.property, "Identifier") ||
        listener.property.name !== event.value
      )
        return null;
      if (method === "removeEventListener") {
        if (
          keys.includes(event.value) ||
          !member(call.callee.object, "current") ||
          !same(call.callee.object.object, nodeRef, scopes)
        )
          return null;
        keys.push(event.value);
        oldReads.push(call.callee.object.object);
      } else {
        if (
          keys[index] !== event.value ||
          !same(call.callee.object, node, scopes) ||
          !isNodeOfType(options, "ObjectExpression") ||
          options.properties.length !== 1
        )
          return null;
        const option = options.properties[0];
        if (
          !isNodeOfType(option, "Property") ||
          option.computed ||
          option.method ||
          option.kind !== "init" ||
          !isNodeOfType(option.key, "Identifier") ||
          option.key.name !== "passive" ||
          !isNodeOfType(option.value, "Literal") ||
          typeof option.value.value !== "boolean"
        )
          return null;
        newReads.push(call.callee.object);
      }
      handlerReads.push(listener.object);
    }
  }
  if (
    !onlyReferences(node, newReads, scopes) ||
    !onlyReferences(nodeRef, oldReads, scopes) ||
    !onlyReferences(alias, handlerReads, scopes)
  )
    return null;
  const handlerRefs = getExecutableValueReferences(handlers);
  let object: EsTreeNodeOfType<"ObjectExpression"> | null = null;
  let objectWrite: EsTreeNode | null = null;
  let guardRead: EsTreeNode | null = null;
  let initializationGuard: EsTreeNodeOfType<"IfStatement"> | null = null;
  let initializationWrite: EsTreeNodeOfType<"AssignmentExpression"> | null = null;
  for (const reference of handlerRefs) {
    if (reference.identifier === handlerCurrent.object) continue;
    const access = findTransparentExpressionRoot(reference.identifier).parent;
    if (!isNodeOfType(access, "MemberExpression") || !member(access, "current")) return null;
    const use = access.parent;
    if (
      isNodeOfType(use, "UnaryExpression") &&
      use.operator === "!" &&
      use.argument === access &&
      isNodeOfType(use.parent, "IfStatement") &&
      use.parent.test === use &&
      !use.parent.alternate
    ) {
      if (guardRead) return null;
      guardRead = reference.identifier;
      initializationGuard = use.parent;
    } else if (
      isNodeOfType(use, "AssignmentExpression") &&
      use.left === access &&
      use.operator === "=" &&
      isNodeOfType(use.right, "ObjectExpression")
    ) {
      if (object) return null;
      object = use.right;
      objectWrite = reference.identifier;
      initializationWrite = use;
    } else return null;
  }
  if (
    !object ||
    !objectWrite ||
    !guardRead ||
    !onlyReferences(handlers, [handlerCurrent.object, objectWrite, guardRead], scopes) ||
    object.properties.length !== 3
  )
    return null;
  if (
    !initializationGuard ||
    !initializationWrite ||
    !isNodeOfType(initializationGuard.consequent, "BlockStatement") ||
    !isNodeOfType(initializationWrite.parent, "ExpressionStatement") ||
    initializationWrite.parent.parent !== initializationGuard.consequent ||
    initializationGuard.consequent.body.at(-1) !== initializationWrite.parent ||
    initializationGuard.parent !== hook.body
  )
    return null;
  const callbacks: EsTreeNode[] = [];
  for (const key of keys) {
    const property = object.properties.find(
      (item) =>
        isNodeOfType(item, "Property") &&
        !item.computed &&
        isNodeOfType(item.key, "Identifier") &&
        item.key.name === key,
    );
    if (
      !isNodeOfType(property, "Property") ||
      property.method ||
      property.kind !== "init" ||
      !isNodeOfType(property.value, "Identifier")
    )
      return null;
    const handler = scopes.symbolFor(property.value);
    const fn = handler && getDirectConstInitializer(handler);
    if (
      !handler ||
      !fn ||
      !isFunctionLike(fn) ||
      fn.async ||
      !onlyReferences(handler, [property.value], scopes)
    )
      return null;
    callbacks.push(fn);
  }
  return {
    callback,
    returnedField: "ref",
    nodeParameter: node,
    nodeRef,
    handlerEventNames: keys,
    handlerCallbacks: callbacks,
  };
};
