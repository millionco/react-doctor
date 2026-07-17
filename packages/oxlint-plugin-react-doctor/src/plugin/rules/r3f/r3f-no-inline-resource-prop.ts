import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getImportDeclarationForSymbol } from "../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isInsideStableReactHookInitializer } from "../../utils/is-inside-stable-react-hook-initializer.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTypeOnlyImport } from "../../utils/is-type-only-import.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { R3F_PUBLIC_MODULES } from "./utils/r3f-public-modules.js";

const GEOMETRY_RESOURCE_HOST_NAMES = new Set([
  "batchedMesh",
  "instancedMesh",
  "line",
  "lineLoop",
  "lineSegments",
  "mesh",
  "points",
  "primitive",
  "skinnedMesh",
]);
const MATERIAL_RESOURCE_HOST_NAMES = new Set([...GEOMETRY_RESOURCE_HOST_NAMES, "sprite"]);

const isThreeModuleSource = (source: unknown): source is string =>
  typeof source === "string" &&
  (source === "three" || source.startsWith("three/") || source === "three-stdlib");

const getThreeConstructorName = (
  constructorExpression: EsTreeNode,
  scopes: ScopeAnalysis,
): string | null => {
  const constructor = stripParenExpression(constructorExpression);
  if (isNodeOfType(constructor, "Identifier")) {
    const symbol = resolveConstIdentifierAlias(constructor, scopes);
    const importSource = symbol && getImportDeclarationForSymbol(symbol)?.source.value;
    return symbol && isThreeModuleSource(importSource)
      ? (getImportedName(symbol.declarationNode) ?? null)
      : null;
  }
  if (!isNodeOfType(constructor, "MemberExpression")) return null;
  const constructorName = getStaticPropertyName(constructor);
  const namespace = stripParenExpression(constructor.object);
  if (!constructorName || !isNodeOfType(namespace, "Identifier")) return null;
  const symbol = resolveConstIdentifierAlias(namespace, scopes);
  const importSource = symbol && getImportDeclarationForSymbol(symbol)?.source.value;
  return symbol &&
    isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier") &&
    isThreeModuleSource(importSource)
    ? constructorName
    : null;
};

const hasFreshThreeResource = (
  expression: EsTreeNode,
  constructorSuffix: string,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "NewExpression")) {
    return getThreeConstructorName(candidate.callee, scopes)?.endsWith(constructorSuffix) ?? false;
  }
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = scopes.symbolFor(candidate);
    if (
      symbol?.kind !== "const" ||
      symbol.scope.kind === "module" ||
      !symbol.initializer ||
      visitedSymbolIds.has(symbol.id) ||
      !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
      symbol.declarationNode.id !== symbol.bindingIdentifier
    ) {
      return false;
    }
    visitedSymbolIds.add(symbol.id);
    return hasFreshThreeResource(symbol.initializer, constructorSuffix, scopes, visitedSymbolIds);
  }
  if (isNodeOfType(candidate, "ConditionalExpression")) {
    return (
      hasFreshThreeResource(
        candidate.consequent,
        constructorSuffix,
        scopes,
        new Set(visitedSymbolIds),
      ) ||
      hasFreshThreeResource(
        candidate.alternate,
        constructorSuffix,
        scopes,
        new Set(visitedSymbolIds),
      )
    );
  }
  if (isNodeOfType(candidate, "LogicalExpression")) {
    return (
      hasFreshThreeResource(candidate.left, constructorSuffix, scopes, new Set(visitedSymbolIds)) ||
      hasFreshThreeResource(candidate.right, constructorSuffix, scopes, new Set(visitedSymbolIds))
    );
  }
  if (isNodeOfType(candidate, "ArrayExpression") && constructorSuffix === "Material") {
    return candidate.elements.some(
      (element) =>
        element &&
        !isNodeOfType(element, "SpreadElement") &&
        hasFreshThreeResource(element, constructorSuffix, scopes, new Set(visitedSymbolIds)),
    );
  }
  if (
    isNodeOfType(candidate, "CallExpression") &&
    isNodeOfType(candidate.callee, "MemberExpression")
  ) {
    if (getStaticPropertyName(candidate.callee) === "clone") return true;
    return hasFreshThreeResource(
      candidate.callee.object,
      constructorSuffix,
      scopes,
      visitedSymbolIds,
    );
  }
  return false;
};

const reportFreshResourceProp = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  propertyName: string,
  constructorSuffix: string,
  hostNames: ReadonlySet<string>,
  context: RuleContext,
): void => {
  if (!isNodeOfType(node.name, "JSXIdentifier") || !hostNames.has(node.name.name)) return;
  const attribute = getAuthoritativeJsxAttribute(node.attributes, propertyName);
  if (
    !attribute?.value ||
    !isNodeOfType(attribute.value, "JSXExpressionContainer") ||
    isNodeOfType(attribute.value.expression, "JSXEmptyExpression") ||
    !hasFreshThreeResource(attribute.value.expression, constructorSuffix, context.scopes)
  ) {
    return;
  }
  context.report({
    node: attribute.value.expression,
    message: `This Three.js ${propertyName} is reconstructed on every React render, causing GPU resource churn and potentially leaving displaced prop resources outside declarative disposal. Reuse a stable resource`,
  });
};

export const r3fNoInlineResourceProp = defineRule({
  id: "r3f-no-inline-resource-prop",
  title: "Inline R3F resource prop",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation:
    "Create the Three.js geometry or material once at module scope, in lazy state, or with useMemo before passing it as an R3F resource prop",
  create: (context: RuleContext) => {
    let importsReactThreeFiber = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        importsReactThreeFiber = node.body.some(
          (statement) =>
            isNodeOfType(statement, "ImportDeclaration") &&
            !isTypeOnlyImport(statement) &&
            typeof statement.source.value === "string" &&
            R3F_PUBLIC_MODULES.has(statement.source.value),
        );
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (
          !importsReactThreeFiber ||
          !isNodeOfType(node.name, "JSXIdentifier") ||
          !findRenderPhaseComponentOrHook(node, context.scopes) ||
          isInsideStableReactHookInitializer(node, context.scopes)
        ) {
          return;
        }
        reportFreshResourceProp(
          node,
          "geometry",
          "Geometry",
          GEOMETRY_RESOURCE_HOST_NAMES,
          context,
        );
        reportFreshResourceProp(
          node,
          "material",
          "Material",
          MATERIAL_RESOURCE_HOST_NAMES,
          context,
        );
      },
    };
  },
});
