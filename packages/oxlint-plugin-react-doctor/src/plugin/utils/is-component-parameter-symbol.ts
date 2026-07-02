import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import { isComponentFunction } from "./is-component-function.js";

// True when a symbol is a parameter of a React COMPONENT — the props object,
// or a value destructured from it in the parameter list. A parameter of an
// ordinary helper (`function runRow(renderRow) {}`), or a local variable that
// merely shares the name `props` / `children`, is NOT the component's props,
// so callers must not treat its members as parent-owned props.
export const isComponentParameterSymbol = (symbol: SymbolDescriptor | null): boolean => {
  if (!symbol || symbol.kind !== "parameter") return false;
  return isComponentFunction(symbol.scope.node);
};
