import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

const R3F_RENDERER_STATE_PROPERTY_NAMES: ReadonlySet<string> = new Set(["gl", "renderer"]);

export const isR3fFrameRendererExpression = (
  expression: EsTreeNode,
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isFunctionLike(callback)) return false;
  const stateParameter = callback.params[0];
  if (!stateParameter) return false;
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(stateParameter, "Identifier")) {
    return Boolean(
      isNodeOfType(candidate, "MemberExpression") &&
      R3F_RENDERER_STATE_PROPERTY_NAMES.has(getStaticPropertyName(candidate) ?? "") &&
      isNodeOfType(stripParenExpression(candidate.object), "Identifier") &&
      scopes.symbolFor(stripParenExpression(candidate.object))?.id ===
        scopes.symbolFor(stateParameter)?.id,
    );
  }
  if (!isNodeOfType(stateParameter, "ObjectPattern") || !isNodeOfType(candidate, "Identifier")) {
    return false;
  }
  const candidateSymbolId = scopes.symbolFor(candidate)?.id;
  return stateParameter.properties.some(
    (property) =>
      isNodeOfType(property, "Property") &&
      R3F_RENDERER_STATE_PROPERTY_NAMES.has(
        getStaticPropertyKeyName(property, { allowComputedString: true }) ?? "",
      ) &&
      isNodeOfType(property.value, "Identifier") &&
      scopes.symbolFor(property.value)?.id === candidateSymbolId,
  );
};
