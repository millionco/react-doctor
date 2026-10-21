import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getDestructuredBindingPropertyName } from "./get-destructured-binding-property-name.js";
import { hasReadonlySymbolReferences } from "./has-readonly-symbol-references.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const nitroRuntimeAppGetterProofs = new WeakMap<SymbolDescriptor, boolean>();

const nitroBindingPatternProofs = new WeakMap<EsTreeNodeOfType<"ObjectPattern">, boolean>();

const computeStaticNitroBindingPattern = (pattern: EsTreeNodeOfType<"ObjectPattern">): boolean => {
  const propertyNames = new Set<string>();
  for (const property of pattern.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.kind !== "init" ||
      property.computed ||
      property.method ||
      !isNodeOfType(property.key, "Identifier") ||
      !isNodeOfType(property.value, "Identifier") ||
      propertyNames.has(property.key.name)
    )
      return false;
    propertyNames.add(property.key.name);
  }
  return true;
};

const hasStaticNitroBindingPattern = (pattern: EsTreeNodeOfType<"ObjectPattern">): boolean => {
  const cached = nitroBindingPatternProofs.get(pattern);
  if (cached !== undefined) return cached;
  const isStaticPattern = computeStaticNitroBindingPattern(pattern);
  nitroBindingPatternProofs.set(pattern, isStaticPattern);
  return isStaticPattern;
};

const computeNitroRuntimeAppGetter = (symbol: SymbolDescriptor): boolean => {
  const declaration = symbol.declarationNode;
  if (
    symbol.kind !== "const" ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "ObjectPattern") ||
    !declaration.init
  )
    return false;
  if (getDestructuredBindingPropertyName(symbol.bindingIdentifier) !== "useNitroApp") return false;
  if (!hasStaticNitroBindingPattern(declaration.id)) return false;
  const initializer = stripParenExpression(declaration.init);
  if (!isNodeOfType(initializer, "AwaitExpression")) return false;
  const imported = stripParenExpression(initializer.argument);
  return (
    isNodeOfType(imported, "ImportExpression") &&
    imported.options == null &&
    imported.attributes == null &&
    (!("phase" in imported) || imported.phase == null) &&
    isNodeOfType(imported.source, "Literal") &&
    imported.source.value === "nitropack/runtime" &&
    hasReadonlySymbolReferences(symbol)
  );
};

export const isNitroRuntimeAppGetter = (symbol: SymbolDescriptor): boolean => {
  const cached = nitroRuntimeAppGetterProofs.get(symbol);
  if (cached !== undefined) return cached;
  const isGetter = computeNitroRuntimeAppGetter(symbol);
  nitroRuntimeAppGetterProofs.set(symbol, isGetter);
  return isGetter;
};
