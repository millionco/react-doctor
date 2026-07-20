import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { canExecuteBeforeAsyncSuspension } from "../../utils/can-execute-before-async-suspension.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import {
  resolveZustandStoreCreator,
  type ZustandStoreCreator,
} from "../../utils/resolve-zustand-api.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const findGetParameterIdentifier = (parameter: EsTreeNode | undefined): EsTreeNode | null => {
  if (!parameter) return null;
  if (isNodeOfType(parameter, "Identifier")) return parameter;
  if (isNodeOfType(parameter, "AssignmentPattern") && isNodeOfType(parameter.left, "Identifier")) {
    return parameter.left;
  }
  return null;
};

const isGetParameterCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  getParameterSymbol: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  const callee = stripParenExpression(callExpression.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  return resolveConstIdentifierAlias(callee, context.scopes)?.id === getParameterSymbol.id;
};

const reportEagerGetCalls = (
  creatorFunction: ZustandStoreCreator["creatorFunction"],
  getParameterSymbol: SymbolDescriptor,
  context: RuleContext,
): void => {
  const visitedFunctions = new Set<EsTreeNode>();
  const reportFunctionReads = (functionNode: EsTreeNode): void => {
    if (
      !isFunctionLike(functionNode) ||
      functionNode.generator ||
      visitedFunctions.has(functionNode)
    )
      return;
    visitedFunctions.add(functionNode);
    walkAst(functionNode, (node: EsTreeNode) => {
      if (node !== functionNode && isFunctionLike(node)) return false;
      if (!isNodeOfType(node, "CallExpression")) return;
      if (isGetParameterCall(node, getParameterSymbol, context)) {
        if (!canExecuteBeforeAsyncSuspension(node, functionNode, context)) return;
        context.report({
          node,
          message:
            "`get()` runs before Zustand installs the initial state, so it returns `undefined` here.",
        });
        return;
      }
      if (!canExecuteBeforeAsyncSuspension(node, functionNode, context)) return;
      const calledFunction = resolveExactLocalFunction(node.callee, context.scopes);
      if (!calledFunction || calledFunction === functionNode) return;
      reportFunctionReads(calledFunction);
    });
  };
  reportFunctionReads(creatorFunction);
};

export const zustandNoGetDuringInitialization = defineRule({
  id: "zustand-no-get-during-initialization",
  title: "Zustand get() called during store initialization",
  severity: "error",
  category: "Correctness",
  recommendation:
    "Move the read into a deferred store action or derive the initial value without calling `get()`.",
  requires: ["zustand", "zustand:1"],
  create: (context: RuleContext) => {
    const creatorFunctions = new Set<ZustandStoreCreator["creatorFunction"]>();
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const creator = resolveZustandStoreCreator(node, context.scopes);
        if (creator) creatorFunctions.add(creator.creatorFunction);
      },
      "Program:exit"() {
        for (const creatorFunction of creatorFunctions) {
          if (creatorFunction.generator) continue;
          const parameterIdentifier = findGetParameterIdentifier(creatorFunction.params[1]);
          const getParameterSymbol = parameterIdentifier
            ? context.scopes.symbolFor(parameterIdentifier)
            : null;
          if (!getParameterSymbol) continue;
          reportEagerGetCalls(creatorFunction, getParameterSymbol, context);
        }
      },
    };
  },
});
