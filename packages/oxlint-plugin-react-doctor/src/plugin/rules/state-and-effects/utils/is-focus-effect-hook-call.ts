import { FOCUS_EFFECT_MODULE_SOURCES } from "../../../constants/react.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";

export const isFocusEffectHookCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const importedApi = resolveImportedApiReference(call.callee, scopes);
  return Boolean(
    importedApi?.importedName === "useFocusEffect" &&
    FOCUS_EFFECT_MODULE_SOURCES.has(importedApi.source),
  );
};
