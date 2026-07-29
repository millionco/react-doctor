import type { Reference } from "eslint-scope";
import { COMPONENT_HOC_WRAPPER_NAMES, REACT_HOC_NAMES } from "../../constants/react.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { componentOrHookDisplayNameForFunction } from "../../utils/component-or-hook-display-name.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { executesDuringRender } from "../../utils/executes-during-render.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { functionHasReactComponentEvidence } from "../../utils/function-has-react-component-evidence.js";
import { getDestructuredBindingPropertyName } from "../../utils/get-destructured-binding-property-name.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { hasSymbolWriteBefore } from "../../utils/has-symbol-write-before.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { isResultDiscardedCall } from "../../utils/is-result-discarded-call.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { getDownstreamRefs, getUpstreamRefs } from "./utils/effect/ast.js";
import { getProgramAnalysis, type ProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import {
  isCustomHookParameter,
  isProp,
  isPropCallbackInvocationRef,
} from "./utils/effect/react.js";

interface CustomHookParameterBinding {
  functionNode: EsTreeNode;
  parameterIndex: number;
  propertyName?: string;
}

const functionBindingSymbols = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor[] => {
  let bindingIdentifier: EsTreeNode | null = null;
  if (isNodeOfType(functionNode, "FunctionDeclaration") && functionNode.id) {
    bindingIdentifier = functionNode.id;
  } else {
    let bindingExpression = findTransparentExpressionRoot(functionNode);
    let parent = bindingExpression.parent;
    while (isNodeOfType(parent, "CallExpression") && parent.arguments[0] === bindingExpression) {
      const callee = parent.callee;
      const wrapperName = isNodeOfType(callee, "Identifier")
        ? callee.name
        : isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")
          ? callee.property.name
          : null;
      const isReactWrapper = isReactApiCall(parent, REACT_HOC_NAMES, scopes, {
        allowGlobalReactNamespace: true,
        resolveNamedAliases: true,
      });
      if (
        !isReactWrapper &&
        (!wrapperName ||
          REACT_HOC_NAMES.has(wrapperName) ||
          !COMPONENT_HOC_WRAPPER_NAMES.has(wrapperName))
      ) {
        break;
      }
      bindingExpression = findTransparentExpressionRoot(parent);
      parent = bindingExpression.parent;
    }
    if (
      isNodeOfType(parent, "VariableDeclarator") &&
      parent.init === bindingExpression &&
      isNodeOfType(parent.id, "Identifier")
    ) {
      bindingIdentifier = parent.id;
    }
  }
  if (!bindingIdentifier) return [];
  let scope: ScopeAnalysis["rootScope"] | null = scopes.scopeFor(functionNode);
  while (scope) {
    const symbols = scope.symbols.filter(
      (symbol) => symbol.bindingIdentifier === bindingIdentifier,
    );
    if (symbols.length > 0) return symbols;
    scope = scope.parent;
  }
  return [];
};

const symbolHasReactComponentUse = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  if (visitedSymbolIds.has(symbol.id)) return false;
  visitedSymbolIds.add(symbol.id);
  for (const reference of symbol.references) {
    const identifier = reference.identifier;
    if (hasSymbolWriteBefore(symbol, identifier, scopes)) continue;
    const parent = identifier.parent;
    if (
      isNodeOfType(parent, "JSXOpeningElement") &&
      isNodeOfType(parent.name, "JSXIdentifier") &&
      parent.name === identifier
    ) {
      return true;
    }
    const expression = findTransparentExpressionRoot(identifier);
    const expressionParent = expression.parent;
    if (
      isNodeOfType(expressionParent, "CallExpression") &&
      expressionParent.arguments[0] === expression &&
      isReactApiCall(expressionParent, "createElement", scopes, { resolveNamedAliases: true })
    ) {
      return true;
    }
    if (
      !isNodeOfType(expressionParent, "VariableDeclarator") ||
      expressionParent.init !== expression ||
      !isNodeOfType(expressionParent.id, "Identifier") ||
      !isNodeOfType(expressionParent.parent, "VariableDeclaration") ||
      expressionParent.parent.kind !== "const"
    ) {
      continue;
    }
    const aliasSymbol = scopes.symbolFor(expressionParent.id);
    if (aliasSymbol && symbolHasReactComponentUse(aliasSymbol, scopes, visitedSymbolIds)) {
      return true;
    }
  }
  return false;
};

const functionHasReactComponentUse = (functionNode: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  return functionBindingSymbols(functionNode, scopes).some((symbol) =>
    symbolHasReactComponentUse(symbol, scopes),
  );
};

