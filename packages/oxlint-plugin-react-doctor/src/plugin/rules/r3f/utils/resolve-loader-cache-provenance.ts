import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getDestructuredBindingPropertyName } from "../../../utils/get-destructured-binding-property-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { isApiCallFromModules } from "./is-api-call-from-modules.js";
import { isR3fApiCall } from "./is-r3f-api-call.js";
import { DREI_CACHED_LOADER_HOOK_NAMES, DREI_PUBLIC_MODULES } from "./drei-public-modules.js";
import { getApiReferenceProvenance } from "./get-api-reference-provenance.js";

const ARRAY_VALUE_CALLBACK_METHOD_NAMES = new Set([
  "every",
  "filter",
  "find",
  "findIndex",
  "flatMap",
  "forEach",
  "map",
  "some",
]);
const SHALLOW_CLONE_SHARED_PROPERTY_NAMES = new Set(["geometry", "material"]);
const SHALLOW_CLONE_CONTAINER_PROPERTY_NAMES = new Set(["children"]);
const SHALLOW_MATERIAL_CLONE_SHARED_TEXTURE_PROPERTY_NAMES = new Set([
  "alphaMap",
  "aoMap",
  "bumpMap",
  "clearcoatMap",
  "clearcoatNormalMap",
  "clearcoatRoughnessMap",
  "displacementMap",
  "emissiveMap",
  "envMap",
  "gradientMap",
  "iridescenceMap",
  "iridescenceThicknessMap",
  "lightMap",
  "map",
  "matcap",
  "metalnessMap",
  "normalMap",
  "roughnessMap",
  "sheenColorMap",
  "sheenRoughnessMap",
  "specularMap",
  "thicknessMap",
  "transmissionMap",
]);
const SKELETON_UTILS_MODULE_SOURCES = new Set([
  "three-stdlib",
  "three/addons/utils/SkeletonUtils",
  "three/addons/utils/SkeletonUtils.js",
  "three/examples/jsm/utils/SkeletonUtils",
  "three/examples/jsm/utils/SkeletonUtils.js",
]);

interface LoaderCacheProvenance {
  isMaterialValue: boolean;
  kind: "cached" | "shallow-clone" | "shallow-material-clone";
  terminalPropertyName: string | null;
}

const extendLoaderCacheProvenance = (
  provenance: LoaderCacheProvenance,
  propertyName: string,
): LoaderCacheProvenance | null => {
  if (provenance.kind === "cached") {
    return {
      isMaterialValue:
        propertyName === "material" || provenance.terminalPropertyName === "materials",
      kind: "cached",
      terminalPropertyName: propertyName,
    };
  }
  if (provenance.kind === "shallow-material-clone") {
    return SHALLOW_MATERIAL_CLONE_SHARED_TEXTURE_PROPERTY_NAMES.has(propertyName)
      ? { isMaterialValue: false, kind: "cached", terminalPropertyName: propertyName }
      : null;
  }
  if (SHALLOW_CLONE_SHARED_PROPERTY_NAMES.has(propertyName)) {
    return {
      isMaterialValue: propertyName === "material",
      kind: "cached",
      terminalPropertyName: propertyName,
    };
  }
  if (
    SHALLOW_CLONE_CONTAINER_PROPERTY_NAMES.has(propertyName) ||
    Number.isInteger(Number(propertyName))
  ) {
    return { isMaterialValue: false, kind: "shallow-clone", terminalPropertyName: propertyName };
  }
  return null;
};

const isCachedLoaderCall = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (isR3fApiCall(node, "useLoader", scopes)) return true;
  for (const hookName of DREI_CACHED_LOADER_HOOK_NAMES) {
    if (isApiCallFromModules(node, hookName, DREI_PUBLIC_MODULES, scopes)) return true;
  }
  return false;
};

const hasStaticCacheMember = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  (getStaticPropertyName(node) !== null ||
    (node.computed &&
      isNodeOfType(node.property, "Literal") &&
      typeof node.property.value === "number"));

const getCacheMemberPropertyName = (node: EsTreeNode): string | null => {
  if (!isNodeOfType(node, "MemberExpression") || !hasStaticCacheMember(node)) return null;
  const propertyName = getStaticPropertyName(node);
  if (propertyName !== null) return propertyName;
  return isNodeOfType(node.property, "Literal") && typeof node.property.value === "number"
    ? String(node.property.value)
    : null;
};

const isGlobalObjectValuesCall = (
  node: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(node.callee, "MemberExpression")) {
    return false;
  }
  const receiver = stripParenExpression(node.callee.object);
  return (
    getStaticPropertyName(node.callee) === "values" &&
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === "Object" &&
    scopes.isGlobalReference(receiver)
  );
};

