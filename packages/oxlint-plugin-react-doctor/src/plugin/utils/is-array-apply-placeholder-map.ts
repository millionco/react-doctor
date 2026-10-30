import {
  ARRAY_APPLY_ARGUMENT_COUNT,
  ARRAY_APPLY_SLOTS_ARGUMENT_INDEX,
  ARRAY_CONSTRUCTOR_COUNT_ARGUMENT_COUNT,
  ARRAY_MAP_CALLBACK_ARGUMENT_COUNT,
  ARRAY_MAP_COLLECTION_PARAMETER_INDEX,
  ARRAY_MAP_INDEX_PARAMETER_INDEX,
  ARRAY_MAP_PARAMETER_COUNT,
} from "../constants/react.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const readonlyArrayReferencesByAnalysis = new WeakMap<ScopeAnalysis, boolean>();
const OPAQUE_CALLABLE_PROPERTY_NAMES = new Set(["constructor", "caller", "callee"]);
const OPAQUE_BUILTIN_GLOBAL_NAMES = new Set([
  "Function",
  "Object",
  "Reflect",
  "globalThis",
  "window",
  "self",
  "global",
  "eval",
]);

const hasOnlyReadonlyArrayCalls = (scopes: ScopeAnalysis): boolean => {
  const cachedResult = readonlyArrayReferencesByAnalysis.get(scopes);
  if (cachedResult !== undefined) return cachedResult;
  let hasUnsupportedExposure = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (
      isNodeOfType(node, "WithStatement") ||
      (isNodeOfType(node, "MemberExpression") && isWithinAssignmentTarget(node))
    )
      hasUnsupportedExposure = true;
    if (isNodeOfType(node, "MemberExpression")) {
      const propertyName = getStaticPropertyName(node);
      if (propertyName === null || OPAQUE_CALLABLE_PROPERTY_NAMES.has(propertyName))
        hasUnsupportedExposure = true;
    }
    if (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern")) {
      const propertyName = getStaticPropertyKeyName(node, { allowComputedString: true });
      if (propertyName === null || OPAQUE_CALLABLE_PROPERTY_NAMES.has(propertyName))
        hasUnsupportedExposure = true;
    }
  });
  const pendingScopes = [scopes.rootScope];
  let hasOnlyReadonlyCalls = !hasUnsupportedExposure;
  while (hasOnlyReadonlyCalls && pendingScopes.length > 0) {
    const scope = pendingScopes.pop();
    if (!scope) break;
    pendingScopes.push(...scope.children);
    for (const reference of scope.references) {
      const identifier = reference.identifier;
      if (!isNodeOfType(identifier, "Identifier") || !scopes.isGlobalReference(identifier))
        continue;
      if (OPAQUE_BUILTIN_GLOBAL_NAMES.has(identifier.name)) {
        hasOnlyReadonlyCalls = false;
        break;
      }
      if (identifier.name !== "Array") continue;
      const identifierRoot = findTransparentExpressionRoot(identifier);
      const parent = identifierRoot.parent;
      if (
        reference.flag === "read" &&
        (isNodeOfType(parent, "CallExpression") || isNodeOfType(parent, "NewExpression")) &&
        parent.callee === identifierRoot
      )
        continue;
      const memberRoot = parent ? findTransparentExpressionRoot(parent) : null;
      const call = memberRoot?.parent;
      if (
        reference.flag === "read" &&
        isNodeOfType(parent, "MemberExpression") &&
        parent.object === identifierRoot &&
        getStaticPropertyName(parent) === "apply" &&
        isNodeOfType(call, "CallExpression") &&
        call.callee === memberRoot
      )
        continue;
      hasOnlyReadonlyCalls = false;
      break;
    }
  }
  readonlyArrayReferencesByAnalysis.set(scopes, hasOnlyReadonlyCalls);
  return hasOnlyReadonlyCalls;
};

