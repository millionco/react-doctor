import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { componentOrHookDisplayNameForFunction } from "../../utils/component-or-hook-display-name.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { functionHasReactComponentEvidence } from "../../utils/function-has-react-component-evidence.js";
import { getImportDeclarationForSymbol } from "../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { isTypeOnlyImport } from "../../utils/is-type-only-import.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const BOUND_STORE_FACTORY_MODULES = new Map<string, ReadonlySet<string>>([
  ["create", new Set(["zustand"])],
  ["createWithEqualityFn", new Set(["zustand/traditional"])],
]);

const VANILLA_STORE_FACTORY_MODULES = new Map<string, ReadonlySet<string>>([
  ["createStore", new Set(["zustand", "zustand/vanilla"])],
]);

const USE_STORE_MODULES: ReadonlySet<string> = new Set(["zustand", "zustand/react"]);

const importSourceForSymbol = (symbol: SymbolDescriptor): string | null => {
  const importDeclaration = getImportDeclarationForSymbol(symbol);
  if (
    !importDeclaration ||
    isTypeOnlyImport(importDeclaration) ||
    (isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
      symbol.declarationNode.importKind === "type")
  ) {
    return null;
  }
  return typeof importDeclaration.source.value === "string" ? importDeclaration.source.value : null;
};

const isNamedImportFromModules = (
  identifier: EsTreeNode,
  exportedName: string,
  moduleSources: ReadonlySet<string>,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const symbol = scopes.symbolFor(identifier);
  const importSource = symbol ? importSourceForSymbol(symbol) : null;
  return Boolean(
    symbol &&
    importSource &&
    moduleSources.has(importSource) &&
    getImportedName(symbol.declarationNode) === exportedName,
  );
};

const isNamespaceImportFromModules = (
  identifier: EsTreeNode,
  moduleSources: ReadonlySet<string>,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const symbol = scopes.symbolFor(identifier);
  const importSource = symbol ? importSourceForSymbol(symbol) : null;
  return Boolean(
    symbol &&
    importSource &&
    moduleSources.has(importSource) &&
    isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier"),
  );
};

const isImportedApiCallee = (
  rawCallee: EsTreeNode,
  apiModules: ReadonlyMap<string, ReadonlySet<string>>,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(rawCallee);
  if (isNodeOfType(callee, "Identifier")) {
    for (const [exportedName, moduleSources] of apiModules) {
      if (isNamedImportFromModules(callee, exportedName, moduleSources, scopes)) return true;
    }
    return false;
  }
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const propertyName = getStaticPropertyName(callee);
  if (!propertyName) return false;
  const moduleSources = apiModules.get(propertyName);
  return Boolean(
    moduleSources && isNamespaceImportFromModules(callee.object, moduleSources, scopes),
  );
};

const isStoreFactoryValue = (
  rawValue: EsTreeNode,
  factoryModules: ReadonlyMap<string, ReadonlySet<string>>,
  scopes: ScopeAnalysis,
): boolean => {
  const value = stripParenExpression(rawValue);
  if (!isNodeOfType(value, "CallExpression")) return false;
  if (isImportedApiCallee(value.callee, factoryModules, scopes)) return true;
  const factoryStage = stripParenExpression(value.callee);
  return (
    isNodeOfType(factoryStage, "CallExpression") &&
    isImportedApiCallee(factoryStage.callee, factoryModules, scopes)
  );
};

const isStoreValue = (
  rawValue: EsTreeNode,
  factoryModules: ReadonlyMap<string, ReadonlySet<string>>,
  scopes: ScopeAnalysis,
): boolean => {
  const value = stripParenExpression(rawValue);
  if (isStoreFactoryValue(value, factoryModules, scopes)) return true;
  if (!isNodeOfType(value, "Identifier")) return false;
  const symbol = resolveConstIdentifierAlias(value, scopes);
  return Boolean(
    symbol?.kind === "const" &&
    symbol.initializer &&
    isStoreFactoryValue(symbol.initializer, factoryModules, scopes),
  );
};

const isBoundStoreCall = (
  node: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(node.callee);
  return (
    isNodeOfType(callee, "Identifier") && isStoreValue(callee, BOUND_STORE_FACTORY_MODULES, scopes)
  );
};

const isVanillaUseStoreCall = (
  node: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  if (node.arguments.length !== 1) return false;
  if (!isNamedImportFromModules(node.callee, "useStore", USE_STORE_MODULES, scopes)) return false;
  return isStoreValue(node.arguments[0], VANILLA_STORE_FACTORY_MODULES, scopes);
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
      if (!isWholeBoundStoreSubscription && !isVanillaUseStoreCall(node, context.scopes)) return;
      context.report({
        node,
        message:
          "This hook subscribes to the whole Zustand store, so every store update rerenders this component. Pass a selector for the state it reads.",
      });
    },
  }),
});