const patternContainsBinding = (pattern: EsTreeNode, binding: EsTreeNode): boolean => {
  let containsBinding = false;
  walkAst(pattern, (node) => {
    if (node !== binding) return;
    containsBinding = true;
    return false;
  });
  return containsBinding;
};

const customHookFunctionSymbol = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => functionBindingSymbols(functionNode, scopes)[0] ?? null;

const customHookParameterBinding = (reference: Reference): CustomHookParameterBinding | null => {
  const parameterDefinition = reference.resolved?.defs.find(
    (definition) => definition.type === "Parameter",
  );
  if (!parameterDefinition) return null;
  const functionNode = parameterDefinition.node as unknown as EsTreeNode;
  if (!isFunctionLike(functionNode)) return null;
  const parameterBinding = parameterDefinition.name as unknown as EsTreeNode;
  const parameterIndex = (functionNode.params ?? []).findIndex((parameter) =>
    patternContainsBinding(parameter, parameterBinding),
  );
  if (parameterIndex < 0) return null;
  const parameter = functionNode.params?.[parameterIndex];
  if (!parameter || !isNodeOfType(parameter, "ObjectPattern")) {
    return { functionNode, parameterIndex };
  }
  const propertyName = getDestructuredBindingPropertyName(parameterBinding);
  return propertyName ? { functionNode, parameterIndex, propertyName } : null;
};

