import { RENDER_FUNCTION_PATTERN } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { isComponentParameterSymbol } from "../../utils/is-component-parameter-symbol.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";

// `({ renderItem }) => …` / `const { renderItem } = props` /
// `const renderItem = props.renderItem`: the callee resolves to a COMPONENT
// parameter or a name whose declaration roots in one (a render prop owned by
// the parent). Its identity is the parent's, so calling it inline remounts
// nothing — the same render-prop carve-out as the `props.renderX()` shape,
// for the destructured and plain-alias spellings. A locally-declared
// `renderRow` helper, or a parameter of an ordinary nested helper, still
// carries the smell and stays flagged.
const tracesToPropOrParameter = (
  symbol: SymbolDescriptor | null,
  scopes: ScopeAnalysis,
  visitedSymbols: Set<SymbolDescriptor> = new Set(),
): boolean => {
  if (!symbol || visitedSymbols.has(symbol)) return false;
  visitedSymbols.add(symbol);
  if (isComponentParameterSymbol(symbol)) return true;
  if (!isNodeOfType(symbol.declarationNode, "VariableDeclarator")) return false;
  const source = symbol.initializer;
  if (!source) return false;
  return initializerRootsInProps(source, scopes, visitedSymbols);
};

// The initializer of a destructuring (`const { renderItem } = props.slots`)
// or plain alias (`const renderItem = props.renderItem`) is parent-owned
// when it roots in `props` / `this.props`, including the defaulted spellings
// `props.renderItem ?? defaultRender` and
// `cond ? props.renderItem : renderFallback` where an operand roots there.
const initializerRootsInProps = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbols: Set<SymbolDescriptor> = new Set(),
): boolean => {
  if (isNodeOfType(node, "LogicalExpression")) {
    return (
      initializerRootsInProps(node.left, scopes, visitedSymbols) ||
      initializerRootsInProps(node.right, scopes, visitedSymbols)
    );
  }
  if (isNodeOfType(node, "ConditionalExpression")) {
    return (
      initializerRootsInProps(node.consequent, scopes, visitedSymbols) ||
      initializerRootsInProps(node.alternate, scopes, visitedSymbols)
    );
  }
  return rootsInProps(node, scopes, visitedSymbols);
};

// True when a member-expression chain bottoms out in a COMPONENT parameter
// (`props.slots.header`, or `slots.header` where `slots` is a component
// parameter), a `this.props` access (`this.props.slots`), or a local alias
// whose declaration roots in one (`const slots = props.slots` then
// `slots.renderItem()`). The root is resolved through scope, so a local
// variable named `props` is NOT treated as the component's props bag. Also
// gates the inline member-call receiver, so `props.slots.renderItem()` is
// exempt for the same reason its destructured form
// (`const { renderItem } = props.slots`) already is.
const rootsInProps = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbols: Set<SymbolDescriptor> = new Set(),
): boolean => {
  let current: EsTreeNode = node;
  while (isNodeOfType(current, "MemberExpression")) {
    if (
      isNodeOfType(current.object, "ThisExpression") &&
      isNodeOfType(current.property, "Identifier") &&
      current.property.name === "props"
    ) {
      return true;
    }
    current = current.object;
  }
  if (isNodeOfType(current, "Identifier")) {
    return tracesToPropOrParameter(scopes.symbolFor(current), scopes, visitedSymbols);
  }
  return false;
};

export const noRenderInRender = defineRule({
  id: "no-render-in-render",
  title: "Component rendered by inline function call",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Make it a named component so React preserves its identity and does not remount its state.",
  create: (context: RuleContext) => ({
    JSXExpressionContainer(node: EsTreeNodeOfType<"JSXExpressionContainer">) {
      const expression = node.expression;
      if (!isNodeOfType(expression, "CallExpression")) return;

      let calleeName: string | null = null;
      if (isNodeOfType(expression.callee, "Identifier")) {
        calleeName = expression.callee.name;
      } else if (
        isNodeOfType(expression.callee, "MemberExpression") &&
        isNodeOfType(expression.callee.property, "Identifier")
      ) {
        calleeName = expression.callee.property.name;
      }

      if (!calleeName || !RENDER_FUNCTION_PATTERN.test(calleeName)) return;

      if (isNodeOfType(expression.callee, "Identifier")) {
        if (tracesToPropOrParameter(context.scopes.symbolFor(expression.callee), context.scopes)) {
          return;
        }
      } else if (isNodeOfType(expression.callee, "MemberExpression")) {
        if (rootsInProps(expression.callee.object, context.scopes)) return;
      }

      context.report({
        node: expression,
        message: `Your users lose state because "${calleeName}()" builds UI from an inline call that React remounts, so pull it into its own component instead.`,
      });
    },
  }),
});
