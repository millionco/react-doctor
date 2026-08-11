import type { SymbolSearchResult } from "@rayhanadev/truffler";

const REACT_COMPONENT_NAME_PATTERN = /^[A-Z]/;
const REACT_HOOK_NAME_PATTERN = /^use(?:$|[A-Z0-9])/;
const REACT_COMPONENT_WRAPPER_PATTERN =
  /=\s*(?:(?:React\.)?(?:forwardRef|lazy|memo)|observer|styled)(?:\s*[.(<])/;

const isCallableBindingKind = (kind: SymbolSearchResult["kind"]): boolean =>
  kind === "constant" || kind === "function" || kind === "variable";

export const resolveFindSymbolKind = (result: SymbolSearchResult): string => {
  if (isCallableBindingKind(result.kind) && REACT_HOOK_NAME_PATTERN.test(result.name))
    return "hook";
  if (
    (result.kind === "class" || result.kind === "function") &&
    REACT_COMPONENT_NAME_PATTERN.test(result.name)
  ) {
    return "component";
  }
  if (
    (result.kind === "constant" || result.kind === "variable") &&
    REACT_COMPONENT_NAME_PATTERN.test(result.name) &&
    REACT_COMPONENT_WRAPPER_PATTERN.test(result.signature ?? result.snippet ?? "")
  ) {
    return "component";
  }
  return result.kind;
};
