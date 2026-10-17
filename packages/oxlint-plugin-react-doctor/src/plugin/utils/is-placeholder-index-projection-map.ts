import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getNodeStartIndex } from "./get-node-start-index.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import {
  isProvenGlobalNamespaceReference,
  isProvenGlobalObjectReference,
} from "./is-proven-global-namespace-reference.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isErasedTypeScriptBinding } from "./is-erased-typescript-binding.js";
import { hasRuntimeValueBinding } from "./has-runtime-value-binding.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const closedArrayProvidersByAnalysis = new WeakMap<ScopeAnalysis, boolean>();
const UNSUPPORTED_ARRAY_PROVIDER_NAMES = new Set([
  "Object",
  "Reflect",
  "Function",
  "eval",
  "globalThis",
  "global",
  "self",
  "frames",
  "top",
  "parent",
  "opener",
  "module",
  "process",
]);
const UNSUPPORTED_ARRAY_PROVIDER_PROPERTIES = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "caller",
  "callee",
  "__defineGetter__",
  "__defineSetter__",
]);

const isReadonlySymbol = (symbol: SymbolDescriptor): boolean =>
  symbol.references.every(
    (reference) => reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
  );

const isProviderCarrier = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visited = new Set<number>(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (
    isNodeOfType(candidate, "ArrayExpression") ||
    isNodeOfType(candidate, "ObjectExpression") ||
    isProvenGlobalNamespaceReference(candidate, "Array", scopes) ||
    isProvenGlobalObjectReference(candidate, scopes)
  )
    return true;
  if (
    (isNodeOfType(candidate, "CallExpression") || isNodeOfType(candidate, "NewExpression")) &&
    isNodeOfType(candidate.callee, "Identifier") &&
    candidate.callee.name === "Array" &&
    scopes.isGlobalReference(candidate.callee)
  )
    return true;
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = scopes.symbolFor(candidate);
  if (!symbol || visited.has(symbol.id)) return false;
  const initializer = getDirectConstInitializer(symbol);
  if (!initializer) return false;
  visited.add(symbol.id);
  return isProviderCarrier(initializer, scopes, visited);
};

const isClosedJsxDataProjection = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const declaration = node.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.init !== node ||
    !isNodeOfType(declaration.id, "Identifier")
  )
    return false;
  const symbol = scopes.symbolFor(declaration.id);
  return Boolean(
    symbol &&
    getDirectConstInitializer(symbol) === node &&
    isReadonlySymbol(symbol) &&
    symbol.references.length > 0 &&
    symbol.references.every(
      (reference) =>
        isNodeOfType(reference.identifier.parent, "JSXSpreadAttribute") &&
        reference.identifier.parent.argument === reference.identifier,
    ),
  );
};

const hasClosedArrayProvider = (scopes: ScopeAnalysis): boolean => {
  const cached = closedArrayProvidersByAnalysis.get(scopes);
  if (cached !== undefined) return cached;
  let isClosed = true;
  walkAst(scopes.rootScope.node, (node) => {
    if (
      isNodeOfType(node, "Identifier") &&
      UNSUPPORTED_ARRAY_PROVIDER_NAMES.has(node.name) &&
      !isTypeScriptTypePosition(node)
    ) {
      const providerSymbol = scopes.symbolFor(node);
      if (
        providerSymbol &&
        providerSymbol.bindingIdentifier !== node &&
        isErasedTypeScriptBinding(providerSymbol) &&
        !hasRuntimeValueBinding(providerSymbol)
      ) {
        isClosed = false;
        return false;
      }
    }
    if (
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "AssignmentExpression") ||
      isNodeOfType(node, "UpdateExpression") ||
      isNodeOfType(node, "ClassDeclaration") ||
      isNodeOfType(node, "ClassExpression") ||
      isNodeOfType(node, "ThisExpression")
    )
      isClosed = false;
    if (
      isNodeOfType(node, "MemberExpression") &&
      (isWithinAssignmentTarget(node) ||
        UNSUPPORTED_ARRAY_PROVIDER_PROPERTIES.has(getStaticPropertyName(node) ?? "") ||
        (node.computed &&
          getStaticPropertyName(node) === null &&
          isProviderCarrier(node.object, scopes) &&
          !isClosedJsxDataProjection(node, scopes)))
    )
      isClosed = false;
    if (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern")) {
      const property = getStaticPropertyKeyName(node, { allowComputedString: true });
      if (property === null || UNSUPPORTED_ARRAY_PROVIDER_PROPERTIES.has(property))
        isClosed = false;
    }
  });
  const pending = [scopes.rootScope];
  while (isClosed && pending.length > 0) {
    const scope = pending.pop();
    if (!scope) break;
    pending.push(...scope.children);
    for (const reference of scope.references) {
      const identifier = reference.identifier;
      if (!isNodeOfType(identifier, "Identifier") || !scopes.isGlobalReference(identifier))
        continue;
      if (UNSUPPORTED_ARRAY_PROVIDER_NAMES.has(identifier.name)) {
        isClosed = false;
        break;
      }
      const root = findTransparentExpressionRoot(identifier);
      const parent = root.parent;
      if (identifier.name === "Array") {
        if (
          reference.flag !== "read" ||
          (!isNodeOfType(parent, "CallExpression") && !isNodeOfType(parent, "NewExpression")) ||
          parent.callee !== root
        )
          isClosed = false;
      } else if (identifier.name === "window") {
        if (
          !isNodeOfType(parent, "MemberExpression") ||
          parent.object !== root ||
          parent.optional ||
          (getStaticPropertyName(parent) !== "innerWidth" &&
            getStaticPropertyName(parent) !== "innerHeight")
        )
          isClosed = false;
      }
    }
  }
  closedArrayProvidersByAnalysis.set(scopes, isClosed);
  return isClosed;
};

