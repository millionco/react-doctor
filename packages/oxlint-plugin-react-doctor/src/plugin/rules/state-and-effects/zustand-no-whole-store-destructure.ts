import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { componentOrHookDisplayNameForFunction } from "../../utils/component-or-hook-display-name.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { functionHasReactComponentEvidence } from "../../utils/function-has-react-component-evidence.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import {
  resolveZustandApiBinding,
  resolveZustandStoreFactoryCall,
  type ZustandStoreFactoryCall,
} from "../../utils/resolve-zustand-api.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const BOUND_STORE_FACTORY_APIS: ReadonlySet<ZustandStoreFactoryCall["factoryApiName"]> = new Set([
  "create",
  "createWithEqualityFn",
]);

const VANILLA_STORE_FACTORY_APIS: ReadonlySet<ZustandStoreFactoryCall["factoryApiName"]> = new Set([
  "createStore",
]);

const isStoreFactoryValue = (
  rawValue: EsTreeNode,
  factoryApiNames: ReadonlySet<ZustandStoreFactoryCall["factoryApiName"]>,
  scopes: ScopeAnalysis,
): boolean => {
  const value = stripParenExpression(rawValue);
  if (!isNodeOfType(value, "CallExpression")) return false;
  const factoryCall = resolveZustandStoreFactoryCall(value, scopes);
  return Boolean(factoryCall && factoryApiNames.has(factoryCall.factoryApiName));
};

const isStoreValue = (
  rawValue: EsTreeNode,
  factoryApiNames: ReadonlySet<ZustandStoreFactoryCall["factoryApiName"]>,
  scopes: ScopeAnalysis,
): boolean => {
  const value = stripParenExpression(rawValue);
  if (isStoreFactoryValue(value, factoryApiNames, scopes)) return true;
  if (!isNodeOfType(value, "Identifier")) return false;
  const symbol = resolveConstIdentifierAlias(value, scopes);
  return Boolean(
    symbol?.kind === "const" &&
    symbol.initializer &&
    isStoreFactoryValue(symbol.initializer, factoryApiNames, scopes),
  );
};

const isBoundStoreCall = (
  node: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(node.callee);
  return (
    isNodeOfType(callee, "Identifier") && isStoreValue(callee, BOUND_STORE_FACTORY_APIS, scopes)
  );
};

const isVanillaStoreHookCall = (
  node: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  if (node.arguments.length !== 1) return false;
  const hook = resolveZustandApiBinding(node.callee, scopes);
  if (hook?.apiName !== "useStore" && hook?.apiName !== "useStoreWithEqualityFn") return false;
  return isStoreValue(node.arguments[0], VANILLA_STORE_FACTORY_APIS, scopes);
};

const isDirectReactRenderCall = (node: EsTreeNode, context: RuleContext): boolean => {
  const renderFunction = findRenderPhaseComponentOrHook(node, context.scopes);
  if (!renderFunction || findEnclosingFunction(node) !== renderFunction) return false;
  const displayName = componentOrHookDisplayNameForFunction(renderFunction);
  return Boolean(
    displayName &&
    (isReactHookName(displayName) ||
      functionHasReactComponentEvidence(renderFunction, context.scopes, context.cfg)),
  );
};

export const zustandNoWholeStoreDestructure = defineRule({
  id: "zustand-no-whole-store-destructure",
  title: "Whole Zustand store subscribed during render",
  severity: "warn",
  requires: ["zustand:1"],
  recommendation:
    "Pass a selector to the Zustand hook so this component rerenders only when the state it reads changes.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isDirectReactRenderCall(node, context)) return;
      const isWholeBoundStoreSubscription =
        node.arguments.length === 0 && isBoundStoreCall(node, context.scopes);
      if (!isWholeBoundStoreSubscription && !isVanillaStoreHookCall(node, context.scopes)) return;
      context.report({
        node,
        message:
          "This hook subscribes to the whole Zustand store, so every store update rerenders this component. Pass a selector for the state it reads.",
      });
    },
  }),
});
