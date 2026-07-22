import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";

const REANIMATED_MODULE_SOURCE = "react-native-reanimated";

export const resolveReanimatedApiName = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
  supportedApiNames: ReadonlySet<string>,
): string | null => {
  const reference = resolveImportedApiReference(callExpression.callee, scopes);
  if (
    reference?.source !== REANIMATED_MODULE_SOURCE ||
    reference.importedName === null ||
    !supportedApiNames.has(reference.importedName)
  ) {
    return null;
  }
  return reference.importedName;
};