const isDirectlyExportedFunction = (functionNode: EsTreeNode): boolean => {
  let ancestor = functionNode.parent;
  while (ancestor && !isNodeOfType(ancestor, "Program")) {
    if (
      isNodeOfType(ancestor, "ExportNamedDeclaration") ||
      isNodeOfType(ancestor, "ExportDefaultDeclaration")
    ) {
      return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
};

const customHookParameterUsesLegacyLocalAssumption = (
  reference: Reference,
  scopes: ScopeAnalysis,
): boolean => {
  const binding = customHookParameterBinding(reference);
  if (!binding) return false;
  const { functionNode } = binding;
  if (!isFunctionLike(functionNode) || isDirectlyExportedFunction(functionNode)) {
    return false;
  }
  const functionSymbol = customHookFunctionSymbol(functionNode, scopes);
  return Boolean(functionSymbol && functionSymbol.references.length === 0);
};

const referenceHasComponentPropOrigin = (
  analysis: ProgramAnalysis,
  reference: Reference,
  scopes: ScopeAnalysis,
  visitedReferences: ReadonlySet<Reference>,
): boolean =>
  getUpstreamRefs(analysis, reference).some((upstreamReference) => {
    if (isProp(analysis, upstreamReference) && !isCustomHookParameter(upstreamReference)) {
      return true;
    }
    return (
      isCustomHookParameter(upstreamReference) &&
      customHookParameterHasComponentPropCall(
        analysis,
        upstreamReference,
        scopes,
        visitedReferences,
      )
    );
  });

const argumentValueForParameterBinding = (
  argument: EsTreeNode,
  binding: CustomHookParameterBinding,
): EsTreeNode | null => {
  if (!binding.propertyName) return argument;
  let candidate = stripParenExpression(argument);
  if (isNodeOfType(candidate, "Identifier")) {
    const variableBinding = findVariableInitializer(candidate, candidate.name);
    if (
      variableBinding?.initializer &&
      isNodeOfType(variableBinding.bindingIdentifier.parent, "VariableDeclarator")
    ) {
      candidate = stripParenExpression(variableBinding.initializer);
    }
  }
  if (!isNodeOfType(candidate, "ObjectExpression")) return argument;
  const matchingProperty = candidate.properties.find(
    (property) =>
      isNodeOfType(property, "Property") &&
      getStaticPropertyKeyName(property, { allowComputedString: true }) === binding.propertyName,
  );
  return isNodeOfType(matchingProperty, "Property") ? matchingProperty.value : null;
};

const customHookParameterHasComponentPropCall = (
  analysis: ProgramAnalysis,
  reference: Reference,
  scopes: ScopeAnalysis,
  visitedReferences: ReadonlySet<Reference>,
): boolean => {
  if (visitedReferences.has(reference)) return false;
  const nextVisitedReferences = new Set(visitedReferences).add(reference);
  const binding = customHookParameterBinding(reference);
  if (!binding) return false;
  const { functionNode, parameterIndex } = binding;
  const functionSymbol = customHookFunctionSymbol(functionNode, scopes);
  if (!functionSymbol) return false;
  return functionSymbol.references.some((functionReference) => {
    const callExpression = functionReference.identifier.parent;
    if (
      !isNodeOfType(callExpression, "CallExpression") ||
      callExpression.callee !== functionReference.identifier
    ) {
      return false;
    }
    const argument = callExpression.arguments?.[parameterIndex];
    if (!argument || isNodeOfType(argument, "SpreadElement")) return false;
    const argumentValue = argumentValueForParameterBinding(argument, binding);
    if (!argumentValue) return false;
    return getDownstreamRefs(analysis, argumentValue).some((argumentReference) =>
      referenceHasComponentPropOrigin(analysis, argumentReference, scopes, nextVisitedReferences),
    );
  });
};

const hasProvenComponentPropOrigin = (
  analysis: ProgramAnalysis,
  reference: Reference,
  scopes: ScopeAnalysis,
): boolean => {
  const customHookParameterReferences = getUpstreamRefs(analysis, reference).filter(
    isCustomHookParameter,
  );
  if (customHookParameterReferences.length === 0) return true;
  return customHookParameterReferences.some(
    (parameterReference) =>
      customHookParameterUsesLegacyLocalAssumption(parameterReference, scopes) ||
      customHookParameterHasComponentPropCall(analysis, parameterReference, scopes, new Set()),
  );
};

const isPreservedThroughConciseArrow = (
  callExpression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  let node = callExpression;
  let parent = node.parent;
  while (parent) {
    if (isNodeOfType(parent, "ChainExpression")) {
      node = parent;
      parent = node.parent;
      continue;
    }
    if (isNodeOfType(parent, "LogicalExpression") && parent.right === node) {
      node = parent;
      parent = node.parent;
      continue;
    }
    if (
      isNodeOfType(parent, "ConditionalExpression") &&
      (parent.consequent === node || parent.alternate === node)
    ) {
      node = parent;
      parent = node.parent;
      continue;
    }
    if (isNodeOfType(parent, "SequenceExpression")) {
      const expressions = parent.expressions ?? [];
      if (expressions[expressions.length - 1] !== node) return false;
      node = parent;
      parent = node.parent;
      continue;
    }
    if (!isNodeOfType(parent, "ArrowFunctionExpression") || parent.body !== node) {
      return !isResultDiscardedCall(node);
    }
    const invocation = parent.parent;
    if (!isNodeOfType(invocation, "CallExpression") || !executesDuringRender(parent, scopes)) {
      return true;
    }
    if (invocation.arguments?.[0] === parent || invocation.arguments?.[1] === parent) {
      const callee = stripParenExpression(invocation.callee);
      return !(
        isNodeOfType(callee, "MemberExpression") &&
        !callee.computed &&
        isNodeOfType(callee.property, "Identifier") &&
        callee.property.name === "forEach" &&
        invocation.arguments[0] === parent
      );
    }
    node = invocation;
    parent = node.parent;
  }
  return false;
};

export const noPropCallbackInRender = defineRule({
  id: "no-prop-callback-in-render",
  title: "Prop callback invoked during render",
  severity: "error",
  recommendation:
    "Invoke the callback from the event or asynchronous operation that produced the value, or from an effect when synchronizing with an external system. Render must stay pure because React can replay or discard it.",
  create: (context) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isResultDiscardedCall(node)) return;
      if (isPreservedThroughConciseArrow(node, context.scopes)) return;
      const renderPhaseOwner = findRenderPhaseComponentOrHook(node, context.scopes);
      if (!renderPhaseOwner) return;
      const renderPhaseOwnerName = componentOrHookDisplayNameForFunction(renderPhaseOwner);
      if (
        !renderPhaseOwnerName ||
        (!isReactHookName(renderPhaseOwnerName) &&
          !functionHasReactComponentEvidence(renderPhaseOwner, context.scopes, context.cfg) &&
          !functionHasReactComponentUse(renderPhaseOwner, context.scopes))
      ) {
        return;
      }
      const analysis = getProgramAnalysis(node);
      if (!analysis) return;
      const callee = stripParenExpression(node.callee);
      if (isFunctionLike(callee)) return;
      if (
        !getDownstreamRefs(analysis, callee).some(
          (reference) =>
            isPropCallbackInvocationRef(analysis, reference, {
              nativeMethodScopes: context.scopes,
            }) && hasProvenComponentPropOrigin(analysis, reference, context.scopes),
        )
      ) {
        return;
      }
      context.report({
        node,
        message:
          "This prop callback runs during render. React can replay or discard render work, so the callback can fire more than once or for UI that never commits.",
      });
    },
  }),
});
