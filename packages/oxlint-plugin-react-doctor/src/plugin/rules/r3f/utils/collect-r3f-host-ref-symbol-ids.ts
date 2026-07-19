import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveConstIdentifierAlias } from "../../../utils/resolve-const-identifier-alias.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { isR3fHostIntrinsic } from "./is-r3f-host-intrinsic.js";

export const collectR3fHostRefSymbolIds = (
  program: EsTreeNodeOfType<"Program">,
  scopes: ScopeAnalysis,
): ReadonlySet<number> => {
  const refSymbolIds = new Set<number>();
  walkAst(program, (candidate) => {
    if (!isNodeOfType(candidate, "JSXOpeningElement") || !isR3fHostIntrinsic(candidate)) return;
    const refAttribute = getAuthoritativeJsxAttribute(candidate.attributes, "ref");
    if (
      !refAttribute?.value ||
      !isNodeOfType(refAttribute.value, "JSXExpressionContainer") ||
      !isNodeOfType(refAttribute.value.expression, "Identifier")
    ) {
      return;
    }
    const refSymbol = resolveConstIdentifierAlias(refAttribute.value.expression, scopes);
    if (refSymbol) refSymbolIds.add(refSymbol.id);
  });
  return refSymbolIds;
};
