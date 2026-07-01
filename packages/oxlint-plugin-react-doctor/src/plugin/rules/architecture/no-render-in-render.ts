import { RENDER_FUNCTION_PATTERN } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { isComponentParameterSymbol } from "../../utils/is-component-parameter-symbol.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";

// `this.renderX(...)` is a class-component render-helper method. It has a
// stable identity (declared on the class, not rebuilt in render) and
// returns JSX that React inlines in place, so it remounts nothing — the
// canonical "split render() into methods" pattern the recommendation is
// itself nudging toward. Only locally-declared inline helpers carry the
// smell this rule targets, never `this.method` calls.
const isStableMethodReceiver = (object: EsTreeNode): boolean =>
  isNodeOfType(object, "ThisExpression");

// `({ renderItem }) => …` / `(props) => { const { renderItem } = props }`:
// the callee resolves to a COMPONENT parameter or a name destructured FROM
// one (a render prop owned by the parent). Its identity is the parent's,
// so calling it inline remounts nothing — the same render-prop carve-out
// as the `props.renderX()` shape, just for the destructured spelling.
// A locally-declared `renderRow` helper, or a parameter of an ordinary
// nested helper, still carries the smell and stays flagged.
const tracesToPropOrParameter = (
  symbol: SymbolDescriptor | null,
  scopes: ScopeAnalysis,
): boolean => {
  if (!symbol) return false;
  if (isComponentParameterSymbol(symbol)) return true;
  const declaration = symbol.declarationNode;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    (!isNodeOfType(declaration.id, "ObjectPattern") &&
      !isNodeOfType(declaration.id, "ArrayPattern"))
  ) {
    return false;
  }
  const source = symbol.initializer;
  if (!source) return false;
  if (isNodeOfType(source, "Identifier")) {
    return isComponentParameterSymbol(scopes.symbolFor(source));
  }
  // `const { renderItem } = this.props` / `const { renderItem } = props.slots`
  // (a nested prop bag): the source still roots in the parent-owned `props`
  // (or `this.props`), so the destructured render prop is parent-owned too.
  return rootsInProps(source, scopes);
};

// True when a member-expression chain bottoms out in a COMPONENT parameter
// (`props.slots.header`, or `slots.header` where `slots` is a component
// parameter) or a `this.props` access (`this.props.slots`). The root is
// resolved through scope, so a local variable named `props` is NOT treated
// as the component's props bag. Also gates the inline member-call receiver,
// so `props.slots.renderItem()` is exempt for the same reason its
// destructured form (`const { renderItem } = props.slots`) already is.
const rootsInProps = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
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
    return isComponentParameterSymbol(scopes.symbolFor(current));
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
        if (tracesToPropOrParameter(context.scopes.symbolFor(expression.callee), context.scopes)) {
          return;
        }
        calleeName = expression.callee.name;
      } else if (
        isNodeOfType(expression.callee, "MemberExpression") &&
        isNodeOfType(expression.callee.property, "Identifier")
      ) {
        if (rootsInProps(expression.callee.object, context.scopes)) return;
        if (isStableMethodReceiver(expression.callee.object)) return;
        calleeName = expression.callee.property.name;
      }

      if (!calleeName || !RENDER_FUNCTION_PATTERN.test(calleeName)) return;

      context.report({
        node: expression,
        message: `Your users lose state because "${calleeName}()" builds UI from an inline call that React remounts, so pull it into its own component instead.`,
      });
    },
  }),
});
