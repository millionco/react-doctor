import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isProvenFramerMotionJsxElement } from "../../utils/is-proven-framer-motion-jsx-element.js";
import { isProvenMotionReactComponent } from "../../utils/is-proven-motion-react-component.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";

interface IteratorContext {
  readonly callback:
    | EsTreeNodeOfType<"ArrowFunctionExpression">
    | EsTreeNodeOfType<"FunctionExpression">;
  readonly itemSymbol: SymbolDescriptor | null;
  readonly indexSymbol: SymbolDescriptor | null;
}

const ITERATION_METHOD_NAMES: ReadonlySet<string> = new Set(["map", "flatMap"]);

const findIteratorContext = (node: EsTreeNode, scopes: ScopeAnalysis): IteratorContext | null => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current) {
    if (
      isNodeOfType(current, "ArrowFunctionExpression") ||
      isNodeOfType(current, "FunctionExpression")
    ) {
      const parent = current.parent;
      if (
        !parent ||
        !isNodeOfType(parent, "CallExpression") ||
        parent.arguments[0] !== current ||
        !isNodeOfType(parent.callee, "MemberExpression") ||
        !ITERATION_METHOD_NAMES.has(getStaticPropertyName(parent.callee) ?? "")
      ) {
        return null;
      }
      const itemParameter = current.params[0];
      const indexParameter = current.params[1];
      return {
        callback: current,
        itemSymbol:
          itemParameter && isNodeOfType(itemParameter, "Identifier")
            ? scopes.symbolFor(itemParameter)
            : null,
        indexSymbol:
          indexParameter && isNodeOfType(indexParameter, "Identifier")
            ? scopes.symbolFor(indexParameter)
            : null,
      };
    }
    current = current.parent;
  }
  return null;
};

const expressionReferencesSymbol = (
  expression: EsTreeNode,
  targetSymbol: SymbolDescriptor | null,
  scopes: ScopeAnalysis,
): boolean => {
  if (!targetSymbol) return false;
  const symbolResolvesToTarget = (
    symbol: SymbolDescriptor | null,
    visitedSymbolIds: Set<number>,
  ): boolean => {
    if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
    if (symbol.id === targetSymbol.id) return true;
    visitedSymbolIds.add(symbol.id);
    if (symbol.kind !== "const" || !symbol.initializer) return false;
    let didFindTarget = false;
    walkAst(symbol.initializer, (descendant) => {
      if (
        !didFindTarget &&
        isNodeOfType(descendant, "Identifier") &&
        symbolResolvesToTarget(scopes.symbolFor(descendant), visitedSymbolIds)
      ) {
        didFindTarget = true;
      }
    });
    return didFindTarget;
  };
  let didFindReference = false;
  walkAst(expression, (descendant) => {
    if (
      !didFindReference &&
      isNodeOfType(descendant, "Identifier") &&
      symbolResolvesToTarget(scopes.symbolFor(descendant), new Set<number>())
    ) {
      didFindReference = true;
    }
  });
  return didFindReference;
};

const isConditionallyRenderedWithinIterator = (
  node: EsTreeNode,
  callback: IteratorContext["callback"],
): boolean => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current && current !== callback) {
    if (isNodeOfType(current, "LogicalExpression")) return true;
    if (isNodeOfType(current, "ConditionalExpression")) return true;
    current = current.parent;
  }
  return false;
};

const hasItemScopedLayoutGroup = (
  node: EsTreeNode,
  iterator: IteratorContext,
  context: RuleContext,
): boolean => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current && current !== iterator.callback) {
    if (
      isNodeOfType(current, "JSXElement") &&
      isProvenMotionReactComponent(current.openingElement.name, "LayoutGroup", context.scopes)
    ) {
      const idAttribute = getAuthoritativeJsxAttribute(current.openingElement.attributes, "id");
      if (
        idAttribute?.value &&
        isNodeOfType(idAttribute.value, "JSXExpressionContainer") &&
        expressionReferencesSymbol(
          idAttribute.value.expression,
          iterator.itemSymbol,
          context.scopes,
        )
      ) {
        return true;
      }
    }
    current = current.parent;
  }
  return false;
};

export const motionUnstableLayoutIdInIteration = defineRule({
  id: "motion-unstable-layout-id-in-iteration",
  title: "Motion layout ID is unstable in an iteration",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Derive repeated layout IDs from stable item identity, or scope each repeated component with a LayoutGroup ID derived from the item.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isProvenFramerMotionJsxElement(node, context.scopes)) return;
      const layoutIdAttribute = getAuthoritativeJsxAttribute(node.attributes, "layoutId");
      if (!layoutIdAttribute) return;
      const iterator = findIteratorContext(node, context.scopes);
      if (!iterator) return;
      if (hasItemScopedLayoutGroup(node, iterator, context)) return;
      const staticLayoutId = getStringLiteralAttributeValue(layoutIdAttribute);
      if (staticLayoutId !== null) {
        if (isConditionallyRenderedWithinIterator(node, iterator.callback)) return;
        context.report({
          node: layoutIdAttribute,
          message:
            "This literal layoutId is rendered for every iteration, so multiple live items share one global Motion layout identity. Derive it from stable item identity or scope the item with LayoutGroup.",
        });
        return;
      }
      if (
        !layoutIdAttribute.value ||
        !isNodeOfType(layoutIdAttribute.value, "JSXExpressionContainer") ||
        !expressionReferencesSymbol(
          layoutIdAttribute.value.expression,
          iterator.indexSymbol,
          context.scopes,
        )
      ) {
        return;
      }
      context.report({
        node: layoutIdAttribute,
        message:
          "This layoutId depends on the iteration index, so reordering items can attach shared-layout animation to the wrong element. Derive it from stable item identity.",
      });
    },
  }),
});
