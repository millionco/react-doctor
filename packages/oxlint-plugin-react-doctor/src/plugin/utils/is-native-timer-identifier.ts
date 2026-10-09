import { TIMER_CALLEE_NAMES_REQUIRING_CLEANUP } from "../constants/dom.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";

export const isNativeTimerIdentifier = (
  identifier: EsTreeNodeOfType<"Identifier">,
  scopes: ScopeAnalysis,
): boolean => {
  if (!TIMER_CALLEE_NAMES_REQUIRING_CLEANUP.has(identifier.name)) return false;
  if (scopes.isGlobalReference(identifier)) return true;
  const importedApi = resolveImportedApiReference(identifier, scopes);
  return Boolean(
    importedApi &&
    (importedApi.source === "timers" || importedApi.source === "node:timers") &&
    importedApi.importedName === identifier.name,
  );
};
