import { componentOrHookDisplayNameForFunction } from "./component-or-hook-display-name.js";
import {
  FUNCTION_RESOLUTION_MAX_DEPTH,
  FRESH_RECORD_PRODUCER_MAX_STATEMENT_COUNT,
  STRING_RECORD_CALLBACK_MAX_PARAMETER_COUNT,
} from "../constants/thresholds.js";
import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getFunctionBindingSymbols } from "./get-function-binding-symbols.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasRuntimeValueBinding } from "./has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "./is-erased-typescript-binding.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { isMemberMutationTarget } from "./is-member-mutation-target.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { resolveExactLocalFunction } from "./resolve-exact-local-function.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const unsupportedOperationByScopes = new WeakMap<RuleContext["scopes"], boolean>();
const MUTATING_METHODS = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
]);

const hasUnsupportedSourceOperation = (context: RuleContext): boolean => {
  const cached = unsupportedOperationByScopes.get(context.scopes);
  if (cached !== undefined) return cached;
  let unsupportedOperation = false;
  walkAst(context.scopes.rootScope.node, (node) => {
    if (unsupportedOperation) return false;
    const binding = isNodeOfType(node, "Identifier") ? context.scopes.symbolFor(node) : null;
    const receiver = isNodeOfType(node, "MemberExpression")
      ? stripParenExpression(node.object)
      : null;
    const receiverSymbol = isNodeOfType(receiver, "Identifier")
      ? resolveConstIdentifierAlias(receiver, context.scopes)
      : null;
    const receiverOrigin = receiverSymbol?.initializer
      ? stripParenExpression(receiverSymbol.initializer)
      : receiver;
    const exposesIntrinsic =
      isNodeOfType(node, "MemberExpression") &&
      node.computed &&
      getResolvedStaticPropertyName(node, context.scopes) === null &&
      Boolean(
        receiver &&
        (isNodeOfType(receiverOrigin, "Literal") ||
          isNodeOfType(receiverOrigin, "TemplateLiteral") ||
          isNodeOfType(receiverOrigin, "ArrayExpression") ||
          isNodeOfType(receiverOrigin, "ObjectExpression") ||
          resolveExactLocalFunction(receiver, context.scopes) ||
          (receiverOrigin && isReactApiCall(receiverOrigin, "useCallback", context.scopes))),
      );
    const patternKey =
      isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern")
        ? getResolvedStaticPropertyName(node, context.scopes)
        : undefined;
    const exposesPatternIntrinsic =
      patternKey !== undefined &&
      (patternKey === null ||
        ["constructor", "caller", "callee", "prototype", "__proto__"].includes(patternKey));
    if (
      exposesIntrinsic ||
      exposesPatternIntrinsic ||
      (isNodeOfType(node, "MemberExpression") && isMemberMutationTarget(node)) ||
      (isNodeOfType(node, "Identifier") &&
        ["String", "Array", "Object", "Symbol", "Reflect", "Function", "eval"].includes(
          node.name,
        ) &&
        (context.scopes.isGlobalReference(node) ||
          Boolean(
            binding &&
            context.scopes.referenceFor(node) &&
            isErasedTypeScriptBinding(binding) &&
            !hasRuntimeValueBinding(binding),
          ))) ||
      (isNodeOfType(node, "MemberExpression") &&
        [
          "prototype",
          "__proto__",
          "constructor",
          "String",
          "Array",
          "Object",
          "Symbol",
          "Function",
          "Reflect",
          "eval",
          "caller",
          "callee",
          "arguments",
        ].includes(getResolvedStaticPropertyName(node, context.scopes) ?? "")) ||
      (isNodeOfType(node, "Identifier") &&
        ["globalThis", "window", "self", "global"].includes(node.name) &&
        context.scopes.isGlobalReference(node) &&
        (!isNodeOfType(node.parent, "MemberExpression") ||
          node.parent.object !== node ||
          node.parent.computed ||
          isWithinAssignmentTarget(node))) ||
      isNodeOfType(node, "WithStatement")
    )
      unsupportedOperation = true;
  });
  unsupportedOperationByScopes.set(context.scopes, unsupportedOperation);
  return unsupportedOperation;
};

const isStableReactCall = (
  node: EsTreeNode,
  names: string | ReadonlySet<string>,
  context: RuleContext,
): boolean => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    !isNodeOfType(node.callee, "Identifier") ||
    !isReactApiCall(node, names, context.scopes)
  )
    return false;
  const hook = context.scopes.symbolFor(node.callee);
  return Boolean(
    hook?.kind === "import" &&
    hook.references.every(
      (reference) =>
        reference.flag === "read" &&
        isNodeOfType(reference.identifier.parent, "CallExpression") &&
        reference.identifier.parent.callee === reference.identifier,
    ),
  );
};

