import { defineRule } from "../../utils/define-rule.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { getImportBindingForName } from "../../utils/find-import-source-for-name.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactRouterRouteFunction } from "../../utils/is-react-router-route-function.js";
import { isRouteRequestExpression } from "../../utils/is-route-request-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import { walkAst } from "../../utils/walk-ast.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

const ERROR_REPORTING_EXPORT_NAMES = new Set([
  "captureError",
  "captureException",
  "logError",
  "reportError",
]);
const SERVER_ENTRY_PATTERN = /(?:^|\/)entry\.server\.[cm]?[jt]sx?$/;
const EMPTY_VISITORS: RuleVisitors = {};

const isErrorReportingCall = (
  context: RuleContext,
  callExpression: EsTreeNode,
  errorSymbol: SymbolDescriptor | null,
): boolean => {
  if (!isNodeOfType(callExpression, "CallExpression") || errorSymbol === null) return false;
  if (
    !(callExpression.arguments ?? []).some(
      (argument) => context.scopes.symbolFor(argument) === errorSymbol,
    )
  ) {
    return false;
  }
  const callee = callExpression.callee;
  if (isNodeOfType(callee, "Identifier")) {
    if (context.scopes.symbolFor(callee)?.kind !== "import") return false;
    const binding = getImportBindingForName(callee, callee.name);
    return Boolean(binding?.exportedName && ERROR_REPORTING_EXPORT_NAMES.has(binding.exportedName));
  }
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const methodName = getStaticPropertyKeyName(callee, { allowComputedString: true });
  if (methodName === null) return false;
  if (
    methodName === "error" &&
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "console" &&
    context.scopes.isGlobalReference(callee.object)
  ) {
    return true;
  }
  return ERROR_REPORTING_EXPORT_NAMES.has(methodName);
};

export const reactRouterGuardAbortedHandleError = wrapReactRouterRule(
  defineRule({
    id: "react-router-guard-aborted-handle-error",
    title: "Aborted requests are reported as errors",
    tags: ["test-noise"],
    requires: ["react-router:7", "react-router-framework"],
    severity: "warn",
    recommendation:
      "Return early when request.signal.aborted before reporting the error from handleError.",
    create: (context: RuleContext) => {
      if (context.filename && !SERVER_ENTRY_PATTERN.test(context.filename)) return EMPTY_VISITORS;
      const inspectFunction = (functionNode: EsTreeNode): void => {
        if (
          !isFunctionLike(functionNode) ||
          !isReactRouterRouteFunction(context, functionNode, "handleError")
        ) {
          return;
        }
        const errorParameter = functionNode.params?.[0];
        if (!isNodeOfType(errorParameter, "Identifier")) return;
        const errorSymbol = context.scopes.symbolFor(errorParameter);
        if (errorSymbol === null) return;
        let hasAbortCheck = false;
        let reportingCall: EsTreeNode | null = null;
        walkAst(functionNode, (descendant) => {
          if (isNodeOfType(descendant, "MemberExpression")) {
            const propertyName = getStaticPropertyKeyName(descendant, {
              allowComputedString: true,
            });
            if (
              propertyName === "aborted" &&
              isNodeOfType(descendant.object, "MemberExpression") &&
              getStaticPropertyKeyName(descendant.object, { allowComputedString: true }) ===
                "signal" &&
              isRouteRequestExpression(context, descendant.object.object, functionNode)
            ) {
              hasAbortCheck = true;
            }
          }
          if (isErrorReportingCall(context, descendant, errorSymbol)) {
            reportingCall = descendant;
          }
        });
        if (hasAbortCheck || reportingCall === null) return;
        context.report({
          node: reportingCall,
          message:
            "handleError reports expected abort errors without checking request.signal.aborted.",
        });
      };
      return {
        ArrowFunctionExpression: inspectFunction,
        FunctionDeclaration: inspectFunction,
        FunctionExpression: inspectFunction,
      };
    },
  }),
);
