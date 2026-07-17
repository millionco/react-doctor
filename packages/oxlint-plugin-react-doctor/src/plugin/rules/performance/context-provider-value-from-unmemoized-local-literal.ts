import {
  componentOrHookDisplayNameForFunction,
  findComponentHocExpressionRoot,
} from "../../utils/component-or-hook-display-name.js";
import { collectContextBindings } from "../../utils/collect-context-bindings.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import type { BindingInfo } from "../../utils/find-variable-initializer.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { hasSymbolWriteBefore } from "../../utils/has-symbol-write-before.js";
import { isContextProviderJsxName } from "../../utils/is-context-provider-jsx-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const MESSAGE =
  "Every consumer of this context redraws on each render because its `value` is a fresh object/array/function rebuilt each render — wrap it in useMemo/useCallback (or move it out of the component).";

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
const isDirectDeclarationInitializer = (binding: BindingInfo): boolean => {
  const declarationNode = binding.bindingIdentifier.parent;
  if (
    declarationNode &&
    isNodeOfType(declarationNode, "VariableDeclarator") &&
    declarationNode.init === binding.initializer
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
  return !(
    parent &&
    isNodeOfType(parent, "VariableDeclarator") &&
    parent.init === directExpressionRoot &&
    isNodeOfType(parent.id, "Identifier")
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
    "Wrap the context value in useMemo/useCallback so consumers do not redraw every render, or move it outside the component if it never changes.",
  create: (context: RuleContext) => {
    const isTestlikeFile = isTestlikeFilename(context.filename);
    let contextBindings: ReadonlySet<string> = new Set<string>();
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        contextBindings = collectContextBindings(node, context.scopes);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (isTestlikeFile) return;
        if (!isContextProviderJsxName(node.name, contextBindings, context.scopes)) return;
        const renderFunction = findEnclosingFunction(node);
        if (!renderFunction) return;
        if (isNamedInlineCallback(renderFunction)) return;
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
        if (!symbol || hasSymbolWriteBefore(symbol, inner, context.scopes)) return;

        const binding = findVariableInitializer(inner, inner.name);
        if (!binding || !binding.initializer) return;
        if (binding.scopeOwner.type === "Program") return;
        if (!isDirectDeclarationInitializer(binding)) return;
        if (owningFunctionOfBinding(binding) !== renderFunction) return;
        if (!isFreshLiteralInitializer(binding.initializer)) return;

        context.report({ node: attribute, message: MESSAGE });
      },
    };
  },
});
