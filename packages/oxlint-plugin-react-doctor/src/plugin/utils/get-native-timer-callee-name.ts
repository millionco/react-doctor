import { TIMER_CALLEE_NAMES_REQUIRING_CLEANUP } from "../constants/dom.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNativeTimerIdentifier } from "./is-native-timer-identifier.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "./is-proven-unmodified-global-namespace-reference.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const getNativeTimerCalleeName = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  calleeNames: ReadonlySet<string> = TIMER_CALLEE_NAMES_REQUIRING_CLEANUP,
): string | null => {
  const callee = stripParenExpression(expression);
  if (isNodeOfType(callee, "Identifier")) {
    return calleeNames.has(callee.name) &&
      (scopes.isGlobalReference(callee) || isNativeTimerIdentifier(callee, scopes))
      ? callee.name
      : null;
  }
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  const methodName = getStaticPropertyName(callee);
  return methodName !== null &&
    calleeNames.has(methodName) &&
    isProvenUnmodifiedGlobalNamespaceReference(callee.object, null, scopes, methodName)
    ? methodName
    : null;
};
