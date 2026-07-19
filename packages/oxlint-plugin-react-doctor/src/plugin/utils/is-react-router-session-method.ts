import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import { getImportedNameFromReactRouter } from "./get-imported-name-from-react-router.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import type { RuleContext } from "./rule-context.js";

const SESSION_STORAGE_FACTORY_EXPORT_NAMES = new Set([
  "createCookieSessionStorage",
  "createMemorySessionStorage",
  "createSessionStorage",
]);

export const isReactRouterSessionMethod = (
  context: RuleContext,
  symbol: SymbolDescriptor | null,
  expectedMethodName: string,
): boolean => {
  if (symbol === null) return false;
  const property = symbol.bindingIdentifier.parent;
  if (!isNodeOfType(property, "Property")) return false;
  if (getStaticPropertyKeyName(property, { allowComputedString: true }) !== expectedMethodName) {
    return false;
  }
  if (!isNodeOfType(symbol.initializer, "CallExpression")) return false;
  if (!isNodeOfType(symbol.initializer.callee, "Identifier")) return false;
  const factoryName = getImportedNameFromReactRouter(
    context,
    symbol.initializer.callee,
    symbol.initializer.callee.name,
  );
  return factoryName !== null && SESSION_STORAGE_FACTORY_EXPORT_NAMES.has(factoryName);
};
