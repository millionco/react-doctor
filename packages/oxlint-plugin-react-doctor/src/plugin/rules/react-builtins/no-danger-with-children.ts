import { defineRule } from "../../utils/define-rule.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isCreateElementCall } from "../../utils/is-create-element-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE = "React throws an error when you set both children & `dangerouslySetInnerHTML`.";

interface PropsShape {
  hasDangerously: boolean;
  hasChildren: boolean;
}

// True when JSXText is whitespace-only with at least one newline (the
// "auto-formatted JSX" line break that doesn't count as a child).
const isLineBreak = (child: EsTreeNode): boolean => {
  if (!isNodeOfType(child, "JSXText")) return false;
  return child.value.trim().length === 0 && child.value.includes("\n");
};

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

// Port of `oxc_linter::rules::react::no_danger_with_children`. Reports
// when the same JSX element / createElement call has BOTH a `children`
// prop / nested children AND `dangerouslySetInnerHTML`.
export const noDangerWithChildren = defineRule<Rule>({
  id: "no-danger-with-children",
  title: "dangerouslySetInnerHTML with children",
  severity: "error",
  recommendation: "Use either `children` or `dangerouslySetInnerHTML`, never both.",
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
      const hasNestedChildren =
        node.children.length > 0 && !isLineBreak(node.children[0] as EsTreeNode);
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
      // are passed positionally.
      const hasPositionalChildren = node.arguments.length >= 3;
      if (hasPositionalChildren || propsShape.hasChildren) {
        context.report({ node, message: MESSAGE });
      }
    },
  }),
});
