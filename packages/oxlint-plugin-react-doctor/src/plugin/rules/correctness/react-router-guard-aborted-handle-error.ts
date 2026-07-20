import { defineRule } from "../../utils/define-rule.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { getImportBindingForName } from "../../utils/find-import-source-for-name.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactRouterRouteFunction } from "../../utils/is-react-router-route-function.js";
import { isRouteRequestExpression } from "../../utils/is-route-request-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import { statementAlwaysExits } from "../../utils/statement-always-exits.js";
import { walkAst } from "../../utils/walk-ast.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

const ERROR_REPORTING_EXPORT_NAMES = new Set([
  "captureError",
  "captureException",
  "logError",
  "reportError",
]);
const ERROR_REPORTING_MODULE_PATTERN = /^(?:@sentry\/|sentry$)/;
const SERVER_ENTRY_PATTERN = /(?:^|\/)entry\.server\.[cm]?[jt]sx?$/;
const EMPTY_VISITORS: RuleVisitors = {};

const isAbortCheck = (
  context: RuleContext,
  expression: EsTreeNode,
  functionNode: EsTreeNode,
): boolean =>
  isNodeOfType(expression, "MemberExpression") &&
  getStaticPropertyKeyName(expression, { allowComputedString: true }) === "aborted" &&
  isNodeOfType(expression.object, "MemberExpression") &&
  getStaticPropertyKeyName(expression.object, { allowComputedString: true }) === "signal" &&
  isRouteRequestExpression(context, expression.object.object, functionNode);

const isNegatedAbortCheck = (
  context: RuleContext,
  expression: EsTreeNode,
  functionNode: EsTreeNode,
): boolean =>
  isNodeOfType(expression, "UnaryExpression") &&
  expression.operator === "!" &&
  isAbortCheck(context, expression.argument, functionNode);

const isReportingCallGuarded = (
  context: RuleContext,
  reportingCall: EsTreeNode,
  functionNode: EsTreeNode,
): boolean => {
  let ancestor: EsTreeNode | null | undefined = reportingCall.parent;
  while (ancestor && ancestor !== functionNode) {
    if (isNodeOfType(ancestor, "IfStatement")) {
      if (
        isAstDescendant(reportingCall, ancestor.consequent) &&
        isNegatedAbortCheck(context, ancestor.test, functionNode)
      ) {
        return true;
      }
      if (
        ancestor.alternate &&
        isAstDescendant(reportingCall, ancestor.alternate) &&
        isAbortCheck(context, ancestor.test, functionNode)
      ) {
        return true;
      }
    }
    ancestor = ancestor.parent;
  }

  ancestor = reportingCall.parent;
  while (ancestor && ancestor !== functionNode) {
    if (isNodeOfType(ancestor, "BlockStatement")) {
      for (const statement of ancestor.body) {
        if (isAstDescendant(reportingCall, statement)) break;
        if (
          isNodeOfType(statement, "IfStatement") &&
          !statement.alternate &&
          isAbortCheck(context, statement.test, functionNode) &&
          statementAlwaysExits(statement.consequent)
        ) {
          return true;
        }
      }
    }
    ancestor = ancestor.parent;
  }
  return false;
};

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
    return Boolean(
      binding?.exportedName &&
      ERROR_REPORTING_MODULE_PATTERN.test(binding.source) &&
      ERROR_REPORTING_EXPORT_NAMES.has(binding.exportedName),
    );
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
  if (!ERROR_REPORTING_EXPORT_NAMES.has(methodName)) return false;
  if (!isNodeOfType(callee.object, "Identifier")) return false;
  if (context.scopes.symbolFor(callee.object)?.kind !== "import") return false;
  const binding = getImportBindingForName(callee.object, callee.object.name);
  return Boolean(binding?.isNamespace && ERROR_REPORTING_MODULE_PATTERN.test(binding.source));
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
        const reportingCalls: EsTreeNode[] = [];
        walkAst(functionNode, (descendant) => {
          if (descendant !== functionNode && isFunctionLike(descendant)) return false;
          if (isErrorReportingCall(context, descendant, errorSymbol)) {
            reportingCalls.push(descendant);
          }
        });
        for (const reportingCall of reportingCalls) {
          if (isReportingCallGuarded(context, reportingCall, functionNode)) continue;
          context.report({
            node: reportingCall,
            message:
              "handleError reports expected abort errors without checking request.signal.aborted.",
          });
        }
      };
      return {
        ArrowFunctionExpression: inspectFunction,
        FunctionDeclaration: inspectFunction,
        FunctionExpression: inspectFunction,
      };
    },
  }),
);
