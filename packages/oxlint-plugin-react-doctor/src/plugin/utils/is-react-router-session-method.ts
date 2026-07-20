import { REACT_ROUTER_SESSION_STORAGE_FACTORY_EXPORT_NAMES } from "../constants/react-router.js";
import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import { getImportedNameFromReactRouter } from "./get-imported-name-from-react-router.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import type { RuleContext } from "./rule-context.js";

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
  return factoryName !== null && REACT_ROUTER_SESSION_STORAGE_FACTORY_EXPORT_NAMES.has(factoryName);
};
