import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";
import { isInsideStableR3fReactHookInitializer } from "./utils/is-inside-stable-r3f-react-hook-initializer.js";
import { getApiReferenceProvenance } from "./utils/get-api-reference-provenance.js";

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
const GEOMETRY_RESOURCE_METHODS = new Set([
  "applyMatrix4",
  "applyQuaternion",
  "center",
  "clone",
  "copy",
  "deleteAttribute",
  "lookAt",
  "rotateX",
  "rotateY",
  "rotateZ",
  "scale",
  "setAttribute",
  "setFromPoints",
  "setIndex",
  "setIndirect",
  "toNonIndexed",
  "translate",
]);
const MATERIAL_RESOURCE_METHODS = new Set(["clone", "copy"]);
const GEOMETRY_OWNER_CONSTRUCTORS = new Set([
  "BatchedMesh",
  "InstancedMesh",
  "Line",
  "LineLoop",
  "LineSegments",
  "Mesh",
  "Points",
  "SkinnedMesh",
]);
const MATERIAL_OWNER_CONSTRUCTORS = new Set([...GEOMETRY_OWNER_CONSTRUCTORS, "Sprite"]);

const isThreeModuleSource = (source: unknown): source is string =>
  typeof source === "string" &&
  (source === "three" || source.startsWith("three/") || source === "three-stdlib");

const getThreeConstructorName = (
  constructorExpression: EsTreeNode,
  scopes: ScopeAnalysis,
): string | null => {
  const constructor = stripParenExpression(constructorExpression);
  const provenance = getApiReferenceProvenance(constructor, scopes);
  return provenance && isThreeModuleSource(provenance.moduleSource) ? provenance.apiName : null;
};

const hasThreeResourceOwnerProvenance = (
  expression: EsTreeNode,
  ownerConstructors: ReadonlySet<string>,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "NewExpression")) {
    const constructorName = getThreeConstructorName(candidate.callee, scopes);
    return Boolean(constructorName && ownerConstructors.has(constructorName));
  }
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = scopes.symbolFor(candidate);
    if (
      symbol?.kind !== "const" ||
      !symbol.initializer ||
      visitedSymbolIds.has(symbol.id) ||
      !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
      symbol.declarationNode.id !== symbol.bindingIdentifier
    ) {
      return false;
    }
    visitedSymbolIds.add(symbol.id);
    return hasThreeResourceOwnerProvenance(
      symbol.initializer,
      ownerConstructors,
      scopes,
      visitedSymbolIds,
    );
  }
  return Boolean(
    isNodeOfType(candidate, "CallExpression") &&
    isNodeOfType(candidate.callee, "MemberExpression") &&
    getStaticPropertyName(candidate.callee) === "clone" &&
    hasThreeResourceOwnerProvenance(
      candidate.callee.object,
      ownerConstructors,
      scopes,
      visitedSymbolIds,
    ),
  );
};

const getResourceMethods = (constructorSuffix: string): ReadonlySet<string> =>
  constructorSuffix === "Geometry" ? GEOMETRY_RESOURCE_METHODS : MATERIAL_RESOURCE_METHODS;