const hasOpaqueCallbackInputs = (callback: EsTreeNode, context: RuleContext): boolean => {
  if (
    !isFunctionLike(callback) ||
    callback.params.length > STRING_RECORD_CALLBACK_MAX_PARAMETER_COUNT ||
    callback.params.some((parameter) => !isNodeOfType(parameter, "Identifier")) ||
    (isNodeOfType(callback, "FunctionExpression") && callback.id)
  )
    return true;
  let opaque = false;
  walkAst(callback.body, (node) => {
    if (opaque) return false;
    if (
      isNodeOfType(node, "ThisExpression") ||
      (isNodeOfType(node, "Identifier") &&
        node.name === "arguments" &&
        context.scopes.isGlobalReference(node))
    )
      opaque = true;
  });
  return opaque;
};

const findRenderOwner = (node: EsTreeNode): EsTreeNode | null => {
  let owner = findEnclosingFunction(node);
  while (owner) {
    if (componentOrHookDisplayNameForFunction(owner)) return owner;
    owner = findEnclosingFunction(owner);
  }
  return null;
};

const isReadonlyRecordParameter = (symbol: SymbolDescriptor): boolean =>
  symbol.kind === "parameter" &&
  symbol.references.every((reference) => {
    const member = reference.identifier.parent;
    let field = member;
    while (isNodeOfType(field?.parent, "MemberExpression") && field.parent.object === field) {
      field = field.parent;
      if (field.computed) return false;
    }
    return (
      reference.flag === "read" &&
      !isWithinAssignmentTarget(reference.identifier) &&
      isNodeOfType(member, "MemberExpression") &&
      member.object === reference.identifier &&
      !member.computed &&
      getStaticPropertyName(member) !== null &&
      !(isNodeOfType(member.parent, "CallExpression") && member.parent.callee === member)
    );
  });

const isDeferredReactCallback = (
  functionNode: EsTreeNode,
  context: RuleContext,
  visited = new Set<EsTreeNode>(),
): boolean => {
  if (
    hasOpaqueCallbackInputs(functionNode, context) ||
    visited.has(functionNode) ||
    visited.size >= FUNCTION_RESOLUTION_MAX_DEPTH ||
    (isNodeOfType(functionNode, "FunctionExpression") && functionNode.id)
  )
    return false;
  visited.add(functionNode);
  const parent = functionNode.parent;
  if (
    isNodeOfType(parent, "JSXExpressionContainer") &&
    isNodeOfType(parent.parent, "JSXAttribute") &&
    isNodeOfType(parent.parent.name, "JSXIdentifier") &&
    /^on[A-Z]/.test(parent.parent.name.name) &&
    isNodeOfType(parent.parent.parent, "JSXOpeningElement") &&
    isNodeOfType(parent.parent.parent.name, "JSXIdentifier") &&
    /^[a-z]+$/.test(parent.parent.parent.name.name)
  )
    return true;
  if (
    isNodeOfType(parent, "CallExpression") &&
    parent.arguments[0] === functionNode &&
    isStableReactCall(parent, "useEffect", context)
  )
    return true;
  if (isNodeOfType(parent, "ReturnStatement") && parent.argument === functionNode) {
    const effect = findEnclosingFunction(parent);
    const call = effect?.parent;
    return Boolean(
      effect &&
      isNodeOfType(call, "CallExpression") &&
      call.arguments[0] === effect &&
      isStableReactCall(call, "useEffect", context),
    );
  }
  if (
    !isNodeOfType(parent, "CallExpression") ||
    parent.arguments[0] !== functionNode ||
    !isStableReactCall(parent, "useCallback", context)
  )
    return false;
  const symbols = getFunctionBindingSymbols(functionNode, context.scopes);
  return (
    symbols.length > 0 &&
    symbols.every(
      (symbol) =>
        symbol.kind === "const" &&
        symbol.references.every((reference) => {
          if (reference.flag !== "read") return false;
          const operation = reference.identifier.parent;
          if (isNodeOfType(operation, "ArrayExpression")) {
            const call = operation.parent;
            return (
              isNodeOfType(call, "CallExpression") &&
              call.arguments[1] === operation &&
              isStableReactCall(call, new Set(["useCallback", "useEffect"]), context)
            );
          }
          if (!isNodeOfType(operation, "CallExpression")) return false;
          if (operation.callee === reference.identifier) {
            const caller = findEnclosingFunction(operation);
            return Boolean(caller && isDeferredReactCallback(caller, context, new Set(visited)));
          }
          const callee = operation.callee;
          const registration = findEnclosingFunction(operation);
          return (
            operation.arguments[1] === reference.identifier &&
            isNodeOfType(callee, "MemberExpression") &&
            !callee.computed &&
            isNodeOfType(callee.object, "Identifier") &&
            callee.object.name === "window" &&
            context.scopes.isGlobalReference(callee.object) &&
            ["addEventListener", "removeEventListener"].includes(
              getStaticPropertyName(callee) ?? "",
            ) &&
            isNodeOfType(operation.arguments[0], "Literal") &&
            typeof operation.arguments[0].value === "string" &&
            Boolean(
              registration && isDeferredReactCallback(registration, context, new Set(visited)),
            )
          );
        }),
    )
  );
};

