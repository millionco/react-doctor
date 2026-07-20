import {
  componentOrHookDisplayNameForFunction,
  findComponentHocExpressionRoot,
} from "../../utils/component-or-hook-display-name.js";
import { collectContextBindings } from "../../utils/collect-context-bindings.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getAssignedExpressionForWrite } from "../../utils/get-assigned-expression-for-write.js";
import { getFunctionBindingSymbols } from "../../utils/get-function-binding-symbols.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import type { BindingInfo } from "../../utils/find-variable-initializer.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { functionReturnsMatchingExpression } from "../../utils/function-returns-matching-expression.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOnUnconditionalPath } from "../../utils/has-static-property-write-before.js";
import { getSymbolWriteExecutionPathsBefore } from "../../utils/has-symbol-write-before.js";
import { isConstDeclaredBinding } from "../../utils/is-const-declared-binding.js";
import { isContextProviderJsxName } from "../../utils/is-context-provider-jsx-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeReachableWithinFunction } from "../../utils/is-node-reachable-within-function.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const MESSAGE =
  "Every consumer of this context redraws on each render because its `value` is a fresh object/array/function rebuilt each render — memoize it in component scope (extract mapped providers into a child component first), or move it outside the component.";
const JSX_CALLBACK_METHOD_NAMES: ReadonlySet<string> = new Set(["flatMap", "map"]);
const REACT_COMPONENT_WRAPPER_NAMES: ReadonlySet<string> = new Set(["forwardRef", "memo"]);
const REACT_MEMOIZATION_CALLBACK_NAMES: ReadonlySet<string> = new Set(["useCallback", "useMemo"]);
const REACT_RENDER_OUTPUT_NAMES: ReadonlySet<string> = new Set(["createElement"]);

const isFreshLiteralInitializer = (expression: EsTreeNode): boolean => {
  const stripped = stripParenExpression(expression);
  return (
    isNodeOfType(stripped, "ObjectExpression") ||
    isNodeOfType(stripped, "ArrayExpression") ||
    isNodeOfType(stripped, "ArrowFunctionExpression") ||
    isNodeOfType(stripped, "FunctionExpression") ||
    isNodeOfType(stripped, "FunctionDeclaration")
  );
};

// Parameter and destructuring defaults are conditional, so require the
// literal to be the direct declaration initializer.
const isDirectDeclarationInitializer = (
  binding: BindingInfo,
  referenceNode: EsTreeNode,
): boolean => {
  const declarationNode = binding.bindingIdentifier.parent;
  if (
    declarationNode &&
    isNodeOfType(declarationNode, "VariableDeclarator") &&
    declarationNode.init === binding.initializer &&
    binding.bindingIdentifier.range[0] < referenceNode.range[0] &&
    isNodeOnUnconditionalPath(declarationNode, binding.scopeOwner)
  ) {
    return true;
  }
  return Boolean(
    binding.initializer &&
    isNodeOfType(binding.initializer, "FunctionDeclaration") &&
    binding.initializer.id === binding.bindingIdentifier,
  );
};

// The function whose body re-runs to rebuild the binding. Block-scoped
// declarations (`if (x) { const value = {...} }`) report the block as
// scopeOwner; walk up to the owning function in that case.
const owningFunctionOfBinding = (binding: BindingInfo): EsTreeNode | null =>
  isFunctionLike(binding.scopeOwner)
    ? binding.scopeOwner
    : findEnclosingFunction(binding.scopeOwner);

const compareExecutionPaths = (
  left: ReadonlyArray<number>,
  right: ReadonlyArray<number>,
): number => {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
};

const isDefaultExportedFunction = (functionNode: EsTreeNode): boolean => {
  const root = findComponentHocExpressionRoot(functionNode);
  return Boolean(root.parent && isNodeOfType(root.parent, "ExportDefaultDeclaration"));
};

const isNamedInlineCallback = (functionNode: EsTreeNode): boolean => {
  if (!isNodeOfType(functionNode, "FunctionExpression") || !functionNode.id) return false;
  const directExpressionRoot = findTransparentExpressionRoot(functionNode);
  if (findComponentHocExpressionRoot(functionNode) !== directExpressionRoot) return false;
  const parent = directExpressionRoot.parent;
  return !(
    parent &&
    isNodeOfType(parent, "VariableDeclarator") &&
    parent.init === directExpressionRoot &&
    isNodeOfType(parent.id, "Identifier")
  );
};