const getObjectValuesCallbackSource = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  const callback = symbol.bindingIdentifier.parent;
  if (
    !callback ||
    !isFunctionLike(callback) ||
    callback.params[0] !== symbol.bindingIdentifier ||
    !isNodeOfType(callback.parent, "CallExpression") ||
    callback.parent.arguments[0] !== callback ||
    !isNodeOfType(callback.parent.callee, "MemberExpression") ||
    !ARRAY_VALUE_CALLBACK_METHOD_NAMES.has(getStaticPropertyName(callback.parent.callee) ?? "")
  ) {
    return null;
  }
  const collection = stripParenExpression(callback.parent.callee.object);
  if (
    !isNodeOfType(collection, "CallExpression") ||
    !isGlobalObjectValuesCall(collection, scopes)
  ) {
    return null;
  }
  const source = collection.arguments[0];
  return source && !isNodeOfType(source, "SpreadElement") ? source : null;
};

const getTraverseCallbackSource = (symbol: SymbolDescriptor): EsTreeNode | null => {
  const callback = symbol.bindingIdentifier.parent;
  if (
    !callback ||
    !isFunctionLike(callback) ||
    callback.params[0] !== symbol.bindingIdentifier ||
    !isNodeOfType(callback.parent, "CallExpression") ||
    callback.parent.arguments[0] !== callback ||
    !isNodeOfType(callback.parent.callee, "MemberExpression") ||
    !["traverse", "traverseVisible"].includes(getStaticPropertyName(callback.parent.callee) ?? "")
  ) {
    return null;
  }
  return callback.parent.callee.object;
};

const resolveLoaderCacheProvenance = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): LoaderCacheProvenance | null => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "CallExpression")) {
    if (
      isNodeOfType(candidate.callee, "MemberExpression") &&
      getStaticPropertyName(candidate.callee) === "clone"
    ) {
      const clonedProvenance = resolveLoaderCacheProvenance(
        candidate.callee.object,
        scopes,
        new Set(visitedSymbolIds),
      );
      if (clonedProvenance) {
        return {
          isMaterialValue: false,
          kind:
            clonedProvenance.isMaterialValue || clonedProvenance.kind === "shallow-material-clone"
              ? "shallow-material-clone"
              : "shallow-clone",
          terminalPropertyName: null,
        };
      }
    }
    const callProvenance = getApiReferenceProvenance(candidate.callee, scopes);
    const cloneArgument = candidate.arguments[0];
    if (
      callProvenance?.apiName === "clone" &&
      SKELETON_UTILS_MODULE_SOURCES.has(callProvenance.moduleSource) &&
      cloneArgument &&
      !isNodeOfType(cloneArgument, "SpreadElement") &&
      resolveLoaderCacheProvenance(cloneArgument, scopes, new Set(visitedSymbolIds))
    ) {
      return { isMaterialValue: false, kind: "shallow-clone", terminalPropertyName: null };
    }
    return isCachedLoaderCall(candidate, scopes)
      ? { isMaterialValue: false, kind: "cached", terminalPropertyName: null }
      : null;
  }
  if (isNodeOfType(candidate, "MemberExpression")) {
    const propertyName = getCacheMemberPropertyName(candidate);
    if (propertyName === null) return null;
    const receiverProvenance = resolveLoaderCacheProvenance(
      candidate.object,
      scopes,
      visitedSymbolIds,
    );
    if (!receiverProvenance) return null;
    return extendLoaderCacheProvenance(receiverProvenance, propertyName);
  }
  if (!isNodeOfType(candidate, "Identifier")) return null;
  const symbol = scopes.symbolFor(candidate);
  if (!symbol || visitedSymbolIds.has(symbol.id)) {
    return null;
  }
  visitedSymbolIds.add(symbol.id);
  const callbackSource = getObjectValuesCallbackSource(symbol, scopes);
  if (callbackSource) {
    return resolveLoaderCacheProvenance(callbackSource, scopes, visitedSymbolIds);
  }
  const traverseSource = getTraverseCallbackSource(symbol);
  if (traverseSource) {
    return resolveLoaderCacheProvenance(traverseSource, scopes, visitedSymbolIds);
  }
  if (symbol.kind !== "const" || !symbol.initializer) return null;
  const initializerProvenance = resolveLoaderCacheProvenance(
    symbol.initializer,
    scopes,
    visitedSymbolIds,
  );
  if (!initializerProvenance) return null;
  const destructuredPropertyName = getDestructuredBindingPropertyName(symbol.bindingIdentifier);
  if (!destructuredPropertyName) return initializerProvenance;
  return extendLoaderCacheProvenance(initializerProvenance, destructuredPropertyName);
};

export const resolvesToLoaderCacheValue = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => resolveLoaderCacheProvenance(expression, scopes)?.kind === "cached";

export const getLoaderCacheTerminalPropertyName = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): string | null => {
  const provenance = resolveLoaderCacheProvenance(expression, scopes);
  return provenance?.kind === "cached" ? provenance.terminalPropertyName : null;
};
