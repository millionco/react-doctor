import { defineRule } from "../../utils/define-rule.js";
import type { ScopeDescriptor, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";

interface ProgramVariantCandidate {
  readonly materialSymbolId: number;
  readonly node: EsTreeNodeOfType<"AssignmentExpression">;
}

const SHADER_PROGRAM_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "defines",
  "fragmentShader",
  "vertexShader",
]);

const isScopeWithin = (
  candidateScope: ScopeDescriptor,
  ancestorScope: ScopeDescriptor,
): boolean => {
  let currentScope: ScopeDescriptor | null = candidateScope;
  while (currentScope) {
    if (currentScope === ancestorScope) return true;
    currentScope = currentScope.parent;
  }
  return false;
};

const getMemberRootIdentifier = (expression: EsTreeNode): EsTreeNode | null => {
  let candidate = expression;
  while (isNodeOfType(candidate, "MemberExpression")) {
    candidate = candidate.object;
  }
  return isNodeOfType(candidate, "Identifier") ? candidate : null;
};

const getShaderProgramPropertyName = (
  member: EsTreeNodeOfType<"MemberExpression">,
  shaderParameterSymbol: SymbolDescriptor,
  context: RuleContext,
): string | null => {
  const rootIdentifier = getMemberRootIdentifier(member);
  if (
    !rootIdentifier ||
    context.scopes.symbolFor(rootIdentifier)?.id !== shaderParameterSymbol.id
  ) {
    return null;
  }
  let candidate: EsTreeNode = member;
  let propertyName: string | null = null;
  while (isNodeOfType(candidate, "MemberExpression")) {
    propertyName = getStaticPropertyName(candidate);
    if (isNodeOfType(candidate.object, "Identifier")) break;
    candidate = candidate.object;
  }
  return propertyName && SHADER_PROGRAM_PROPERTY_NAMES.has(propertyName) ? propertyName : null;
};

const expressionDependsOnMutableCapture = (
  expression: EsTreeNode,
  callbackScope: ScopeDescriptor,
  context: RuleContext,
): boolean => {
  let dependsOnMutableCapture = false;
  walkAst(expression, (candidate) => {
    if (dependsOnMutableCapture || (candidate !== expression && isFunctionLike(candidate))) {
      return false;
    }
    if (isNodeOfType(candidate, "MemberExpression")) {
      const rootIdentifier = getMemberRootIdentifier(candidate);
      const symbol = rootIdentifier ? context.scopes.symbolFor(rootIdentifier) : null;
      if (
        symbol &&
        !isScopeWithin(symbol.scope, callbackScope) &&
        symbol.kind !== "import" &&
        symbol.kind !== "function" &&
        symbol.kind !== "class"
      ) {
        dependsOnMutableCapture = true;
        return false;
      }
    }
    if (!isNodeOfType(candidate, "Identifier")) return;
    const symbol = context.scopes.symbolFor(candidate);
    if (
      symbol &&
      !isScopeWithin(symbol.scope, callbackScope) &&
      (symbol.kind === "let" || symbol.kind === "var")
    ) {
      dependsOnMutableCapture = true;
      return false;
    }
  });
  return dependsOnMutableCapture;
};

const callbackHasVariantDependentPatch = (callback: EsTreeNode, context: RuleContext): boolean => {
  const callbackScope = context.scopes.ownScopeFor(callback);
  if (!callbackScope || !isFunctionLike(callback)) return false;
  const shaderParameter = callback.params[0];
  if (!shaderParameter || !isNodeOfType(shaderParameter, "Identifier")) return false;
  const shaderParameterSymbol = context.scopes.symbolFor(shaderParameter);
  if (!shaderParameterSymbol) return false;
  const subtreeHasShaderProgramWrite = (subtree: EsTreeNode): boolean => {
    let hasWrite = false;
    walkAst(subtree, (candidate) => {
      if (hasWrite || (candidate !== subtree && isFunctionLike(candidate))) return false;
      if (
        isNodeOfType(candidate, "AssignmentExpression") &&
        isNodeOfType(candidate.left, "MemberExpression") &&
        getShaderProgramPropertyName(candidate.left, shaderParameterSymbol, context)
      ) {
        hasWrite = true;
        return false;
      }
    });
    return hasWrite;
  };
  let hasVariantDependentPatch = false;
  walkAst(callback.body, (candidate) => {
    if (hasVariantDependentPatch || (candidate !== callback.body && isFunctionLike(candidate))) {
      return false;
    }
    if (
      isNodeOfType(candidate, "AssignmentExpression") &&
      isNodeOfType(candidate.left, "MemberExpression") &&
      getShaderProgramPropertyName(candidate.left, shaderParameterSymbol, context) &&
      expressionDependsOnMutableCapture(candidate.right, callbackScope, context)
    ) {
      hasVariantDependentPatch = true;
      return false;
    }
    if (
      isNodeOfType(candidate, "IfStatement") &&
      expressionDependsOnMutableCapture(candidate.test, callbackScope, context) &&
      (subtreeHasShaderProgramWrite(candidate.consequent) ||
        Boolean(candidate.alternate && subtreeHasShaderProgramWrite(candidate.alternate)))
    ) {
      hasVariantDependentPatch = true;
      return false;
    }
    if (
      isNodeOfType(candidate, "ConditionalExpression") &&
      expressionDependsOnMutableCapture(candidate.test, callbackScope, context) &&
      (subtreeHasShaderProgramWrite(candidate.consequent) ||
        subtreeHasShaderProgramWrite(candidate.alternate))
    ) {
      hasVariantDependentPatch = true;
      return false;
    }
  });
  return hasVariantDependentPatch;
};

const getStableMaterialSymbol = (
  expression: EsTreeNode,
  context: RuleContext,
): SymbolDescriptor | null => {
  if (!isNodeOfType(expression, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(expression);
  if (
    symbol?.kind !== "const" ||
    !getThreeConstructorName(expression, context.scopes)?.endsWith("Material")
  ) {
    return null;
  }
  return symbol;
};

export const threeOnBeforeCompileRequireProgramCacheKey = defineRule({
  id: "three-on-before-compile-require-program-cache-key",
  title: "onBeforeCompile variant lacks a program cache key",
  category: "Correctness",
  severity: "error",
  recommendation:
    "Return every mutable shader-patch variant from customProgramCacheKey on the same material",
  create: (context: RuleContext) => {
    const candidates: ProgramVariantCandidate[] = [];
    const materialSymbolsWithCacheKeys = new Set<number>();
    return {
      AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
        if (!isNodeOfType(node.left, "MemberExpression")) return;
        const propertyName = getStaticPropertyName(node.left);
        if (propertyName !== "onBeforeCompile" && propertyName !== "customProgramCacheKey") {
          return;
        }
        const materialSymbol = getStableMaterialSymbol(node.left.object, context);
        if (!materialSymbol) return;
        if (propertyName === "customProgramCacheKey") {
          materialSymbolsWithCacheKeys.add(materialSymbol.id);
          return;
        }
        const callback = resolveExactLocalFunction(node.right, context.scopes);
        if (!callback || !callbackHasVariantDependentPatch(callback, context)) return;
        candidates.push({ materialSymbolId: materialSymbol.id, node });
      },
      "Program:exit"() {
        for (const candidate of candidates) {
          if (materialSymbolsWithCacheKeys.has(candidate.materialSymbolId)) continue;
          context.report({
            node: candidate.node,
            message:
              "This onBeforeCompile patch changes shader source from mutable captured state, but the material has no customProgramCacheKey for those program variants",
          });
        }
      },
    };
  },
});