const doesExpressionPreserveNodeValue = (
  expression: EsTreeNode,
  target: EsTreeNode,
  context: RuleContext,
): boolean => {
  const pendingExpressions = [expression];
  const visitedExpressions = new Set<EsTreeNode>();
  while (pendingExpressions.length > 0) {
    const nextExpression = pendingExpressions.pop();
    if (!nextExpression) continue;
    const candidate = stripParenExpression(nextExpression);
    if (candidate === target) return true;
    if (visitedExpressions.has(candidate)) continue;
    visitedExpressions.add(candidate);
    if (isNodeOfType(candidate, "ConditionalExpression")) {
      const test = stripParenExpression(candidate.test);
      if (isNodeOfType(test, "Literal")) {
        pendingExpressions.push(test.value ? candidate.consequent : candidate.alternate);
      } else {
        pendingExpressions.push(candidate.alternate, candidate.consequent);
      }
      continue;
    }
    if (isNodeOfType(candidate, "LogicalExpression")) {
      const left = stripParenExpression(candidate.left);
      if (isNodeOfType(left, "Literal")) {
        const doesUseRight =
          (candidate.operator === "&&" && Boolean(left.value)) ||
          (candidate.operator === "||" && !left.value) ||
          (candidate.operator === "??" && left.value === null);
        pendingExpressions.push(doesUseRight ? candidate.right : candidate.left);
        continue;
      }
      pendingExpressions.push(candidate.right);
      if (candidate.operator !== "&&") pendingExpressions.push(candidate.left);
      continue;
    }
    if (isNodeOfType(candidate, "SequenceExpression")) {
      const lastExpression = candidate.expressions.at(-1);
      if (lastExpression) pendingExpressions.push(lastExpression);
      continue;
    }
    if (isNodeOfType(candidate, "AssignmentExpression") && candidate.operator === "=") {
      pendingExpressions.push(candidate.right);
      continue;
    }
    if (isNodeOfType(candidate, "AwaitExpression") && candidate.argument) {
      pendingExpressions.push(candidate.argument);
      continue;
    }
    if (isNodeOfType(candidate, "ArrayExpression")) {
      for (const element of candidate.elements) {
        if (!element) continue;
        pendingExpressions.push(
          isNodeOfType(element, "SpreadElement") ? element.argument : element,
        );
      }
      continue;
    }
    if (
      isNodeOfType(candidate, "CallExpression") &&
      isReactApiCall(candidate, REACT_RENDER_OUTPUT_NAMES, context.scopes, {
        allowGlobalReactNamespace: true,
        resolveNamedAliases: true,
      })
    ) {
      pendingExpressions.push(...candidate.arguments.slice(2));
      const propsArgument = candidate.arguments[1];
      if (propsArgument && isNodeOfType(propsArgument, "ObjectExpression")) {
        for (const property of propsArgument.properties) {
          if (!isNodeOfType(property, "Property") || property.computed) continue;
          const key = property.key;
          if (
            (isNodeOfType(key, "Identifier") && key.name === "children") ||
            (isNodeOfType(key, "Literal") && key.value === "children")
          ) {
            pendingExpressions.push(property.value);
          }
        }
      }
      continue;
    }
    if (isNodeOfType(candidate, "Identifier")) {
      const binding = findVariableInitializer(candidate, candidate.name, {
        preferInitializerBeforeReference: true,
      });
      if (
        binding?.initializer &&
        isConstDeclaredBinding(binding) &&
        isDirectDeclarationInitializer(binding, candidate) &&
        findEnclosingFunction(binding.bindingIdentifier) === findEnclosingFunction(candidate) &&
        context.cfg.isUnconditionalFromEntry(binding.bindingIdentifier)
      ) {
        pendingExpressions.push(binding.initializer);
      }
      continue;
    }
    if (isNodeOfType(candidate, "JSXElement") || isNodeOfType(candidate, "JSXFragment")) {
      pendingExpressions.push(...candidate.children);
      continue;
    }
    if (
      isNodeOfType(candidate, "JSXExpressionContainer") &&
      candidate.expression.type !== "JSXEmptyExpression"
    ) {
      pendingExpressions.push(candidate.expression);
    }
  }
  return false;
};

