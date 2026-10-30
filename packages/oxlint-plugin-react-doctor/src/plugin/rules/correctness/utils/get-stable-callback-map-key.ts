import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getNodeStartIndex } from "../../../utils/get-node-start-index.js";
import { getStaticObjectPropertyValue } from "../../../utils/get-static-object-property-value.js";
import { getEquivalentSymbols } from "../../../utils/get-equivalent-symbols.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { NO_VALUE_COUNT } from "./callback-map-snapshot/constants.js";
import { getExternalReferenceKey } from "./has-equivalent-null-detach-action.js";
import { isReadonlyCallbackMapSymbol as isReadonly } from "./is-readonly-callback-map-symbol.js";

const readonlyKeyPaths = new WeakMap<SymbolDescriptor, Map<string, boolean>>();

const proveReadonlyKeyPathAliases = (
  root: EsTreeNode,
  selectedPath: readonly string[],
  scopes: ScopeAnalysis,
): boolean => {
  const pendingSymbols = [...getEquivalentSymbols(root, scopes)];
  if (!pendingSymbols.length) return false;
  const paths = new Map(pendingSymbols.map((symbol) => [symbol.id, selectedPath]));
  const checkedSymbols = new Set<number>();
  for (const symbol of pendingSymbols) {
    if (checkedSymbols.has(symbol.id)) continue;
    checkedSymbols.add(symbol.id);
    if (!isReadonly(symbol)) return false;
    const path = paths.get(symbol.id);
    if (!path) return false;
    for (const { identifier } of symbol.references) {
      if (isWithinAssignmentTarget(identifier)) return false;
      let expression = findTransparentExpressionRoot(identifier);
      const referencePath: string[] = [];
      while (
        isNodeOfType(expression.parent, "MemberExpression") &&
        expression.parent.object === expression
      ) {
        const member = expression.parent;
        const propertyName = getResolvedStaticPropertyName(member, scopes, {
          allowConstTemplateLiteral: true,
        });
        if (propertyName === null) return false;
        referencePath.push(propertyName);
        expression = findTransparentExpressionRoot(member);
      }
      if (
        referencePath.some((name, index) => index < path.length && path[index] !== name) ||
        referencePath.length >= path.length
      )
        continue;
      const remainingPath = path.slice(referencePath.length);
      const parent = expression.parent;
      if (!parent) return false;
      if (isNodeOfType(parent, "VariableDeclarator") && parent.init === expression) {
        if (!isNodeOfType(parent.id, "Identifier")) return false;
        const aliases = getEquivalentSymbols(parent.id, scopes);
        if (!aliases.length) return false;
        for (const alias of aliases) {
          const previousPath = paths.get(alias.id);
          if (
            previousPath &&
            (previousPath.length !== remainingPath.length ||
              previousPath.some((name, index) => remainingPath[index] !== name))
          )
            return false;
          paths.set(alias.id, remainingPath);
        }
        pendingSymbols.push(...aliases);
      } else if (
        isNodeOfType(parent, "CallExpression") ||
        isNodeOfType(parent, "NewExpression") ||
        isNodeOfType(parent, "TaggedTemplateExpression") ||
        isNodeOfType(parent, "AssignmentExpression") ||
        isNodeOfType(parent, "LogicalExpression") ||
        isNodeOfType(parent, "ConditionalExpression") ||
        isNodeOfType(parent, "ArrayExpression") ||
        isNodeOfType(parent, "Property") ||
        isNodeOfType(parent, "ReturnStatement") ||
        isNodeOfType(parent, "SpreadElement") ||
        (isNodeOfType(parent, "ArrowFunctionExpression") && parent.body === expression)
      ) {
        return false;
      }
    }
  }
  return true;
};

const hasReadonlyKeyPathAliases = (
  root: EsTreeNode,
  selectedPath: readonly string[],
  scopes: ScopeAnalysis,
): boolean => {
  const symbol = scopes.symbolFor(root);
  if (!symbol) return false;
  let paths = readonlyKeyPaths.get(symbol);
  if (!paths) {
    paths = new Map();
    readonlyKeyPaths.set(symbol, paths);
  }
  const path = JSON.stringify(selectedPath);
  const cached = paths.get(path);
  if (cached !== undefined) return cached;
  const readonly = proveReadonlyKeyPathAliases(root, selectedPath, scopes);
  paths.set(path, readonly);
  return readonly;
};

export const getStableCallbackMapKey = (
  key: EsTreeNode,
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
): string | null => {
  const expression = stripParenExpression(key);
  if (isNodeOfType(expression, "Literal"))
    return typeof expression.value === "string" ? `literal:${expression.value}` : null;
  const serialized = getExternalReferenceKey(expression, callback, scopes);
  if (!serialized) return null;
  let root: EsTreeNode = expression;
  while (isNodeOfType(root, "MemberExpression")) root = stripParenExpression(root.object);
  if (!isNodeOfType(root, "Identifier")) return null;
  const equivalents = getEquivalentSymbols(root, scopes);
  if (!equivalents.length || equivalents.some((symbol) => !isReadonly(symbol))) return null;
  for (const symbol of equivalents) {
    const initializer = symbol.initializer && stripParenExpression(symbol.initializer);
    if (
      initializer &&
      isNodeOfType(initializer, "ObjectExpression") &&
      initializer.properties.some(
        (property) =>
          !isNodeOfType(property, "Property") ||
          property.kind !== "init" ||
          property.method ||
          property.computed,
      )
    )
      return null;
  }
  const pendingProperties: string[] = [];
  const checkedSymbols = new Set<number>();
  let value: EsTreeNode = expression;
  while (true) {
    while (isNodeOfType(value, "MemberExpression")) {
      if (value.optional || value.computed || !isNodeOfType(value.property, "Identifier"))
        return null;
      pendingProperties.unshift(value.property.name);
      value = stripParenExpression(value.object);
    }
    if (isNodeOfType(value, "Identifier")) {
      if (!hasReadonlyKeyPathAliases(value, pendingProperties, scopes)) return null;
      const symbol = scopes.symbolFor(value);
      if (!symbol || !isReadonly(symbol) || checkedSymbols.has(symbol.id)) return null;
      if (!pendingProperties.length || symbol.kind === "parameter")
        return `reference:${serialized}`;
      const initializer = getDirectConstInitializer(symbol);
      const declarationStart = getNodeStartIndex(symbol.declarationNode);
      const referenceStart = getNodeStartIndex(value);
      if (
        !initializer ||
        declarationStart < NO_VALUE_COUNT ||
        referenceStart < NO_VALUE_COUNT ||
        declarationStart >= referenceStart
      )
        return null;
      checkedSymbols.add(symbol.id);
      value = stripParenExpression(initializer);
      continue;
    }
    if (!isNodeOfType(value, "ObjectExpression")) return null;
    const names = new Set<string>();
    for (const property of value.properties) {
      if (
        !isNodeOfType(property, "Property") ||
        property.kind !== "init" ||
        property.method ||
        property.computed
      )
        return null;
      const name = getResolvedStaticPropertyName(property, scopes);
      if (name === null || names.has(name)) return null;
      names.add(name);
    }
    const propertyName = pendingProperties.shift();
    if (propertyName === undefined) return `reference:${serialized}`;
    const propertyValue = getStaticObjectPropertyValue(value, propertyName);
    if (!propertyValue) return null;
    if (!pendingProperties.length) return `reference:${serialized}`;
    value = stripParenExpression(propertyValue);
  }
};
