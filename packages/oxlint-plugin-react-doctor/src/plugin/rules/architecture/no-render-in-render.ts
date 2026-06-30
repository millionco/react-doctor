import { RENDER_FUNCTION_PATTERN } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";

// `props.renderX(...)` / `this.props.renderX(...)` is a render-prop
// invocation: a function received FROM the parent, so its identity is
// owned by the parent and calling it inline remounts nothing. This is
// the idiomatic React render-prop pattern, not inline component
// construction.
const isRenderPropReceiver = (object: EsTreeNode): boolean => {
  if (isNodeOfType(object, "Identifier")) return object.name === "props";
  return (
    isNodeOfType(object, "MemberExpression") &&
    isNodeOfType(object.property, "Identifier") &&
    object.property.name === "props"
  );
};

// `this.renderX(...)` is a class-component render-helper method. It has a
// stable identity (declared on the class, not rebuilt in render) and
// returns JSX that React inlines in place, so it remounts nothing — the
// canonical "split render() into methods" pattern the recommendation is
// itself nudging toward. Only locally-declared inline helpers carry the
// smell this rule targets, never `this.method` calls.
const isStableMethodReceiver = (object: EsTreeNode): boolean =>
  isNodeOfType(object, "ThisExpression");

// `({ renderItem }) => …` / `(props) => { const { renderItem } = props }`:
// the callee resolves to a function PARAMETER or a name destructured FROM
// one (a render prop owned by the parent). Its identity is the parent's,
// so calling it inline remounts nothing — the same render-prop carve-out
// as the `props.renderX()` shape, just for the destructured spelling.
// A locally-declared `renderRow` helper (kind "const"/"function" whose
// source isn't a parameter) still carries the smell and stays flagged.
const tracesToPropOrParameter = (
  symbol: SymbolDescriptor | null,
  scopes: ScopeAnalysis,
): boolean => {
  if (!symbol) return false;
  if (symbol.kind === "parameter") return true;
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
    if (source.name === "props") return true;
    const sourceSymbol = scopes.symbolFor(source);
    return sourceSymbol?.kind === "parameter";
  }
  // `const { renderItem } = this.props` / `const { renderItem } = props.slots`.
  return (
    isNodeOfType(source, "MemberExpression") &&
    isNodeOfType(source.property, "Identifier") &&
    source.property.name === "props"
  );
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
        if (isRenderPropReceiver(expression.callee.object)) return;
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