const doesCallResultReachFunctionOutput = (
  call: EsTreeNodeOfType<"CallExpression">,
  functionNode: EsTreeNode,
  context: RuleContext,
): boolean =>
  functionReturnsMatchingExpression(
    functionNode,
    context.scopes,
    (expression) => doesExpressionPreserveNodeValue(expression, call, context),
    context.cfg,
  );

const isKnownJsxCallbackArgument = (
  call: EsTreeNodeOfType<"CallExpression">,
  argument: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (
    call.arguments[0] === argument &&
    isReactApiCall(call, REACT_MEMOIZATION_CALLBACK_NAMES, context.scopes, {
      allowGlobalReactNamespace: true,
      resolveNamedAliases: true,
    })
  ) {
    return true;
  }
  return Boolean(
    isNodeOfType(call.callee, "MemberExpression") &&
    JSX_CALLBACK_METHOD_NAMES.has(getStaticPropertyName(call.callee) ?? ""),
  );
};

const isArgumentRenderedSynchronously = (
  call: EsTreeNodeOfType<"CallExpression">,
  argument: EsTreeNode,
  context: RuleContext,
): boolean => {
  const argumentIndex = call.arguments.findIndex((candidate) => candidate === argument);
  if (argumentIndex < 0) return false;
  const calledFunction = resolveExactLocalFunction(call.callee, context.scopes);
  if (
    !calledFunction ||
    !isFunctionLike(calledFunction) ||
    calledFunction.async ||
    calledFunction.generator
  ) {
    return false;
  }
  const parameter = calledFunction.params[argumentIndex];
  if (!parameter || !isNodeOfType(parameter, "Identifier")) return false;
  const parameterSymbol = context.scopes
    .ownScopeFor(calledFunction)
    ?.symbolsByName.get(parameter.name);
  const doesReturnSynchronousArgumentResult = Boolean(
    parameterSymbol?.references.some((reference) => {
      const callee = findTransparentExpressionRoot(reference.identifier);
      const parameterCall = callee.parent;
      return Boolean(
        parameterCall &&
        isNodeOfType(parameterCall, "CallExpression") &&
        parameterCall.callee === callee &&
        findEnclosingFunction(parameterCall) === calledFunction &&
        isNodeOnUnconditionalPath(parameterCall, calledFunction) &&
        context.cfg.isUnconditionalFromEntry(parameterCall) &&
        doesCallResultReachFunctionOutput(parameterCall, calledFunction, context),
      );
    }),
  );
  if (!doesReturnSynchronousArgumentResult) return false;
  const enclosingRenderFunction = findEnclosingFunction(call);
  return Boolean(
    enclosingRenderFunction &&
    (componentOrHookDisplayNameForFunction(enclosingRenderFunction) !== null ||
      isDefaultExportedFunction(enclosingRenderFunction)) &&
    doesCallResultReachFunctionOutput(call, enclosingRenderFunction, context),
  );
};

const isCallbackOnlyFunctionBinding = (functionNode: EsTreeNode, context: RuleContext): boolean => {
  const symbols = getFunctionBindingSymbols(functionNode, context.scopes);
  const references = symbols.flatMap((symbol) => symbol.references);
  if (references.length === 0) return false;
  return references.every((reference) => {
    const argument = findTransparentExpressionRoot(reference.identifier);
    const call = argument.parent;
    if (!call || !isNodeOfType(call, "CallExpression")) return false;
    if (!call.arguments.some((candidate) => candidate === argument)) return false;
    if (
      call.arguments[0] === argument &&
      isReactApiCall(call, REACT_COMPONENT_WRAPPER_NAMES, context.scopes, {
        allowGlobalReactNamespace: true,
        resolveNamedAliases: true,
      })
    ) {
      return false;
    }
    return (
      isKnownJsxCallbackArgument(call, argument, context) ||
      !isArgumentRenderedSynchronously(call, argument, context)
    );
  });
};

