import { componentOrHookDisplayNameForFunction } from "./component-or-hook-display-name.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeReachableWithinFunction } from "./is-node-reachable-within-function.js";
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

const canRenderComponent = (
  componentNameNode: EsTreeNodeOfType<"JSXIdentifier">,
  targetComponentName: string,
  context: RuleContext,
  visitedSymbolIds: Set<number>,
): boolean => {
  if (componentNameNode.name === targetComponentName) return true;
  const symbol = context.scopes.symbolFor(componentNameNode);
  if (!symbol || symbol.kind === "import" || visitedSymbolIds.has(symbol.id)) return false;
  visitedSymbolIds.add(symbol.id);
  const componentDefinition = symbol.initializer;
  if (!componentDefinition) return false;

  let canReachTarget = false;
  walkAst(componentDefinition, (descendantNode) => {
    if (
      descendantNode !== componentDefinition &&
      (/Function/.test(descendantNode.type) || isNodeOfType(descendantNode, "JSXAttribute"))
    ) {
      return false;
    }
    if (
      !isNodeOfType(descendantNode, "JSXOpeningElement") ||
      !isNodeOfType(descendantNode.name, "JSXIdentifier") ||
      !isNodeReachableWithinFunction(descendantNode, context)
    ) {
      return;
    }
    if (canRenderComponent(descendantNode.name, targetComponentName, context, visitedSymbolIds)) {
      canReachTarget = true;
      return false;
    }
  });
  return canReachTarget;
};

const renderCallCanMountComponent = (
  renderCall: InkRenderCall,
  targetComponentName: string,
  context: RuleContext,
): boolean => {
  const renderedNode = renderCall.node.arguments[0];
  if (!renderedNode) return false;
  let canMountTarget = false;
  walkAst(renderedNode, (descendantNode) => {
    if (
      descendantNode !== renderedNode &&
      (/Function/.test(descendantNode.type) || isNodeOfType(descendantNode, "JSXAttribute"))
    ) {
      return false;
    }
    if (
      !isNodeOfType(descendantNode, "JSXOpeningElement") ||
      !isNodeOfType(descendantNode.name, "JSXIdentifier") ||
      !isNodeReachableWithinFunction(descendantNode, context)
    ) {
      return;
    }
    if (canRenderComponent(descendantNode.name, targetComponentName, context, new Set())) {
      canMountTarget = true;
      return false;
    }
  });
  return canMountTarget;
};

export const collectInkRenderCalls = (
  program: EsTreeNode,
  context: RuleContext,
  apiName: "render" | "renderToString" = "render",
): ReadonlyArray<InkRenderCall> => {
  const renderCalls: InkRenderCall[] = [];
  walkAst(program, (descendantNode) => {
    if (
      !isNodeOfType(descendantNode, "CallExpression") ||
      resolveInkApiName(descendantNode.callee, context.scopes) !== apiName ||
      !isNodeReachableWithinFunction(descendantNode, context)
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

export const getInkRenderBooleanOption = (
  renderCall: EsTreeNodeOfType<"CallExpression">,
  optionName: string,
  defaultValue: boolean,
): boolean | null => {
  const optionsNode = renderCall.arguments[1];
  if (!optionsNode) return defaultValue;
  if (!isNodeOfType(optionsNode, "ObjectExpression")) return null;

  let resolvedValue: boolean | null = defaultValue;
  for (const propertyNode of optionsNode.properties) {
    if (isNodeOfType(propertyNode, "SpreadElement")) {
      resolvedValue = null;
      continue;
    }
    if (!isNodeOfType(propertyNode, "Property")) continue;
    const propertyName = getStaticPropertyKeyName(propertyNode, {
      allowComputedString: true,
    });
    if (propertyName === null) {
      if (propertyNode.computed) resolvedValue = null;
      continue;
    }
    if (propertyName !== optionName) continue;
    resolvedValue =
      isNodeOfType(propertyNode.value, "Literal") && typeof propertyNode.value.value === "boolean"
        ? propertyNode.value.value
        : null;
  }
  return resolvedValue;
};

export const resolveInkRenderCallsForNode = (
  node: EsTreeNode,
  renderCalls: ReadonlyArray<InkRenderCall>,
  context: RuleContext,
): ReadonlyArray<InkRenderCall> => {
  if (!isNodeReachableWithinFunction(node, context)) return [];
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
      (renderCall) =>
        renderCall.renderedComponentName === componentName ||
        renderCallCanMountComponent(renderCall, componentName, context),
    );
    if (componentRenderCalls.length > 0) return componentRenderCalls;
  }

  return [];
};
