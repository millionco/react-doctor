import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { functionReturnsMatchingExpression } from "../../utils/function-returns-matching-expression.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import {
  analyzeOwnedLifecycleCleanup,
  analyzeOwnedLifecycleResource,
  functionInvokesOwnedResourceMethod,
} from "./utils/analyze-owned-lifecycle-resource.js";
import { getApiReferenceProvenance } from "./utils/get-api-reference-provenance.js";
import { isR3fReactApiCall } from "./utils/is-r3f-react-api-call.js";

const OWNED_TEXTURE_CONSTRUCTOR_NAMES = new Set([
  "CanvasTexture",
  "DataTexture",
  "Texture",
  "VideoTexture",
]);
const TEXTURE_BORROWING_METHOD_NAMES = new Set<string>();

const isMaterialTexturePropertyName = (propertyName: string | null): boolean =>
  propertyName === "map" || propertyName === "matcap" || Boolean(propertyName?.endsWith("Map"));

const isThreeMaterialAllocation = (expression: EsTreeNode, context: RuleContext): boolean => {
  const candidate = stripParenExpression(expression);
  if (!isNodeOfType(candidate, "NewExpression")) return false;
  const provenance = getApiReferenceProvenance(candidate.callee, context.scopes);
  return Boolean(provenance?.moduleSource === "three" && provenance.apiName.endsWith("Material"));
};

const expressionResolvesToThreeMaterial = (
  expression: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isThreeMaterialAllocation(candidate, context)) return true;
  const functionCreatesThreeMaterial = (factoryExpression: EsTreeNode): boolean => {
    const factory = resolveExactLocalFunction(factoryExpression, context.scopes);
    return Boolean(
      factory &&
      functionReturnsMatchingExpression(
        factory,
        context.scopes,
        (returnedExpression) => isThreeMaterialAllocation(returnedExpression, context),
        context.cfg,
        "every",
      ),
    );
  };
  if (
    isNodeOfType(candidate, "MemberExpression") &&
    getStaticPropertyName(candidate) === "current"
  ) {
    const receiver = stripParenExpression(candidate.object);
    if (!isNodeOfType(receiver, "Identifier")) return false;
    const refSymbol = context.scopes.symbolFor(receiver);
    const refInitializer = refSymbol?.initializer
      ? stripParenExpression(refSymbol.initializer)
      : null;
    if (
      !refSymbol ||
      !refInitializer ||
      !isNodeOfType(refInitializer, "CallExpression") ||
      !isR3fReactApiCall(refInitializer, "useRef", context.scopes)
    ) {
      return false;
    }
    const initialValue = refInitializer.arguments[0];
    if (
      initialValue &&
      !isNodeOfType(initialValue, "SpreadElement") &&
      isThreeMaterialAllocation(initialValue, context)
    ) {
      return true;
    }
    return refSymbol.references.some((reference) => {
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      const member = referenceRoot.parent;
      const assignment = member?.parent;
      return Boolean(
        isNodeOfType(member, "MemberExpression") &&
        member.object === referenceRoot &&
        getStaticPropertyName(member) === "current" &&
        isNodeOfType(assignment, "AssignmentExpression") &&
        assignment.left === member &&
        isThreeMaterialAllocation(assignment.right, context),
      );
    });
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
  const declaration = symbol.declarationNode;
  if (
    isNodeOfType(declaration, "VariableDeclarator") &&
    isNodeOfType(declaration.id, "ArrayPattern") &&
    declaration.id.elements[0] === symbol.bindingIdentifier &&
    declaration.init &&
    isNodeOfType(stripParenExpression(declaration.init), "CallExpression") &&
    isR3fReactApiCall(stripParenExpression(declaration.init), "useState", context.scopes)
  ) {
    const stateCall = stripParenExpression(declaration.init);
    if (!isNodeOfType(stateCall, "CallExpression")) return false;
    const initialValue = stateCall.arguments[0];
    return Boolean(
      initialValue &&
      !isNodeOfType(initialValue, "SpreadElement") &&
      (isThreeMaterialAllocation(initialValue, context) ||
        functionCreatesThreeMaterial(initialValue)),
    );
  }
  const initializer = stripParenExpression(symbol.initializer);
  if (isThreeMaterialAllocation(initializer, context)) return true;
  if (isNodeOfType(initializer, "Identifier")) {
    return expressionResolvesToThreeMaterial(initializer, context, visitedSymbolIds);
  }
  if (!isNodeOfType(initializer, "CallExpression")) return false;
  if (!isR3fReactApiCall(initializer, "useMemo", context.scopes)) return false;
  const callbackArgument = initializer.arguments[0];
  if (!callbackArgument || isNodeOfType(callbackArgument, "SpreadElement")) return false;
  return functionCreatesThreeMaterial(callbackArgument);
};

const isBorrowedByThreeMaterial = (reference: EsTreeNode, context: RuleContext): boolean => {
  const referenceRoot = findTransparentExpressionRoot(reference);
  const parent = referenceRoot.parent;
  if (isNodeOfType(parent, "AssignmentExpression") && parent.right === referenceRoot) {
    const target = stripParenExpression(parent.left);
    return Boolean(
      isNodeOfType(target, "MemberExpression") &&
      isMaterialTexturePropertyName(getStaticPropertyName(target)) &&
      expressionResolvesToThreeMaterial(target.object, context),
    );
  }
  if (!isNodeOfType(parent, "Property") || parent.value !== referenceRoot) return false;
  const propertyName = getStaticPropertyKeyName(parent);
  const options = parent.parent;
  const allocation = options?.parent;
  return Boolean(
    isMaterialTexturePropertyName(propertyName) &&
    isNodeOfType(options, "ObjectExpression") &&
    isNodeOfType(allocation, "NewExpression") &&
    allocation.arguments.some((argument) => argument === options) &&
    isThreeMaterialAllocation(allocation, context),
  );
};

export const r3fRequireOwnedTextureCleanup = defineRule({
  id: "r3f-require-owned-texture-cleanup",
  title: "Locally owned Three.js texture is not disposed",
  category: "Performance",
  severity: "warn",
  recommendation: "Dispose locally constructed textures in a React effect cleanup",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const provenance = getApiReferenceProvenance(node.callee, context.scopes);
      if (
        provenance?.moduleSource !== "three" ||
        !OWNED_TEXTURE_CONSTRUCTOR_NAMES.has(provenance.apiName)
      ) {
        return;
      }
      const ownership = analyzeOwnedLifecycleResource(node, context, {
        borrowedArgumentMethodNames: TEXTURE_BORROWING_METHOD_NAMES,
        isBorrowedReference: (reference) => isBorrowedByThreeMaterial(reference, context),
        retainsOwnershipInJsx: true,
      });
      if (!ownership || ownership.hasUnknownOwnershipTransfer) return;
      const cleanup = analyzeOwnedLifecycleCleanup(ownership, context, (cleanupFunction) =>
        functionInvokesOwnedResourceMethod(cleanupFunction, ownership, "dispose", context.scopes),
      );
      if (cleanup.isProven || cleanup.isUnknown) return;
      context.report({
        node,
        message:
          "This locally constructed Three.js texture owns GPU resources but has no provable React cleanup. Dispose it when the owning component or hook releases it",
      });
    },
  }),
});