const isSynchronouslyInvokedInlineRenderFunction = (
  functionNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  const functionExpression = findTransparentExpressionRoot(functionNode);
  const call = functionExpression.parent;
  if (!call || !isNodeOfType(call, "CallExpression")) return false;
  const enclosingRenderFunction = findEnclosingFunction(call);
  if (
    !enclosingRenderFunction ||
    (componentOrHookDisplayNameForFunction(enclosingRenderFunction) === null &&
      !isDefaultExportedFunction(enclosingRenderFunction))
  ) {
    return false;
  }
  if (
    call.arguments[0] === functionExpression &&
    isNodeOfType(call.callee, "MemberExpression") &&
    JSX_CALLBACK_METHOD_NAMES.has(getStaticPropertyName(call.callee) ?? "") &&
    doesCallResultReachFunctionOutput(call, enclosingRenderFunction, context)
  ) {
    return true;
  }
  return (
    (call.callee === functionExpression &&
      doesCallResultReachFunctionOutput(call, enclosingRenderFunction, context)) ||
    (call.arguments.some((argument) => argument === functionExpression) &&
      isArgumentRenderedSynchronously(call, functionExpression, context))
  );
};

// `jsx-no-constructed-context-values` owns inline literals. This rule
// handles one-hop identifiers bound in the same render scope.
export const contextProviderValueFromUnmemoizedLocalLiteral = defineRule({
  id: "context-provider-value-from-unmemoized-local-literal",
  title: "Context value from an unmemoized local literal",
  tags: ["react-jsx-only", "test-noise"],
  severity: "warn",
  category: "Performance",
  disabledWhen: ["react-compiler"],
  recommendation:
    "Memoize the context value in component scope so consumers do not redraw every render. For mapped providers, extract each item into a child component and memoize there.",
  create: (context: RuleContext) => {
    const isTestlikeFile = isTestlikeFilename(context.filename);
    const isProvenSynchronousNode = (node: EsTreeNode): boolean =>
      context.cfg.isUnconditionalFromEntry(node) && isNodeReachableWithinFunction(node, context);
    let contextBindings: ReadonlySet<number> = new Set<number>();
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        contextBindings = collectContextBindings(node, context.scopes);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (isTestlikeFile) return;
        if (!isContextProviderJsxName(node.name, contextBindings, context.scopes)) return;
        const renderFunction = findEnclosingFunction(node);
        if (!renderFunction) return;
        const isSynchronousInlineRenderFunction = isSynchronouslyInvokedInlineRenderFunction(
          renderFunction,
          context,
        );
        const isDefaultExportedRenderFunction = isDefaultExportedFunction(renderFunction);
        if (
          (isNamedInlineCallback(renderFunction) ||
            isCallbackOnlyFunctionBinding(renderFunction, context)) &&
          !isSynchronousInlineRenderFunction &&
          !isDefaultExportedRenderFunction
        ) {
          return;
        }
        if (
          componentOrHookDisplayNameForFunction(renderFunction) === null &&
          !isDefaultExportedRenderFunction &&
          !isSynchronousInlineRenderFunction
        ) {
          return;
        }

        const attribute = findJsxAttribute(node.attributes, "value");
        if (!attribute) return;
        const attributeValue = attribute.value;
        if (!attributeValue || !isNodeOfType(attributeValue, "JSXExpressionContainer")) return;
        const inner = stripParenExpression(attributeValue.expression);
        if (!isNodeOfType(inner, "Identifier")) return;
        const symbol = context.scopes.symbolFor(inner);
        if (!symbol) return;
        const reachingWrite = symbol.references
          .flatMap((reference) =>
            reference.flag === "read"
              ? []
              : getSymbolWriteExecutionPathsBefore(reference.identifier, inner, context.scopes, {
                  requireSynchronousWrite: true,
                  isSynchronousNode: isProvenSynchronousNode,
                }).map((executionPath) => ({
                  executionPath,
                  assignedExpression: getAssignedExpressionForWrite(reference.identifier),
                })),
          )
          .toSorted((left, right) => compareExecutionPaths(right.executionPath, left.executionPath))
          .at(0);
        if (reachingWrite) {
          if (
            !reachingWrite.assignedExpression ||
            !isFreshLiteralInitializer(reachingWrite.assignedExpression)
          ) {
            return;
          }
          context.report({ node: attribute, message: MESSAGE });
          return;
        }

        const binding = findVariableInitializer(inner, inner.name, {
          preferInitializerBeforeReference: true,
        });
        if (!binding || !binding.initializer) return;
        if (binding.scopeOwner.type === "Program") return;
        if (!isDirectDeclarationInitializer(binding, inner)) return;
        if (owningFunctionOfBinding(binding) !== renderFunction) return;
        if (!isFreshLiteralInitializer(binding.initializer)) return;

        context.report({ node: attribute, message: MESSAGE });
      },
    };
  },
});
