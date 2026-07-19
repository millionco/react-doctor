import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { createRemotionMetadataOwnershipAnalyzer } from "../../utils/create-remotion-composition-ownership-analyzer.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getImportBindingForName } from "../../utils/find-import-source-for-name.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveRemotionApi } from "../../utils/resolve-remotion-api.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

interface AbortSignalBinding {
  parameterIdentifier: EsTreeNode | null;
  signalIdentifier: EsTreeNode | null;
}

const getParameterIdentifier = (parameter: EsTreeNode | null | undefined): EsTreeNode | null => {
  if (isNodeOfType(parameter, "Identifier")) return parameter;
  if (isNodeOfType(parameter, "AssignmentPattern") && isNodeOfType(parameter.left, "Identifier")) {
    return parameter.left;
  }
  return null;
};

const getAbortSignalBinding = (functionNode: EsTreeNode): AbortSignalBinding => {
  if (!isFunctionLike(functionNode)) {
    return { parameterIdentifier: null, signalIdentifier: null };
  }
  const firstParameter = functionNode.params[0];
  const parameterIdentifier = getParameterIdentifier(firstParameter);
  if (parameterIdentifier) {
    return { parameterIdentifier, signalIdentifier: null };
  }
  if (!isNodeOfType(firstParameter, "ObjectPattern")) {
    return { parameterIdentifier: null, signalIdentifier: null };
  }
  for (const property of firstParameter.properties) {
    if (!isNodeOfType(property, "Property")) continue;
    if (getStaticPropertyKeyName(property) !== "abortSignal") continue;
    const signalIdentifier = getParameterIdentifier(property.value);
    if (signalIdentifier) return { parameterIdentifier: null, signalIdentifier };
  }
  return { parameterIdentifier: null, signalIdentifier: null };
};

const identifiersResolveToSameSymbol = (
  leftIdentifier: EsTreeNode,
  rightIdentifier: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(leftIdentifier, "Identifier") || !isNodeOfType(rightIdentifier, "Identifier")) {
    return false;
  }
  const leftSymbol = scopes.symbolFor(leftIdentifier);
  return Boolean(leftSymbol && leftSymbol === scopes.symbolFor(rightIdentifier));
};

const isMetadataAbortSignal = (
  expression: EsTreeNode,
  binding: AbortSignalBinding,
  scopes: ScopeAnalysis,
): boolean => {
  const candidate = stripParenExpression(expression);
  if (
    binding.signalIdentifier &&
    identifiersResolveToSameSymbol(candidate, binding.signalIdentifier, scopes)
  ) {
    return true;
  }
  return Boolean(
    binding.parameterIdentifier &&
    isNodeOfType(candidate, "MemberExpression") &&
    getStaticPropertyKeyName(candidate, { allowComputedString: true }) === "abortSignal" &&
    identifiersResolveToSameSymbol(candidate.object, binding.parameterIdentifier, scopes),
  );
};

const fetchUsesMetadataAbortSignal = (
  fetchCall: EsTreeNodeOfType<"CallExpression">,
  binding: AbortSignalBinding,
  scopes: ScopeAnalysis,
): boolean | null => {
  const optionsArgument = fetchCall.arguments[1];
  if (!optionsArgument) return false;
  const options = stripParenExpression(optionsArgument);
  if (!isNodeOfType(options, "ObjectExpression")) return null;
  if (options.properties.some((property) => isNodeOfType(property, "SpreadElement"))) return null;
  for (let propertyIndex = options.properties.length - 1; propertyIndex >= 0; propertyIndex -= 1) {
    const property = options.properties[propertyIndex];
    if (
      isNodeOfType(property, "Property") &&
      getStaticPropertyKeyName(property, { allowComputedString: true }) === "signal"
    ) {
      return isMetadataAbortSignal(property.value, binding, scopes);
    }
  }
  return false;
};

const reportFetchesWithoutAbortSignal = (functionNode: EsTreeNode, context: RuleContext): void => {
  const binding = getAbortSignalBinding(functionNode);
  walkAst(functionNode, (candidate) => {
    if (candidate !== functionNode && isFunctionLike(candidate)) return false;
    if (
      !isNodeOfType(candidate, "CallExpression") ||
      !isNodeOfType(candidate.callee, "Identifier") ||
      candidate.callee.name !== "fetch" ||
      !context.scopes.isGlobalReference(candidate.callee) ||
      fetchUsesMetadataAbortSignal(candidate, binding, context.scopes) !== false
    ) {
      return;
    }
    context.report({
      node: candidate,
      message:
        "Pass Remotion's `abortSignal` to this fetch with `{signal: abortSignal}` so superseded metadata requests are cancelled.",
    });
  });
};

const isCalculateMetadataFunctionType = (
  variableDeclarator: EsTreeNodeOfType<"VariableDeclarator">,
): boolean => {
  if (!isNodeOfType(variableDeclarator.id, "Identifier")) return false;
  const annotation = variableDeclarator.id.typeAnnotation;
  if (
    !isNodeOfType(annotation, "TSTypeAnnotation") ||
    !isNodeOfType(annotation.typeAnnotation, "TSTypeReference")
  ) {
    return false;
  }
  const typeName = annotation.typeAnnotation.typeName;
  if (!isNodeOfType(typeName, "Identifier")) return false;
  const apiBinding = getImportBindingForName(typeName, typeName.name);
  return Boolean(
    apiBinding?.exportedName === "CalculateMetadataFunction" && apiBinding.source === "remotion",
  );
};

export const remotionCalculateMetadataFetchSignal = defineRule({
  id: "remotion-calculate-metadata-fetch-signal",
  title: "calculateMetadata fetch ignores abortSignal",
  tags: ["react-jsx-only"],
  requires: ["remotion:4"],
  severity: "error",
  recommendation:
    "Destructure `abortSignal` from the calculateMetadata argument and pass it to direct fetch calls as `{signal: abortSignal}`.",
  create: (context) => {
    const analyzedFunctions = new WeakSet<object>();
    const isOwnedByCalculateMetadata = createRemotionMetadataOwnershipAnalyzer(context);
    const analyzeFunction = (functionNode: EsTreeNode | null): void => {
      if (!functionNode || analyzedFunctions.has(functionNode)) return;
      analyzedFunctions.add(functionNode);
      reportFetchesWithoutAbortSignal(functionNode, context);
    };

    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (
          !isNodeOfType(node.callee, "Identifier") ||
          node.callee.name !== "fetch" ||
          !context.scopes.isGlobalReference(node.callee)
        ) {
          return;
        }
        const functionNode = findEnclosingFunction(node);
        if (functionNode && isOwnedByCalculateMetadata(functionNode)) {
          analyzeFunction(functionNode);
        }
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const apiBinding = resolveRemotionApi(node.name, context.scopes);
        if (apiBinding?.apiName !== "Composition" || apiBinding.moduleSource !== "remotion") return;
        const calculateMetadataAttribute = findJsxAttribute(node.attributes, "calculateMetadata");
        if (
          !calculateMetadataAttribute?.value ||
          !isNodeOfType(calculateMetadataAttribute.value, "JSXExpressionContainer") ||
          !calculateMetadataAttribute.value.expression
        ) {
          return;
        }
        analyzeFunction(
          resolveExactLocalFunction(calculateMetadataAttribute.value.expression, context.scopes),
        );
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!node.init || !isCalculateMetadataFunctionType(node)) return;
        analyzeFunction(resolveExactLocalFunction(node.init, context.scopes));
      },
    };
  },
});
