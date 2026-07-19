import { componentOrHookDisplayNameForFunction } from "./component-or-hook-display-name.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveInkApiName } from "./resolve-ink-api-name.js";
import type { RuleContext } from "./rule-context.js";
import { walkAst } from "./walk-ast.js";

interface InkRenderCall {
  node: EsTreeNodeOfType<"CallExpression">;
  renderedComponentName: string | null;
}

const getRenderedComponentName = (
  renderCall: EsTreeNodeOfType<"CallExpression">,
): string | null => {
  const renderedNode = renderCall.arguments[0];
  return isNodeOfType(renderedNode, "JSXElement") &&
    isNodeOfType(renderedNode.openingElement.name, "JSXIdentifier")
    ? renderedNode.openingElement.name.name
    : null;
};

export const collectInkRenderCalls = (
  program: EsTreeNode,
  context: RuleContext,
): ReadonlyArray<InkRenderCall> => {
  const renderCalls: InkRenderCall[] = [];
  walkAst(program, (descendantNode) => {
    if (
      !isNodeOfType(descendantNode, "CallExpression") ||
      resolveInkApiName(descendantNode.callee, context.scopes) !== "render"
    ) {
      return;
    }
    renderCalls.push({
      node: descendantNode,
      renderedComponentName: getRenderedComponentName(descendantNode),
    });
  });
  return renderCalls;
};

export const hasInkRenderBooleanOption = (
  renderCall: EsTreeNodeOfType<"CallExpression">,
  optionName: string,
  expectedValue: boolean,
): boolean => {
  const optionsNode = renderCall.arguments[1];
  return Boolean(
    isNodeOfType(optionsNode, "ObjectExpression") &&
    optionsNode.properties.some(
      (propertyNode) =>
        isNodeOfType(propertyNode, "Property") &&
        getStaticPropertyKeyName(propertyNode, { allowComputedString: true }) === optionName &&
        isNodeOfType(propertyNode.value, "Literal") &&
        propertyNode.value.value === expectedValue,
    ),
  );
};

export const resolveInkRenderCallsForNode = (
  node: EsTreeNode,
  renderCalls: ReadonlyArray<InkRenderCall>,
): ReadonlyArray<InkRenderCall> => {
  const directRenderCalls = renderCalls.filter((renderCall) => {
    const renderedNode = renderCall.node.arguments[0];
    return (
      renderedNode !== undefined &&
      renderedNode.range[0] <= node.range[0] &&
      renderedNode.range[1] >= node.range[1]
    );
  });
  if (directRenderCalls.length > 0) return directRenderCalls;

  const enclosingFunction = findEnclosingFunction(node);
  const componentName = enclosingFunction
    ? componentOrHookDisplayNameForFunction(enclosingFunction)
    : null;
  if (componentName) {
    const componentRenderCalls = renderCalls.filter(
      (renderCall) => renderCall.renderedComponentName === componentName,
    );
    if (componentRenderCalls.length > 0) return componentRenderCalls;
  }

  return renderCalls.length === 1 ? renderCalls : [];
};
