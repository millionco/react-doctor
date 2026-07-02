import { defineRule } from "../../utils/define-rule.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isCreateElementCall } from "../../utils/is-create-element-call.js";
import { isMeaningfulJsxChild } from "../../utils/is-meaningful-jsx-child.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isNullishExpression } from "../../utils/is-nullish-expression.js";

const MESSAGE = "React throws an error when you set both children & `dangerouslySetInnerHTML`.";

interface PropsShape {
  hasDangerously: boolean;
  hasChildren: boolean;
}

const mergePropsShape = (target: PropsShape, source: PropsShape): void => {
  target.hasDangerously ||= source.hasDangerously;
  target.hasChildren ||= source.hasChildren;
};

const getStaticPropName = (key: EsTreeNode): string | null => {
  if (isNodeOfType(key, "Identifier")) return key.name;
  if (isNodeOfType(key, "Literal") && typeof key.value === "string") return key.value;
  return null;
};

const resolvePropsShape = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): PropsShape => {
  if (isNodeOfType(expression, "Identifier")) {
    const symbol = scopes.symbolFor(expression);
    if (!symbol || visitedSymbolIds.has(symbol.id) || !symbol.initializer) {
      return { hasDangerously: false, hasChildren: false };
    }
    visitedSymbolIds.add(symbol.id);
    return resolvePropsShape(symbol.initializer, scopes, visitedSymbolIds);
  }

  if (!isNodeOfType(expression, "ObjectExpression")) {
    return { hasDangerously: false, hasChildren: false };
  }

  const shape: PropsShape = { hasDangerously: false, hasChildren: false };
  for (const property of expression.properties) {
    if (isNodeOfType(property, "SpreadElement")) {
      mergePropsShape(
        shape,
        resolvePropsShape(property.argument as EsTreeNode, scopes, visitedSymbolIds),
      );
      continue;
    }
    if (!isNodeOfType(property, "Property") || property.computed) continue;
    const propName = getStaticPropName(property.key as EsTreeNode);
    if (propName === "dangerouslySetInnerHTML") shape.hasDangerously = true;
    if (propName === "children") shape.hasChildren = true;
  }
  return shape;
};

const resolveJsxSpreadPropsShape = (
  attributes: ReadonlyArray<EsTreeNode>,
  scopes: ScopeAnalysis,
): PropsShape => {
  const shape: PropsShape = { hasDangerously: false, hasChildren: false };
  for (const attribute of attributes) {
    if (!isNodeOfType(attribute, "JSXSpreadAttribute")) continue;
    mergePropsShape(shape, resolvePropsShape(attribute.argument as EsTreeNode, scopes));
  }
  return shape;
};

// True when the child survives the JSX transform as an entry of
// `props.children` — even a nullish one (`{null}`). React's conflict
// guard is `props.children != null`, so TWO surviving children form an
// array that is `!= null` regardless of the entries' values; only a
// SINGLE surviving child collapses to its own (possibly null) value.
const isRuntimeJsxChild = (child: EsTreeNode): boolean => {
  if (isNodeOfType(child, "JSXText")) {
    if (child.value.trim().length > 0) return true;
    return !child.value.includes("\n");
  }
  if (isNodeOfType(child, "JSXExpressionContainer")) {
    return !isNodeOfType(child.expression, "JSXEmptyExpression");
  }
  return true;
};

// Port of `oxc_linter::rules::react::no_danger_with_children`. Reports
// when the same JSX element / createElement call has BOTH a `children`
// prop / nested children AND `dangerouslySetInnerHTML`.
export const noDangerWithChildren = defineRule({
  id: "no-danger-with-children",
  title: "dangerouslySetInnerHTML with children",
  severity: "error",
  recommendation:
    "Use either `children` or `dangerouslySetInnerHTML` so React does not ignore one source of content.",
  category: "Correctness",
  create: (context) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      const opening = node.openingElement;
      const spreadPropsShape = resolveJsxSpreadPropsShape(
        opening.attributes as ReadonlyArray<EsTreeNode>,
        context.scopes,
      );
      const hasChildrenProp =
        Boolean(hasJsxPropIgnoreCase(opening.attributes, "children")) ||
        spreadPropsShape.hasChildren;
      const runtimeChildren = node.children.filter((child) =>
        isRuntimeJsxChild(child as EsTreeNode),
      );
      const hasNestedChildren =
        runtimeChildren.length > 1 ||
        runtimeChildren.some((child) => isMeaningfulJsxChild(child as EsTreeNode));
      if (!hasChildrenProp && !hasNestedChildren) return;
      if (
        hasJsxPropIgnoreCase(opening.attributes, "dangerouslySetInnerHTML") ||
        spreadPropsShape.hasDangerously
      ) {
        context.report({ node: opening, message: MESSAGE });
      }
    },
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      // createElement calls with <2 args can't have both.
      if (node.arguments.length <= 1) return;
      if (!isCreateElementCall(node as EsTreeNode)) return;
      const propsArgument = node.arguments[1];
      if (!propsArgument) return;

      // Find dangerouslySetInnerHTML in props.
      const propsShape = resolvePropsShape(propsArgument as EsTreeNode, context.scopes);
      if (!propsShape.hasDangerously) return;

      // 3+ args means createElement(tag, props, ...children) — children
      // are passed positionally. A SINGLE nullish positional child
      // (`…, null)`) collapses to `props.children = null` and renders
      // nothing, but TWO OR MORE become an array that is `!= null`
      // whatever the entries hold — mirroring the JSX path.
      const positionalChildren = node.arguments.slice(2);
      const hasPositionalChildren =
        positionalChildren.length > 1 ||
        positionalChildren.some((argument) => !isNullishExpression(argument));
      if (hasPositionalChildren || propsShape.hasChildren) {
        context.report({ node, message: MESSAGE });
      }
    },
  }),
});
