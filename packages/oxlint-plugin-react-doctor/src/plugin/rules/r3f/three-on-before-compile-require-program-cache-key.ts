import { defineRule } from "../../utils/define-rule.js";
import type { ScopeDescriptor, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getDirectUnreassignedInitializer } from "../../utils/get-direct-unreassigned-initializer.js";
import { getEffectiveObjectPropertiesInInsertionOrder } from "../../utils/get-effective-object-properties-in-insertion-order.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import { resolveStableOptionsObject } from "../../utils/resolve-stable-options-object.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";

interface ProgramVariantCandidate {
  readonly hasConstructorCacheKey: boolean;
  readonly materialSymbolId: number | null;
  readonly node: EsTreeNode;
}

const SHADER_PROGRAM_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "defines",
  "fragmentShader",
  "vertexShader",
]);
const MATERIAL_PROGRAM_OPTION_NAMES = ["customProgramCacheKey", "onBeforeCompile"];

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
  const visitedLocalSymbolIds = new Set<number>();
  const inspectExpression = (expressionToInspect: EsTreeNode): boolean => {
    let dependsOnMutableCapture = false;
    walkAst(expressionToInspect, (candidate) => {
      if (
        dependsOnMutableCapture ||
        (candidate !== expressionToInspect && isFunctionLike(candidate))
      ) {
        return false;
      }
      if (isNodeOfType(candidate, "ThisExpression")) {
        dependsOnMutableCapture = true;
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
      const hasMutableConstInitializer =
        symbol?.kind === "const" &&
        Boolean(
          symbol.initializer &&
          (isNodeOfType(symbol.initializer, "ArrayExpression") ||
            isNodeOfType(symbol.initializer, "ObjectExpression") ||
            isNodeOfType(symbol.initializer, "NewExpression")),
        );
      if (
        symbol &&
        !isScopeWithin(symbol.scope, callbackScope) &&
        (symbol.kind === "let" ||
          symbol.kind === "var" ||
          symbol.kind === "parameter" ||
          hasMutableConstInitializer)
      ) {
        dependsOnMutableCapture = true;
        return false;
      }
      if (
        !symbol ||
        !isScopeWithin(symbol.scope, callbackScope) ||
        visitedLocalSymbolIds.has(symbol.id)
      ) {
        return;
      }
      const initializer = getDirectUnreassignedInitializer(symbol);
      if (
        !initializer ||
        isFunctionLike(initializer) ||
        isNodeOfType(initializer, "ArrayExpression") ||
        isNodeOfType(initializer, "ObjectExpression") ||
        isNodeOfType(initializer, "NewExpression")
      ) {
        return;
      }
      visitedLocalSymbolIds.add(symbol.id);
      if (inspectExpression(initializer)) {
        dependsOnMutableCapture = true;
        return false;
      }
    });
    return dependsOnMutableCapture;
  };
  return inspectExpression(expression);
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
    if (
      isNodeOfType(candidate, "LogicalExpression") &&
      expressionDependsOnMutableCapture(candidate.left, callbackScope, context) &&
      subtreeHasShaderProgramWrite(candidate.right)
    ) {
      hasVariantDependentPatch = true;
      return false;
    }
    if (
      isNodeOfType(candidate, "SwitchStatement") &&
      (expressionDependsOnMutableCapture(candidate.discriminant, callbackScope, context) ||
        candidate.cases.some(
          (switchCase) =>
            switchCase.test &&
            expressionDependsOnMutableCapture(switchCase.test, callbackScope, context),
        )) &&
      candidate.cases.some((switchCase) => switchCase.consequent.some(subtreeHasShaderProgramWrite))
    ) {
      hasVariantDependentPatch = true;
      return false;
    }
    if (
      (isNodeOfType(candidate, "WhileStatement") || isNodeOfType(candidate, "DoWhileStatement")) &&
      expressionDependsOnMutableCapture(candidate.test, callbackScope, context) &&
      subtreeHasShaderProgramWrite(candidate.body)
    ) {
      hasVariantDependentPatch = true;
      return false;
    }
    if (
      isNodeOfType(candidate, "ForStatement") &&
      candidate.test &&
      expressionDependsOnMutableCapture(candidate.test, callbackScope, context) &&
      subtreeHasShaderProgramWrite(candidate.body)
    ) {
      hasVariantDependentPatch = true;
      return false;
    }
    if (
      (isNodeOfType(candidate, "ForInStatement") || isNodeOfType(candidate, "ForOfStatement")) &&
      expressionDependsOnMutableCapture(candidate.right, callbackScope, context) &&
      subtreeHasShaderProgramWrite(candidate.body)
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
  const initializer = symbol ? getDirectUnreassignedInitializer(symbol) : null;
  if (
    !symbol ||
    !initializer ||
    !getThreeConstructorName(initializer, context.scopes)?.endsWith("Material")
  ) {
    return null;
  }
  return symbol;
};

const getConstructorMaterialSymbol = (
  node: EsTreeNodeOfType<"NewExpression">,
  context: RuleContext,
): SymbolDescriptor | null => {
  const parent = node.parent;
  if (
    !isNodeOfType(parent, "VariableDeclarator") ||
    parent.init !== node ||
    !isNodeOfType(parent.id, "Identifier")
  ) {
    return null;
  }
  const symbol = context.scopes.symbolFor(parent.id);
  return symbol && getDirectUnreassignedInitializer(symbol) === node ? symbol : null;
};

const isUsableProgramCacheKey = (expression: EsTreeNode, context: RuleContext): boolean => {
  if (resolveExactLocalFunction(expression, context.scopes)) return true;
  let candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Identifier")) {
    if (candidate.name === "undefined" && context.scopes.isGlobalReference(candidate)) return false;
    const symbol = resolveConstIdentifierAlias(candidate, context.scopes);
    if (symbol?.kind !== "const" || !symbol.initializer) return true;
    candidate = stripParenExpression(symbol.initializer);
  }
  return !(
    isNodeOfType(candidate, "ArrayExpression") ||
    isNodeOfType(candidate, "ClassExpression") ||
    isNodeOfType(candidate, "Literal") ||
    isNodeOfType(candidate, "ObjectExpression") ||
    isNodeOfType(candidate, "TemplateLiteral") ||
    isNodeOfType(candidate, "UnaryExpression")
  );
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
      NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
        const constructorName = getThreeConstructorName(node, context.scopes);
        if (!constructorName?.endsWith("Material")) return;
        const options = node.arguments[0];
        if (!options || isNodeOfType(options, "SpreadElement")) return;
        const optionsObject = resolveStableOptionsObject(
          options,
          MATERIAL_PROGRAM_OPTION_NAMES,
          context.scopes,
          node,
        );
        if (!optionsObject) return;
        const properties = getEffectiveObjectPropertiesInInsertionOrder(optionsObject.properties);
        if (!properties) return;
        const cacheKeyProperty = properties.find(
          (property) =>
            getStaticPropertyKeyName(property, { allowComputedString: true }) ===
            "customProgramCacheKey",
        );
        const onBeforeCompileProperty = properties.find(
          (property) =>
            getStaticPropertyKeyName(property, { allowComputedString: true }) === "onBeforeCompile",
        );
        const materialSymbol = getConstructorMaterialSymbol(node, context);
        const hasConstructorCacheKey = Boolean(
          cacheKeyProperty && isUsableProgramCacheKey(cacheKeyProperty.value, context),
        );
        if (hasConstructorCacheKey && materialSymbol) {
          materialSymbolsWithCacheKeys.add(materialSymbol.id);
        }
        if (!onBeforeCompileProperty) return;
        const callback = resolveExactLocalFunction(onBeforeCompileProperty.value, context.scopes);
        if (!callback || !callbackHasVariantDependentPatch(callback, context)) return;
        candidates.push({
          hasConstructorCacheKey,
          materialSymbolId: materialSymbol?.id ?? null,
          node: onBeforeCompileProperty,
        });
      },
      AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
        if (!isNodeOfType(node.left, "MemberExpression")) return;
        const propertyName = getStaticPropertyName(node.left);
        if (propertyName !== "onBeforeCompile" && propertyName !== "customProgramCacheKey") {
          return;
        }
        const materialSymbol = getStableMaterialSymbol(node.left.object, context);
        if (!materialSymbol) return;
        if (propertyName === "customProgramCacheKey") {
          if (isUsableProgramCacheKey(node.right, context)) {
            materialSymbolsWithCacheKeys.add(materialSymbol.id);
          } else {
            materialSymbolsWithCacheKeys.delete(materialSymbol.id);
          }
          return;
        }
        const callback = resolveExactLocalFunction(node.right, context.scopes);
        if (!callback || !callbackHasVariantDependentPatch(callback, context)) return;
        candidates.push({
          hasConstructorCacheKey: false,
          materialSymbolId: materialSymbol.id,
          node,
        });
      },
      "Program:exit"() {
        for (const candidate of candidates) {
          if (
            (candidate.materialSymbolId === null && candidate.hasConstructorCacheKey) ||
            (candidate.materialSymbolId !== null &&
              materialSymbolsWithCacheKeys.has(candidate.materialSymbolId))
          ) {
            continue;
          }
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
