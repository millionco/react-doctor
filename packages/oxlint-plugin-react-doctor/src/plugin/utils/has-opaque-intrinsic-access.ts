import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { isKeyedDraftTypeReference } from "./is-keyed-draft-type-reference.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isFunctionLike } from "./is-function-like.js";
import { getSymbolReferenceIndex } from "./get-symbol-reference-index.js";
import { walkAst } from "./walk-ast.js";

const DYNAMIC_CODE_GLOBAL_NAMES = new Set(["eval", "Function"]);
const INTRINSIC_CAPABILITY_PROPERTY_NAMES = new Set([
  ...DYNAMIC_CODE_GLOBAL_NAMES,
  "__proto__",
  "constructor",
  "prototype",
  "getPrototypeOf",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
  "__lookupGetter__",
  "__lookupSetter__",
  "__defineGetter__",
  "__defineSetter__",
  "get",
]);
export interface IntrinsicAccessOptions {
  readonly protectedGlobalNames?: ReadonlySet<string>;
}

const opaqueAccessByScopes = new WeakMap<ScopeAnalysis, Map<string, boolean>>();

export const hasOpaqueIntrinsicAccess = (
  program: EsTreeNode,
  scopes: ScopeAnalysis,
  options: IntrinsicAccessOptions = {},
): boolean => {
  const cacheKey = JSON.stringify([
    "strict",
    options.protectedGlobalNames ? [...options.protectedGlobalNames].sort() : null,
  ]);
  let cache = opaqueAccessByScopes.get(scopes);
  if (!cache) {
    cache = new Map();
    opaqueAccessByScopes.set(scopes, cache);
  }
  const cachedResult = cache.get(cacheKey);
  if (cachedResult !== undefined) return cachedResult;
  let hasOpaqueAccess = false;
  walkAst(program, (node) => {
    if (hasOpaqueAccess || isKeyedDraftTypeReference(node)) return false;
    if (isNodeOfType(node, "Identifier") && options.protectedGlobalNames) {
      let ancestor: EsTreeNode = node;
      let isInitializer = false;
      while (ancestor.parent) {
        const parent: EsTreeNode = ancestor.parent;
        if (
          (isNodeOfType(parent, "AssignmentPattern") && parent.right === ancestor) ||
          (isNodeOfType(parent, "Property") && parent.computed && parent.key === ancestor)
        )
          isInitializer = true;
        if (
          isInitializer &&
          isFunctionLike(parent) &&
          parent.params.some((parameter) => parameter === ancestor)
        ) {
          const symbol = scopes.symbolFor(node);
          if (node !== symbol?.bindingIdentifier) {
            const index = getSymbolReferenceIndex(program, scopes);
            const references =
              (symbol && index.resolvedNodes.get(symbol)) ?? index.ambiguousNodes.get(node.name);
            if (scopes.referenceFor(node) || references?.includes(node)) {
              hasOpaqueAccess = true;
              return false;
            }
          }
          break;
        }
        ancestor = parent;
      }
    }
    if (
      isNodeOfType(node, "Identifier") &&
      DYNAMIC_CODE_GLOBAL_NAMES.has(node.name) &&
      scopes.isGlobalReference(node)
    ) {
      hasOpaqueAccess = true;
      return false;
    }
    if (
      isNodeOfType(node, "MemberExpression") ||
      (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"))
    ) {
      const propertyName = getResolvedStaticPropertyName(node, scopes);
      if (
        propertyName === null ||
        INTRINSIC_CAPABILITY_PROPERTY_NAMES.has(propertyName) ||
        options.protectedGlobalNames?.has(propertyName)
      ) {
        hasOpaqueAccess = true;
        return false;
      }
    }
  });
  cache.set(cacheKey, hasOpaqueAccess);
  return hasOpaqueAccess;
};