const isLiteralSlotCount = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let count = stripParenExpression(expression);
  if (isNodeOfType(count, "Identifier")) {
    const symbol = scopes.symbolFor(count);
    if (!symbol || !isReadonlySymbol(symbol)) return false;
    const initializer = getDirectConstInitializer(symbol);
    if (!initializer || getNodeStartIndex(initializer) >= getNodeStartIndex(count)) return false;
    count = stripParenExpression(initializer);
  }
  return (
    isNodeOfType(count, "Literal") &&
    typeof count.value === "number" &&
    Number.isInteger(count.value) &&
    count.value >= 0
  );
};

export const isPlaceholderIndexProjectionMap = (
  iterator: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const member = iterator.callee;
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.computed ||
    member.optional ||
    iterator.optional ||
    !isNodeOfType(member.property, "Identifier") ||
    member.property.name !== "map" ||
    !isNodeOfType(member.object, "Identifier")
  )
    return false;
  const [renderer, ...extraRendererArguments] = iterator.arguments;
  if (
    !isNodeOfType(renderer, "ArrowFunctionExpression") ||
    renderer.async ||
    renderer.generator ||
    extraRendererArguments.length !== 0
  )
    return false;
  const [renderItem, renderIndex, ...extraRenderParameters] = renderer.params;
  if (
    !isNodeOfType(renderItem, "Identifier") ||
    !isNodeOfType(renderIndex, "Identifier") ||
    extraRenderParameters.length !== 0 ||
    scopes.symbolFor(renderItem)?.references.length !== 0
  )
    return false;
  const resultSymbol = scopes.symbolFor(member.object);
  if (!resultSymbol || !isReadonlySymbol(resultSymbol)) return false;
  const initializer = getDirectConstInitializer(resultSymbol);
  const [onlyRead, ...extraReads] = resultSymbol.references;
  if (
    !initializer ||
    !onlyRead ||
    extraReads.length !== 0 ||
    onlyRead.identifier !== member.object ||
    getNodeStartIndex(initializer) >= getNodeStartIndex(member.object) ||
    findEnclosingFunction(initializer) !== findEnclosingFunction(iterator)
  )
    return false;
  const projection = stripParenExpression(initializer);
  if (
    !isNodeOfType(projection, "CallExpression") ||
    projection.optional ||
    !isNodeOfType(projection.callee, "MemberExpression") ||
    projection.callee.computed ||
    projection.callee.optional ||
    !isNodeOfType(projection.callee.property, "Identifier") ||
    projection.callee.property.name !== "map"
  )
    return false;
  const [callback, ...extraArguments] = projection.arguments;
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.generator ||
    extraArguments.length !== 0
  )
    return false;
  const [item, index, ...extraParameters] = callback.params;
  if (
    !isNodeOfType(item, "Identifier") ||
    !isNodeOfType(index, "Identifier") ||
    extraParameters.length !== 0 ||
    !isNodeOfType(callback.body, "Identifier")
  )
    return false;
  const itemSymbol = scopes.symbolFor(item);
  const indexSymbol = scopes.symbolFor(index);
  if (
    !itemSymbol ||
    itemSymbol.references.length !== 0 ||
    !indexSymbol ||
    scopes.symbolFor(callback.body) !== indexSymbol ||
    !isReadonlySymbol(indexSymbol)
  )
    return false;
  const fill = projection.callee.object;
  if (
    !isNodeOfType(fill, "CallExpression") ||
    fill.optional ||
    !isNodeOfType(fill.callee, "MemberExpression") ||
    fill.callee.computed ||
    fill.callee.optional ||
    !isNodeOfType(fill.callee.property, "Identifier") ||
    fill.callee.property.name !== "fill"
  )
    return false;
  const [fillValue, ...extraFillArguments] = fill.arguments;
  if (
    !isNodeOfType(fillValue, "Literal") ||
    fillValue.value !== null ||
    extraFillArguments.length !== 0
  )
    return false;
  const constructor = fill.callee.object;
  if (
    (!isNodeOfType(constructor, "CallExpression") && !isNodeOfType(constructor, "NewExpression")) ||
    (isNodeOfType(constructor, "CallExpression") && constructor.optional) ||
    !isNodeOfType(constructor.callee, "Identifier") ||
    constructor.callee.name !== "Array" ||
    !scopes.isGlobalReference(constructor.callee)
  )
    return false;
  const [count, ...extraCounts] = constructor.arguments;
  return Boolean(
    count &&
    extraCounts.length === 0 &&
    isLiteralSlotCount(count, scopes) &&
    hasClosedArrayProvider(scopes),
  );
};