const isScalarCount = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const count = stripParenExpression(expression);
  if (isNodeOfType(count, "Literal"))
    return typeof count.value === "number" && Number.isInteger(count.value) && count.value >= 0;
  if (!isNodeOfType(count, "Identifier")) return false;
  const symbol = scopes.symbolFor(count);
  if (
    !symbol ||
    !isNodeOfType(symbol.bindingIdentifier, "Identifier") ||
    symbol.references.some((reference) => reference.flag !== "read")
  )
    return false;
  const annotation = symbol.bindingIdentifier.typeAnnotation;
  if (
    isNodeOfType(annotation, "TSTypeAnnotation") &&
    isNodeOfType(annotation.typeAnnotation, "TSNumberKeyword")
  )
    return true;
  const initializer = symbol.initializer ? stripParenExpression(symbol.initializer) : null;
  return Boolean(
    symbol.kind === "const" &&
    isNodeOfType(initializer, "Literal") &&
    typeof initializer.value === "number" &&
    Number.isInteger(initializer.value) &&
    initializer.value >= 0,
  );
};

export const isArrayApplyPlaceholderMap = (
  iterator: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(iterator.callee, "MemberExpression") ||
    getStaticPropertyName(iterator.callee) !== "map" ||
    iterator.arguments.length !== ARRAY_MAP_CALLBACK_ARGUMENT_COUNT
  )
    return false;
  const receiver = stripParenExpression(iterator.callee.object);
  if (
    !isNodeOfType(receiver, "CallExpression") ||
    receiver.arguments.length !== ARRAY_APPLY_ARGUMENT_COUNT
  )
    return false;
  const callee = stripParenExpression(receiver.callee);
  if (!isNodeOfType(callee, "MemberExpression") || getStaticPropertyName(callee) !== "apply")
    return false;
  const arrayConstructor = stripParenExpression(callee.object);
  if (
    !isNodeOfType(arrayConstructor, "Identifier") ||
    arrayConstructor.name !== "Array" ||
    !scopes.isGlobalReference(arrayConstructor)
  )
    return false;
  const thisArgument = stripParenExpression(receiver.arguments[0]);
  if (!isNodeOfType(thisArgument, "Literal") || thisArgument.value !== 0) return false;
  const slots = stripParenExpression(receiver.arguments[ARRAY_APPLY_SLOTS_ARGUMENT_INDEX]);
  if (
    (!isNodeOfType(slots, "CallExpression") && !isNodeOfType(slots, "NewExpression")) ||
    slots.arguments.length !== ARRAY_CONSTRUCTOR_COUNT_ARGUMENT_COUNT
  )
    return false;
  const slotsConstructor = stripParenExpression(slots.callee);
  if (
    !isNodeOfType(slotsConstructor, "Identifier") ||
    slotsConstructor.name !== "Array" ||
    !scopes.isGlobalReference(slotsConstructor) ||
    !isScalarCount(slots.arguments[0], scopes)
  )
    return false;
  const callback = iterator.arguments[0];
  if (
    !isFunctionLike(callback) ||
    callback.async ||
    callback.generator ||
    callback.params.length > ARRAY_MAP_PARAMETER_COUNT
  )
    return false;
  if (isNodeOfType(callback, "FunctionExpression") && callback.id) return false;
  let readsOpaqueInput = false;
  walkAst(callback.body, (node) => {
    if (
      isNodeOfType(node, "ThisExpression") ||
      (isNodeOfType(node, "Identifier") && node.name === "arguments" && scopes.referenceFor(node))
    )
      readsOpaqueInput = true;
  });
  if (readsOpaqueInput) return false;
  const itemParameter = callback.params[0];
  const indexParameter = callback.params[ARRAY_MAP_INDEX_PARAMETER_INDEX];
  const collectionParameter = callback.params[ARRAY_MAP_COLLECTION_PARAMETER_INDEX];
  if (
    !isNodeOfType(itemParameter, "Identifier") ||
    scopes.symbolFor(itemParameter)?.references.length !== 0 ||
    !isNodeOfType(indexParameter, "Identifier") ||
    (collectionParameter &&
      (!isNodeOfType(collectionParameter, "Identifier") ||
        scopes.symbolFor(collectionParameter)?.references.length !== 0))
  )
    return false;
  const indexSymbol = scopes.symbolFor(indexParameter);
  if (!indexSymbol) return false;
  if (
    !indexSymbol.references.every((reference) => {
      const parent = findTransparentExpressionRoot(reference.identifier).parent;
      return (
        reference.flag === "read" &&
        findEnclosingFunction(reference.identifier) === callback &&
        isNodeOfType(parent, "JSXExpressionContainer")
      );
    })
  )
    return false;
  return hasOnlyReadonlyArrayCalls(scopes);
};
