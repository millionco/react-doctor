import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isGlobalPerformanceNowCall } from "./is-global-performance-now-call.js";
import { isProvenNonThrowingNumberExpression } from "./is-proven-non-throwing-number-expression.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const NON_THROWING_CONSOLE_METHOD_NAMES = new Set([
  "debug",
  "error",
  "info",
  "log",
  "trace",
  "warn",
]);
export const isProvenNonThrowingBuiltInCall = (
  callNode: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  if (isGlobalPerformanceNowCall(callNode, scopes)) return true;
  const callee = stripParenExpression(callNode.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const receiver = stripParenExpression(callee.object);
  if (!isNodeOfType(receiver, "Identifier") || !scopes.isGlobalReference(receiver)) return false;
  const methodName = getStaticPropertyName(callee);
  if (receiver.name === "console") {
    return NON_THROWING_CONSOLE_METHOD_NAMES.has(methodName ?? "");
  }
  const firstArgument = callNode.arguments[0];
  return Boolean(
    receiver.name === "Math" &&
    methodName === "round" &&
    callNode.arguments.length === 1 &&
    firstArgument &&
    isProvenNonThrowingNumberExpression(firstArgument, scopes),
  );
};