const isClosedArrayBinding = (
  symbol: SymbolDescriptor,
  context: RuleContext,
  visited: Set<number>,
): boolean => {
  if (visited.has(symbol.id) || visited.size >= FUNCTION_RESOLUTION_MAX_DEPTH) return false;
  visited.add(symbol.id);
  return (
    symbol.kind === "const" &&
    symbol.references.every((reference) => {
      const identifier = reference.identifier;
      if (reference.flag !== "read" || isWithinAssignmentTarget(identifier)) return false;
      let root = findTransparentExpressionRoot(identifier);
      while (isNodeOfType(root.parent, "ConditionalExpression")) root = root.parent;
      const parent = root.parent;
      if (
        isNodeOfType(parent, "VariableDeclarator") &&
        parent.init === root &&
        isNodeOfType(parent.id, "Identifier")
      ) {
        const alias = context.scopes.symbolFor(parent.id);
        return Boolean(alias && isClosedArrayBinding(alias, context, new Set(visited)));
      }
      if (isNodeOfType(parent, "ReturnStatement"))
        return Boolean(
          symbol.initializer &&
          findEnclosingFunction(parent) === findEnclosingFunction(symbol.initializer),
        );
      if (isNodeOfType(parent, "ArrayExpression")) {
        const call = parent.parent;
        return (
          isNodeOfType(call, "CallExpression") &&
          call.arguments[1] === parent &&
          isStableReactCall(call, new Set(["useCallback", "useEffect"]), context)
        );
      }
      if (!isNodeOfType(parent, "MemberExpression") || parent.object !== root) return false;
      let member: EsTreeNode = parent;
      while (isNodeOfType(member.parent, "MemberExpression") && member.parent.object === member)
        member = member.parent;
      const operation = member.parent;
      if (!isNodeOfType(operation, "CallExpression")) {
        return (
          member !== parent || (!parent.computed && getStaticPropertyName(parent) === "length")
        );
      }
      if (operation.callee !== member) return false;
      const method = getStaticPropertyName(member);
      if (!method || MUTATING_METHODS.has(method)) return false;
      if (member !== parent) {
        const callback = findEnclosingFunction(operation);
        return Boolean(callback && isDeferredReactCallback(callback, context));
      }
      if (method !== "map" && method !== "filter") return false;
      const callback = operation.arguments[0];
      if (
        !isFunctionLike(callback) ||
        hasOpaqueCallbackInputs(callback, context) ||
        !isNodeOfType(callback.params[0], "Identifier")
      )
        return false;
      const item = context.scopes.symbolFor(callback.params[0]);
      if (!item || !isReadonlyRecordParameter(item)) return false;
      if (method === "map") return true;
      const resultParent = operation.parent;
      if (
        isNodeOfType(resultParent, "VariableDeclarator") &&
        isNodeOfType(resultParent.id, "Identifier")
      ) {
        const filtered = context.scopes.symbolFor(resultParent.id);
        return Boolean(filtered && isClosedArrayBinding(filtered, context, new Set(visited)));
      }
      return (
        isNodeOfType(resultParent, "MemberExpression") &&
        resultParent.object === operation &&
        getStaticPropertyName(resultParent) === "map"
      );
    })
  );
};

const recordHasOwnString = (record: EsTreeNode, propertyName: string): boolean => {
  if (!isNodeOfType(record, "ObjectExpression")) return false;
  const keys = new Set<string>();
  let hasString = false;
  for (const property of record.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.kind !== "init" ||
      property.method ||
      property.computed
    )
      return false;
    const key = getStaticPropertyKeyName(property);
    if (
      key === null ||
      key === "__proto__" ||
      keys.has(key) ||
      isNodeOfType(property.value, "FunctionExpression")
    )
      return false;
    keys.add(key);
    if (key === propertyName)
      hasString =
        isNodeOfType(property.value, "Literal") && typeof property.value.value === "string";
  }
  return hasString;
};

