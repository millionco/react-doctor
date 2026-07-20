import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { hasCapability } from "../../utils/get-react-doctor-setting.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { MOBX_RULE_GATES } from "../../utils/mobx-rule-gates.js";
import { resolveImportedApiReference } from "../../utils/resolve-imported-api-reference.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const OBSERVER_MODULES = new Set(["mobx-react", "mobx-react-lite"]);
const MESSAGE =
  "`observer` cannot wrap an already memoized or observed component. Apply `observer` first, then place `memo` outside only if needed.";

const resolveObserverModule = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): "mobx-react" | "mobx-react-lite" | null => {
  const reference = resolveImportedApiReference(callExpression.callee, scopes);
  if (reference?.importedName !== "observer" || !OBSERVER_MODULES.has(reference.source))
    return null;
  return reference.source === "mobx-react" || reference.source === "mobx-react-lite"
    ? reference.source
    : null;
};

const hasInvalidInnerWrapper = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  const unwrappedExpression = stripParenExpression(expression);
  if (isNodeOfType(unwrappedExpression, "Identifier")) {
    const symbol = scopes.symbolFor(unwrappedExpression);
    if (symbol?.kind !== "const" || !symbol.initializer || visitedSymbolIds.has(symbol.id)) {
      return false;
    }
    visitedSymbolIds.add(symbol.id);
    return hasInvalidInnerWrapper(symbol.initializer, scopes, visitedSymbolIds);
  }
  if (!isNodeOfType(unwrappedExpression, "CallExpression")) return false;
  const reference = resolveImportedApiReference(unwrappedExpression.callee, scopes);
  if (reference?.importedName === "observer" && OBSERVER_MODULES.has(reference.source)) {
    return true;
  }
  return reference?.source === "react" && reference.importedName === "memo";
};

export const mobxNoObserverWrappedMemo = defineRule({
  id: "mobx-no-observer-wrapped-memo",
  title: "Invalid MobX observer wrapper order",
  severity: "error",
  category: "Bugs",
  requires: MOBX_RULE_GATES["mobx-no-observer-wrapped-memo"].requires,
  recommendation:
    "Pass the component directly to `observer`, or apply React `memo` outside the resulting observer component.",
  create: (context: RuleContext) => ({
    CallExpression(callExpression: EsTreeNodeOfType<"CallExpression">) {
      const observerModule = resolveObserverModule(callExpression, context.scopes);
      if (!observerModule) return;
      const capability =
        observerModule === "mobx-react"
          ? "mobx-react-observer-memo-guard"
          : "mobx-react-lite-observer-memo-guard";
      if (!hasCapability(context.settings, capability)) return;
      const componentArgument = callExpression.arguments[0];
      if (!componentArgument) return;
      if (!hasInvalidInnerWrapper(componentArgument, context.scopes)) return;
      context.report({ node: callExpression, message: MESSAGE });
    },
  }),
});
