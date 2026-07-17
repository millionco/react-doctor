import {
  componentOrHookDisplayNameForFunction,
  findComponentHocExpressionRoot,
} from "../../utils/component-or-hook-display-name.js";
import { collectContextBindings } from "../../utils/collect-context-bindings.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getFunctionBindingSymbols } from "../../utils/get-function-binding-symbols.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import type { BindingInfo } from "../../utils/find-variable-initializer.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOnUnconditionalPath } from "../../utils/has-static-property-write-before.js";
import { hasSymbolWriteBefore } from "../../utils/has-symbol-write-before.js";
import { isContextProviderJsxName } from "../../utils/is-context-provider-jsx-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const MESSAGE =
  "Every consumer of this context redraws on each render because its `value` is a fresh object/array/function rebuilt each render — wrap it in useMemo/useCallback (or move it out of the component).";
const JSX_CALLBACK_METHOD_NAMES: ReadonlySet<string> = new Set(["flatMap", "map"]);
const REACT_COMPONENT_WRAPPER_NAMES: ReadonlySet<string> = new Set(["forwardRef", "memo"]);
const REACT_MEMOIZATION_CALLBACK_NAMES: ReadonlySet<string> = new Set(["useCallback", "useMemo"]);

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

const isDefaultExportedFunction = (functionNode: EsTreeNode): boolean => {
  const root = findComponentHocExpressionRoot(functionNode);
  return Boolean(root.parent && isNodeOfType(root.parent, "ExportDefaultDeclaration"));
};

const isNamedInlineCallback = (functionNode: EsTreeNode): boolean => {
  if (!isNodeOfType(functionNode, "FunctionExpression") || !functionNode.id) return false;
  const directExpressionRoot = findTransparentExpressionRoot(functionNode);
  if (findComponentHocExpressionRoot(functionNode) !== directExpressionRoot) return false;
  const parent = directExpressionRoot.parent;
  if (parent && isNodeOfType(parent, "CallExpression") && parent.callee === directExpressionRoot) {
    return false;
  }
  return !(
    parent &&
    isNodeOfType(parent, "VariableDeclarator") &&
    parent.init === directExpressionRoot &&
    isNodeOfType(parent.id, "Identifier")
  );
};

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

const isArgumentSynchronouslyInvoked = (
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
  return Boolean(
    parameterSymbol?.references.some((reference) => {
      const callee = findTransparentExpressionRoot(reference.identifier);
      const parameterCall = callee.parent;
      return Boolean(
        parameterCall &&
        isNodeOfType(parameterCall, "CallExpression") &&
        parameterCall.callee === callee &&
        findEnclosingFunction(parameterCall) === calledFunction &&
        isNodeOnUnconditionalPath(parameterCall, calledFunction) &&
        context.cfg.isUnconditionalFromEntry(parameterCall),
      );
    }),
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
      !isArgumentSynchronouslyInvoked(call, argument, context)
    );
  });
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
    "Wrap the context value in useMemo/useCallback so consumers do not redraw every render, or move it outside the component if it never changes.",
  create: (context: RuleContext) => {
    const isTestlikeFile = isTestlikeFilename(context.filename);
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
        if (
          isNamedInlineCallback(renderFunction) ||
          isCallbackOnlyFunctionBinding(renderFunction, context)
        ) {
          return;
        }
        if (
          componentOrHookDisplayNameForFunction(renderFunction) === null &&
          !isDefaultExportedFunction(renderFunction)
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
        if (
          !symbol ||
          hasSymbolWriteBefore(symbol, inner, context.scopes, { requireSynchronousWrite: true })
        ) {
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
