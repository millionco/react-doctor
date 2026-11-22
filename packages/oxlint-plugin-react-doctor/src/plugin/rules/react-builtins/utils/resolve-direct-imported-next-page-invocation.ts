import { BUILTIN_HOOK_NAMES } from "../../../constants/react.js";
import { analyzeScopes } from "../../../semantic/scope-analysis.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import { resolveCrossFileValueExportWithFilePath } from "../../../utils/resolve-cross-file-function-export.js";
import {
  findNearestPackageDirectory,
  readPackageManifest,
} from "../../../utils/read-nearest-package-manifest.js";
import { attachParentReferences } from "../../../utils/attach-parent-references.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { getStockNextIndexPageComponent } from "./is-stock-next-index-page.js";

export const resolveDirectImportedNextPageInvocation = (
  call: EsTreeNodeOfType<"CallExpression">,
  filename: string | undefined,
  scopes: ScopeAnalysis,
): string | null => {
  if (!filename || call.optional) return null;
  const callee = stripParenExpression(call.callee);
  const binding = isNodeOfType(callee, "Identifier")
    ? callee
    : isNodeOfType(callee, "MemberExpression") &&
        !callee.optional &&
        isNodeOfType(callee.object, "Identifier")
      ? callee.object
      : null;
  if (!binding) return null;
  const symbol = scopes.symbolFor(binding);
  if (!symbol || symbol.kind !== "import") return null;
  const imported = resolveImportedApiReference(callee, scopes);
  if (!imported || imported.importedName !== "default" || !imported.source.startsWith(".")) {
    return null;
  }
  // Reject default-object.default; only a namespace's default member is a page.
  if (
    isNodeOfType(callee, "MemberExpression") &&
    !isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier")
  )
    return null;
  const owner = findNearestPackageDirectory(filename, { cache: false });
  if (
    !owner ||
    typeof readPackageManifest(owner, { cache: false })?.dependencies?.next !== "string"
  ) {
    return null;
  }
  const resolved = resolveCrossFileValueExportWithFilePath(filename, imported.source, "default");
  if (!resolved || findNearestPackageDirectory(resolved.filePath, { cache: false }) !== owner) {
    return null;
  }
  attachParentReferences(resolved.programNode);
  const targetScopes = analyzeScopes(resolved.programNode);
  const component = getStockNextIndexPageComponent(
    resolved.exportedNode,
    targetScopes,
    resolved.filePath,
  );
  if (!component || !isFunctionLike(component)) return null;
  let hookName: string | null = null;
  walkAst(component.body, (node) => {
    if (hookName !== null || isFunctionLike(node)) return false;
    if (!isNodeOfType(node, "CallExpression")) return;
    const api = resolveImportedApiReference(node.callee, targetScopes);
    if (api?.source === "react" && api.importedName && BUILTIN_HOOK_NAMES.has(api.importedName)) {
      hookName = api.importedName;
    }
  });
  return hookName;
};
