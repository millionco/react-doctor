import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { hasSymbolWriteBefore } from "../../utils/has-symbol-write-before.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeConditionallyExecuted } from "../../utils/is-node-conditionally-executed.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { isR3fApiCall } from "./utils/is-r3f-api-call.js";

const expressionIsProvablyTruthy = (
  expression: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (
    isNodeOfType(candidate, "ArrayExpression") ||
    isNodeOfType(candidate, "ArrowFunctionExpression") ||
    isNodeOfType(candidate, "ClassExpression") ||
    isNodeOfType(candidate, "FunctionExpression") ||
    isNodeOfType(candidate, "NewExpression") ||
    isNodeOfType(candidate, "ObjectExpression")
  ) {
    return true;
  }
  if (isNodeOfType(candidate, "TemplateLiteral")) {
    return candidate.quasis.some((quasi) => quasi.value.raw.length > 0);
  }
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(candidate);
  if (
    symbol?.kind !== "const" ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id) ||
    symbol.references.some((reference) => reference.flag !== "read")
  ) {
    return false;
  }
  visitedSymbolIds.add(symbol.id);
  return expressionIsProvablyTruthy(symbol.initializer, context, visitedSymbolIds);
};

const isProtectedByModuleCache = (
  node: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  let currentChild: EsTreeNode = node;
  let currentAncestor = node.parent;
  while (currentAncestor) {
    if (
      isNodeOfType(currentAncestor, "IfStatement") &&
      (currentAncestor.consequent === currentChild || currentAncestor.alternate === currentChild)
    ) {
      const test = stripParenExpression(currentAncestor.test);
      let guardedValue: EsTreeNode | null = null;
      if (currentAncestor.alternate === currentChild) {
        guardedValue = test;
      } else if (isNodeOfType(test, "UnaryExpression") && test.operator === "!") {
        guardedValue = stripParenExpression(test.argument);
      }
      if (!guardedValue || !isNodeOfType(guardedValue, "Identifier")) return false;
      const guardedSymbol = context.scopes.symbolFor(guardedValue);
      const initializer = guardedSymbol?.initializer
        ? stripParenExpression(guardedSymbol.initializer)
        : null;
      if (
        !guardedSymbol ||
        !initializer ||
        !isNodeOfType(initializer, "CallExpression") ||
        !isNodeOfType(initializer.callee, "MemberExpression") ||
        getStaticPropertyName(initializer.callee) !== "get"
      ) {
        return false;
      }
      const cacheExpression = stripParenExpression(initializer.callee.object);
      const cacheKey = initializer.arguments[0];
      if (
        !isNodeOfType(cacheExpression, "Identifier") ||
        !cacheKey ||
        isNodeOfType(cacheKey, "SpreadElement")
      ) {
        return false;
      }
      const cacheSymbol = context.scopes.symbolFor(cacheExpression);
      const cacheInitializer = cacheSymbol?.initializer
        ? stripParenExpression(cacheSymbol.initializer)
        : null;
      if (
        cacheSymbol?.scope.kind !== "module" ||
        !cacheInitializer ||
        !isNodeOfType(cacheInitializer, "NewExpression") ||
        !isNodeOfType(cacheInitializer.callee, "Identifier") ||
        cacheInitializer.callee.name !== "WeakMap" ||
        !context.scopes.isGlobalReference(cacheInitializer.callee)
      ) {
        return false;
      }
      const cacheKeyCandidate = stripParenExpression(cacheKey);
      const cacheKeySymbolId = isNodeOfType(cacheKeyCandidate, "Identifier")
        ? context.scopes.symbolFor(cacheKeyCandidate)?.id
        : null;
      if (cacheKeySymbolId === null || cacheKeySymbolId === undefined) return false;
      let didPopulateCache = false;
      const guardedBranch = currentChild;
      walkAst(guardedBranch, (candidate) => {
        if (didPopulateCache) return false;
        if (candidate !== guardedBranch && isFunctionLike(candidate)) return false;
        if (
          !isNodeOfType(candidate, "CallExpression") ||
          candidate.range[0] <= node.range[1] ||
          isNodeConditionallyExecuted(candidate, guardedBranch) ||
          !isNodeOfType(candidate.callee, "MemberExpression") ||
          getStaticPropertyName(candidate.callee) !== "set"
        ) {
          return;
        }
        const setCacheExpression = stripParenExpression(candidate.callee.object);
        const setCacheKey = candidate.arguments[0];
        const setCacheValue = candidate.arguments[1];
        if (
          !isNodeOfType(setCacheExpression, "Identifier") ||
          context.scopes.symbolFor(setCacheExpression)?.id !== cacheSymbol.id ||
          !setCacheKey ||
          isNodeOfType(setCacheKey, "SpreadElement") ||
          !setCacheValue ||
          isNodeOfType(setCacheValue, "SpreadElement")
        ) {
          return;
        }
        const setCacheKeyCandidate = stripParenExpression(setCacheKey);
        if (
          !isNodeOfType(setCacheKeyCandidate, "Identifier") ||
          context.scopes.symbolFor(setCacheKeyCandidate)?.id !== cacheKeySymbolId
        ) {
          return;
        }
        let didAssignGuardedValue = false;
        walkAst(setCacheValue, (valueCandidate) => {
          if (
            isNodeOfType(valueCandidate, "AssignmentExpression") &&
            valueCandidate.operator === "=" &&
            isNodeOfType(valueCandidate.left, "Identifier") &&
            context.scopes.symbolFor(valueCandidate.left)?.id === guardedSymbol.id &&
            expressionIsProvablyTruthy(valueCandidate.right, context)
          ) {
            didAssignGuardedValue = true;
            return false;
          }
        });
        didPopulateCache = didAssignGuardedValue;
      });
      return didPopulateCache;
    }
    currentChild = currentAncestor;
    currentAncestor = currentAncestor.parent;
  }
  return false;
};

export const r3fNoExtendInRender = defineRule({
  id: "r3f-no-extend-in-render",
  title: "R3F catalogue extension during render",
  category: "Correctness",
  severity: "warn",
  recommendation:
    "Call extend at module scope so React renders and Strict Mode replays do not repeatedly mutate R3F's global catalogue",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const callee = stripParenExpression(node.callee);
      const calleeSymbol = isNodeOfType(callee, "Identifier")
        ? context.scopes.symbolFor(callee)
        : null;
      if (
        !isR3fApiCall(node, "extend", context.scopes) ||
        (calleeSymbol && hasSymbolWriteBefore(calleeSymbol, node, context.scopes)) ||
        isProtectedByModuleCache(node, context) ||
        !findRenderPhaseComponentOrHook(node, context.scopes)
      ) {
        return;
      }
      context.report({
        node,
        message:
          "This extend call runs during React render and mutates R3F's global catalogue again on every execution. Move the registration to module scope",
      });
    },
  }),
});