const proveArrayStringField = (
  expression: EsTreeNode,
  propertyName: string,
  context: RuleContext,
  owner: EsTreeNode,
  depth: number,
): boolean => {
  if (depth >= FUNCTION_RESOLUTION_MAX_DEPTH) return false;
  const node = stripParenExpression(expression);
  if (isNodeOfType(node, "ArrayExpression"))
    return (
      findEnclosingFunction(node) === owner &&
      node.elements.length > 0 &&
      node.elements.every((element) =>
        Boolean(element && recordHasOwnString(element, propertyName)),
      )
    );
  if (isNodeOfType(node, "Identifier")) {
    const symbol = context.scopes.symbolFor(node);
    return Boolean(
      symbol?.initializer &&
      findEnclosingFunction(symbol.initializer) === owner &&
      isClosedArrayBinding(symbol, context, new Set()) &&
      proveArrayStringField(symbol.initializer, propertyName, context, owner, depth + 1),
    );
  }
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (isNodeOfType(node.callee, "MemberExpression")) {
    if (node.optional || node.callee.optional || getStaticPropertyName(node.callee) !== "filter")
      return false;
    const callback = node.arguments[0];
    if (
      !isFunctionLike(callback) ||
      hasOpaqueCallbackInputs(callback, context) ||
      !isNodeOfType(callback.params[0], "Identifier")
    )
      return false;
    const item = context.scopes.symbolFor(callback.params[0]);
    return Boolean(
      item &&
      isReadonlyRecordParameter(item) &&
      proveArrayStringField(node.callee.object, propertyName, context, owner, depth + 1),
    );
  }
  if (!isNodeOfType(node.callee, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(node.callee);
  if (
    !symbol ||
    symbol.kind !== "const" ||
    !symbol.initializer ||
    !symbol.references.every(
      (reference) =>
        reference.flag === "read" &&
        isNodeOfType(reference.identifier.parent, "CallExpression") &&
        reference.identifier.parent.callee === reference.identifier,
    )
  )
    return false;
  let target = stripParenExpression(symbol.initializer);
  if (isNodeOfType(target, "CallExpression")) {
    if (
      !isStableReactCall(target, "useCallback", context) ||
      !isNodeOfType(target.callee, "Identifier")
    )
      return false;
    const hook = context.scopes.symbolFor(target.callee);
    if (
      !hook ||
      hook.references.some(
        (reference) =>
          reference.flag !== "read" ||
          !isNodeOfType(reference.identifier.parent, "CallExpression") ||
          reference.identifier.parent.callee !== reference.identifier,
      )
    )
      return false;
    const callback = target.arguments[0];
    if (!callback) return false;
    target = stripParenExpression(callback);
  }
  if (
    !isFunctionLike(target) ||
    hasOpaqueCallbackInputs(target, context) ||
    target.async ||
    target.generator ||
    target.params.length !== 0 ||
    node.arguments.length !== 0
  )
    return false;
  if (!isNodeOfType(target.body, "BlockStatement"))
    return proveArrayStringField(target.body, propertyName, context, target, depth + 1);
  const statements = target.body.body;
  const returned = statements.at(-1);
  if (
    !isNodeOfType(returned, "ReturnStatement") ||
    !returned.argument ||
    statements.length > FRESH_RECORD_PRODUCER_MAX_STATEMENT_COUNT
  )
    return false;
  if (
    statements.length === FRESH_RECORD_PRODUCER_MAX_STATEMENT_COUNT &&
    (!isNodeOfType(statements[0], "VariableDeclaration") ||
      statements[0].kind !== "const" ||
      statements[0].declarations.length !== 1)
  )
    return false;
  return proveArrayStringField(returned.argument, propertyName, context, target, depth + 1);
};

export const isLocalRecordStringMember = (
  expression: EsTreeNode,
  context: RuleContext,
  tokenCallback: EsTreeNode | null,
): boolean => {
  if (!tokenCallback || hasOpaqueCallbackInputs(tokenCallback, context)) return false;
  const owner = findRenderOwner(tokenCallback);
  if (!owner) return false;
  const member = stripParenExpression(expression);
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.computed ||
    member.optional ||
    !isNodeOfType(member.object, "Identifier") ||
    hasUnsupportedSourceOperation(context)
  )
    return false;
  const propertyName = getStaticPropertyName(member);
  const item = context.scopes.symbolFor(member.object);
  if (!propertyName || !item || !isReadonlyRecordParameter(item)) return false;
  const callback = findEnclosingFunction(item.bindingIdentifier);
  const invocation = callback?.parent;
  return Boolean(
    isFunctionLike(callback) &&
    !hasOpaqueCallbackInputs(callback, context) &&
    isNodeOfType(callback.params[0], "Identifier") &&
    callback.params[0] === item.bindingIdentifier &&
    isNodeOfType(invocation, "CallExpression") &&
    invocation.arguments[0] === callback &&
    !invocation.optional &&
    isNodeOfType(invocation.callee, "MemberExpression") &&
    !invocation.callee.optional &&
    !invocation.callee.computed &&
    getStaticPropertyName(invocation.callee) === "map" &&
    proveArrayStringField(invocation.callee.object, propertyName, context, owner, 0),
  );
};