const hasThreeResourceProvenance = (
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
      !symbol.initializer ||
      visitedSymbolIds.has(symbol.id) ||
      !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
      symbol.declarationNode.id !== symbol.bindingIdentifier
    ) {
      return false;
    }
    visitedSymbolIds.add(symbol.id);
    return hasThreeResourceProvenance(
      symbol.initializer,
      constructorSuffix,
      scopes,
      visitedSymbolIds,
    );
  }
  if (isNodeOfType(candidate, "ConditionalExpression")) {
    return (
      hasThreeResourceProvenance(
        candidate.consequent,
        constructorSuffix,
        scopes,
        new Set(visitedSymbolIds),
      ) &&
      hasThreeResourceProvenance(
        candidate.alternate,
        constructorSuffix,
        scopes,
        new Set(visitedSymbolIds),
      )
    );
  }
  if (isNodeOfType(candidate, "LogicalExpression")) {
    return (
      hasThreeResourceProvenance(
        candidate.left,
        constructorSuffix,
        scopes,
        new Set(visitedSymbolIds),
      ) &&
      hasThreeResourceProvenance(
        candidate.right,
        constructorSuffix,
        scopes,
        new Set(visitedSymbolIds),
      )
    );
  }
  if (isNodeOfType(candidate, "MemberExpression")) {
    const propertyName = getStaticPropertyName(candidate);
    const resourcePropertyName = constructorSuffix === "Geometry" ? "geometry" : "material";
    const ownerConstructors =
      constructorSuffix === "Geometry" ? GEOMETRY_OWNER_CONSTRUCTORS : MATERIAL_OWNER_CONSTRUCTORS;
    return (
      propertyName === resourcePropertyName &&
      hasThreeResourceOwnerProvenance(candidate.object, ownerConstructors, scopes, visitedSymbolIds)
    );
  }
  return Boolean(
    isNodeOfType(candidate, "CallExpression") &&
    isNodeOfType(candidate.callee, "MemberExpression") &&
    getResourceMethods(constructorSuffix).has(getStaticPropertyName(candidate.callee) ?? "") &&
    hasThreeResourceProvenance(
      candidate.callee.object,
      constructorSuffix,
      scopes,
      visitedSymbolIds,
    ),
  );
};

const isProvenNonNullIndex = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (
    isNodeOfType(candidate, "ArrayExpression") ||
    isNodeOfType(candidate, "NewExpression") ||
    (isNodeOfType(candidate, "Literal") && candidate.value !== null)
  ) {
    return true;
  }
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = scopes.symbolFor(candidate);
  if (
    symbol?.kind !== "const" ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id) ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier
  ) {
    return false;
  }
  visitedSymbolIds.add(symbol.id);
  return isProvenNonNullIndex(symbol.initializer, scopes, visitedSymbolIds);
};

const hasProvenIndexedThreeGeometry = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = scopes.symbolFor(candidate);
    if (
      symbol?.kind !== "const" ||
      !symbol.initializer ||
      visitedSymbolIds.has(symbol.id) ||
      !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
      symbol.declarationNode.id !== symbol.bindingIdentifier
    ) {
      return false;
    }
    visitedSymbolIds.add(symbol.id);
    return hasProvenIndexedThreeGeometry(symbol.initializer, scopes, visitedSymbolIds);
  }
  if (
    !isNodeOfType(candidate, "CallExpression") ||
    !isNodeOfType(candidate.callee, "MemberExpression") ||
    getStaticPropertyName(candidate.callee) !== "setIndex"
  ) {
    return false;
  }
  const index = candidate.arguments[0];
  return Boolean(
    index &&
    !isNodeOfType(index, "SpreadElement") &&
    isProvenNonNullIndex(index, scopes) &&
    hasThreeResourceProvenance(candidate.callee.object, "Geometry", scopes),
  );
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
    const methodName = getStaticPropertyName(candidate.callee);
    if (methodName === "clone") {
      return hasThreeResourceProvenance(
        candidate.callee.object,
        constructorSuffix,
        scopes,
        visitedSymbolIds,
      );
    }
    if (constructorSuffix === "Geometry" && methodName === "toNonIndexed") {
      return (
        hasFreshThreeResource(
          candidate.callee.object,
          constructorSuffix,
          scopes,
          new Set(visitedSymbolIds),
        ) ||
        hasProvenIndexedThreeGeometry(candidate.callee.object, scopes, new Set(visitedSymbolIds))
      );
    }
    if (!methodName || !getResourceMethods(constructorSuffix).has(methodName)) return false;
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
        importsReactThreeFiber = hasR3fRuntimeImport(node, context.scopes);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (
          !importsReactThreeFiber ||
          !isNodeOfType(node.name, "JSXIdentifier") ||
          !findRenderPhaseComponentOrHook(node, context.scopes) ||
          isInsideStableR3fReactHookInitializer(node, context.scopes)
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
