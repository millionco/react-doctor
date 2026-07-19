import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getNodeEndIndex } from "../../utils/get-node-end-index.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isImmediatelyInvokedFunction } from "../../utils/is-immediately-invoked-function.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { getNodeStartIndex } from "../../utils/get-node-start-index.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
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

const isSynchronousIife = (functionNode: EsTreeNode): boolean =>
  isFunctionLike(functionNode) &&
  !functionNode.async &&
  !functionNode.generator &&
  isImmediatelyInvokedFunction(functionNode);

const isGetParameterCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  getParameterSymbol: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  const callee = stripParenExpression(callExpression.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  return resolveConstIdentifierAlias(callee, context.scopes)?.id === getParameterSymbol.id;
};

const findFirstSuspensionBoundaryIndex = (
  creatorFunction: ZustandStoreCreator["creatorFunction"],
): number | null => {
  if (!creatorFunction.async) return null;
  let firstSuspensionBoundaryIndex: number | null = null;
  walkAst(creatorFunction.body, (node: EsTreeNode) => {
    if (isFunctionLike(node)) return false;
    const suspensionBoundaryIndex = isNodeOfType(node, "AwaitExpression")
      ? getNodeEndIndex(node)
      : isNodeOfType(node, "ForOfStatement") && node.await
        ? getNodeEndIndex(node.right)
        : -1;
    if (
      suspensionBoundaryIndex >= 0 &&
      (firstSuspensionBoundaryIndex === null ||
        suspensionBoundaryIndex < firstSuspensionBoundaryIndex)
    ) {
      firstSuspensionBoundaryIndex = suspensionBoundaryIndex;
    }
  });
  return firstSuspensionBoundaryIndex;
};

const reportEagerGetCalls = (
  creatorFunction: ZustandStoreCreator["creatorFunction"],
  getParameterSymbol: SymbolDescriptor,
  context: RuleContext,
): void => {
  const firstSuspensionBoundaryIndex = findFirstSuspensionBoundaryIndex(creatorFunction);
  walkAst(creatorFunction, (node: EsTreeNode) => {
    if (node !== creatorFunction && isFunctionLike(node) && !isSynchronousIife(node)) return false;
    if (!isNodeOfType(node, "CallExpression")) return;
    if (
      firstSuspensionBoundaryIndex !== null &&
      getNodeStartIndex(node) > firstSuspensionBoundaryIndex
    ) {
      return;
    }
    if (!isGetParameterCall(node, getParameterSymbol, context)) return;
    context.report({
      node,
      message:
        "`get()` runs before Zustand installs the initial state, so it returns `undefined` here.",
    });
  });
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
