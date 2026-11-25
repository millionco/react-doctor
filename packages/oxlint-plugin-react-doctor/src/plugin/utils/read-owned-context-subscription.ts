import type { EsTreeNode } from "./es-tree-node.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { getOwnedContextFunction } from "./get-owned-context-function.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactHookCall } from "./is-react-hook-call.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import type { OwnedReactContext } from "./resolve-owned-react-context.js";

export interface NativeSubscriptionOperations {
  // Mandatory provider/realm proof supplied by the verified compiler caller.
  readonly isNativeArrayPush: (call: EsTreeNode) => boolean;
}
export interface OwnedContextSubscription {
  readonly subscribe: EsTreeNode;
  readonly registry: EsTreeNode;
  readonly callbackParameter: EsTreeNode;
  readonly disposer: EsTreeNode;
}
export const readOwnedContextSubscription = (
  context: OwnedReactContext,
  operations: NativeSubscriptionOperations,
): OwnedContextSubscription | null => {
  const fn = getOwnedContextFunction(context, "subscribe");
  if (
    !fn ||
    fn.generator ||
    fn.params.length !== 2 ||
    fn.params.some((p) => !isNodeOfType(p, "Identifier")) ||
    !isNodeOfType(fn.body, "BlockStatement") ||
    fn.body.body.length !== 3
  )
    return null;
  const scopes = context.value.module.scopes;
  const [topic, callback] = fn.params;
  const same = (a: EsTreeNode, b: EsTreeNode) =>
    Boolean(scopes.symbolFor(a) && scopes.symbolFor(a) === scopes.symbolFor(b));
  const [guard, add, returned] = fn.body.body;
  if (
    !isNodeOfType(guard, "IfStatement") ||
    guard.alternate ||
    !isNodeOfType(guard.test, "UnaryExpression") ||
    guard.test.operator !== "!" ||
    !isNodeOfType(guard.consequent, "BlockStatement") ||
    guard.consequent.body.length !== 1
  )
    return null;
  const index = stripParenExpression(guard.test.argument);
  if (
    !isNodeOfType(index, "MemberExpression") ||
    !index.computed ||
    index.optional ||
    !isNodeOfType(index.object, "Identifier") ||
    !same(index.property, topic)
  )
    return null;
  const registry = scopes.symbolFor(index.object);
  const declaration = registry?.declarationNode;
  if (
    !registry ||
    registry.kind !== "const" ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "ArrayPattern") ||
    declaration.id.elements.length !== 1 ||
    declaration.id.elements[0] !== registry.bindingIdentifier ||
    !declaration.init ||
    !isNodeOfType(declaration.init, "CallExpression") ||
    !isReactHookCall(declaration.init, new Set(["useState"]), scopes) ||
    declaration.init.arguments.length !== 1 ||
    !isNodeOfType(declaration.init.arguments[0], "ObjectExpression") ||
    declaration.init.arguments[0].properties.length ||
    !hasCompleteSymbolReferences(registry, context.value.module.programNode, scopes) ||
    registry.references.some((ref) => ref.flag !== "read")
  )
    return null;
  const slot = (node: EsTreeNode, key: EsTreeNode = topic): boolean => {
    const n = stripParenExpression(node);
    return (
      isNodeOfType(n, "MemberExpression") &&
      n.computed &&
      same(n.object, registry.bindingIdentifier) &&
      same(n.property, key)
    );
  };
  const write = guard.consequent.body[0];
  if (
    !isNodeOfType(write, "ExpressionStatement") ||
    !isNodeOfType(write.expression, "AssignmentExpression") ||
    write.expression.operator !== "=" ||
    !slot(write.expression.left) ||
    !isNodeOfType(write.expression.right, "ArrayExpression") ||
    write.expression.right.elements.length
  )
    return null;
  if (
    !isNodeOfType(add, "ExpressionStatement") ||
    !isNodeOfType(add.expression, "CallExpression") ||
    add.expression.optional ||
    add.expression.arguments.length !== 1 ||
    !same(add.expression.arguments[0], callback) ||
    !isNodeOfType(add.expression.callee, "MemberExpression") ||
    add.expression.callee.computed ||
    add.expression.callee.optional ||
    !isNodeOfType(add.expression.callee.property, "Identifier") ||
    add.expression.callee.property.name !== "push" ||
    !slot(add.expression.callee.object) ||
    !operations.isNativeArrayPush(add.expression)
  )
    return null;
  if (
    !isNodeOfType(returned, "ReturnStatement") ||
    !isNodeOfType(returned.argument, "ArrowFunctionExpression") ||
    returned.argument.async ||
    returned.argument.params.length ||
    !isNodeOfType(returned.argument.body, "CallExpression") ||
    returned.argument.body.optional ||
    returned.argument.body.arguments.length !== 2 ||
    !same(returned.argument.body.arguments[0], topic) ||
    !same(returned.argument.body.arguments[1], callback) ||
    !isNodeOfType(returned.argument.body.callee, "Identifier")
  )
    return null;
  const storedCallback = add.expression.arguments[0];
  const capturedCallback = returned.argument.body.arguments[1];
  const cb = scopes.symbolFor(callback);
  if (
    !cb ||
    !hasCompleteSymbolReferences(cb, context.value.module.programNode, scopes) ||
    cb.references.length !== 2 ||
    cb.references.some(
      (ref) =>
        ref.flag !== "read" ||
        (ref.identifier !== storedCallback && ref.identifier !== capturedCallback),
    )
  )
    return null;
  const unsubscribe = scopes.symbolFor(returned.argument.body.callee);
  const dispose = unsubscribe?.initializer;
  if (
    unsubscribe?.kind !== "const" ||
    !isNodeOfType(dispose, "ArrowFunctionExpression") ||
    dispose.async ||
    dispose.params.length !== 2 ||
    dispose.params.some((p) => !isNodeOfType(p, "Identifier")) ||
    !isNodeOfType(dispose.body, "BlockStatement") ||
    dispose.body.body.length !== 1
  )
    return null;
  const statement = dispose.body.body[0];
  if (!isNodeOfType(statement, "ExpressionStatement")) return null;
  const remove = stripParenExpression(statement.expression);
  if (
    !isNodeOfType(remove, "CallExpression") ||
    remove.arguments.length !== 3 ||
    !isNodeOfType(remove.callee, "MemberExpression") ||
    remove.callee.computed ||
    !isNodeOfType(remove.callee.property, "Identifier") ||
    remove.callee.property.name !== "splice" ||
    !slot(remove.callee.object, dispose.params[0]) ||
    !isNodeOfType(remove.arguments[0], "Literal") ||
    remove.arguments[0].value !== 0
  )
    return null;
  const count = stripParenExpression(remove.arguments[1]);
  const spread = remove.arguments[2];
  if (
    !isNodeOfType(count, "MemberExpression") ||
    count.computed ||
    !isNodeOfType(count.property, "Identifier") ||
    count.property.name !== "length" ||
    !slot(count.object, dispose.params[0]) ||
    !isNodeOfType(spread, "SpreadElement")
  )
    return null;
  const filter = stripParenExpression(spread.argument);
  if (
    !isNodeOfType(filter, "CallExpression") ||
    filter.optional ||
    filter.arguments.length !== 1 ||
    !isNodeOfType(filter.callee, "MemberExpression") ||
    filter.callee.computed ||
    !isNodeOfType(filter.callee.property, "Identifier") ||
    filter.callee.property.name !== "filter" ||
    !slot(filter.callee.object, dispose.params[0])
  )
    return null;
  const predicate = filter.arguments[0];
  if (
    !isNodeOfType(predicate, "ArrowFunctionExpression") ||
    predicate.async ||
    predicate.params.length !== 1 ||
    !isNodeOfType(predicate.params[0], "Identifier") ||
    !isNodeOfType(predicate.body, "BinaryExpression") ||
    predicate.body.operator !== "!==" ||
    !same(predicate.body.left, predicate.params[0]) ||
    !same(predicate.body.right, dispose.params[1])
  )
    return null;
  // No whole registry or indexed array may escape to another consumer.
  for (const ref of registry.references) {
    const root = findTransparentExpressionRoot(ref.identifier);
    const parent = root.parent;
    if (isNodeOfType(parent, "MemberExpression") && parent.object === root && parent.computed) {
      const entry = findTransparentExpressionRoot(parent);
      const use = entry.parent;
      if (
        isNodeOfType(use, "MemberExpression") &&
        use.object === entry &&
        !use.computed &&
        isNodeOfType(use.property, "Identifier")
      ) {
        if (use.property.name === "length" && !isWithinAssignmentTarget(use)) continue;
        const invocation = findTransparentExpressionRoot(use).parent;
        if (
          ["push", "splice", "filter", "forEach"].includes(use.property.name) &&
          isNodeOfType(invocation, "CallExpression") &&
          invocation.callee === use
        )
          continue;
      }
      if (isNodeOfType(use, "UnaryExpression") && ["!", "delete"].includes(use.operator)) continue;
      if (
        isNodeOfType(use, "AssignmentExpression") &&
        use.left === entry &&
        use.operator === "=" &&
        isNodeOfType(use.right, "ArrayExpression") &&
        use.right.elements.length === 0
      )
        continue;
      return null;
    }
    if (
      isNodeOfType(parent, "ArrayExpression") &&
      isNodeOfType(parent.parent, "CallExpression") &&
      parent.parent.arguments[1] === parent &&
      isReactHookCall(parent.parent, new Set(["useEffect", "useMemo"]), scopes)
    )
      continue;
    // Provider cleanup's Object.keys(registry) is a bounded enumeration.
    if (
      isNodeOfType(parent, "CallExpression") &&
      parent.arguments.length === 1 &&
      parent.arguments[0] === root &&
      isNodeOfType(parent.callee, "MemberExpression") &&
      !parent.callee.computed &&
      isNodeOfType(parent.callee.object, "Identifier") &&
      parent.callee.object.name === "Object" &&
      scopes.isGlobalReference(parent.callee.object) &&
      isNodeOfType(parent.callee.property, "Identifier") &&
      parent.callee.property.name === "keys"
    )
      continue;
    return null;
  }
  return {
    subscribe: fn,
    registry: registry.bindingIdentifier,
    callbackParameter: callback,
    disposer: returned.argument,
  };
};
