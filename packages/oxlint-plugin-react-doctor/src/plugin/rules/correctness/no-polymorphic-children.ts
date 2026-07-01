import { defineRule } from "../../utils/define-rule.js";
import { isComponentParameterSymbol } from "../../utils/is-component-parameter-symbol.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// `const { children } = props` / `const { children } = this.props`: a body
// alias of the component's children prop is the same smell as the
// destructured-parameter form. Only a destructure whose SOURCE is the
// component's props counts — `const { children } = node` (a non-prop object,
// e.g. a recursive tree walker's parameter) stays quiet.
const isChildrenDestructuredFromProps = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const declaration = symbol.declarationNode;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "ObjectPattern")
  ) {
    return false;
  }
  const source = symbol.initializer;
  if (!source) return false;
  if (isNodeOfType(source, "Identifier")) {
    return isComponentParameterSymbol(scopes.symbolFor(source));
  }
  return (
    isNodeOfType(source, "MemberExpression") &&
    !source.computed &&
    isNodeOfType(source.property, "Identifier") &&
    source.property.name === "props" &&
    isNodeOfType(source.object, "ThisExpression")
  );
};

// True only when the `children` operand resolves to the enclosing
// component's `props.children` — a destructured prop binding
// (`({ children }) => …`), a body alias of the props
// (`const { children } = props`), or a `props.children` member access where
// `props` is the component's parameter. A local variable or data field that
// happens to be named `children` (`const { children } = node`) is not a
// polymorphic-children smell.
const resolvesToPropsChildren = (operand: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (isNodeOfType(operand, "Identifier") && operand.name === "children") {
    const symbol = scopes.symbolFor(operand);
    if (isComponentParameterSymbol(symbol)) return true;
    return symbol !== null && isChildrenDestructuredFromProps(symbol, scopes);
  }
  if (
    isNodeOfType(operand, "MemberExpression") &&
    !operand.computed &&
    isNodeOfType(operand.property, "Identifier") &&
    operand.property.name === "children" &&
    isNodeOfType(operand.object, "Identifier")
  ) {
    return isComponentParameterSymbol(scopes.symbolFor(operand.object));
  }
  return false;
};

// HACK: `typeof children === "string"` (or `=== 'object'`) is a
// polymorphic-children smell — the component switches behavior based on
// what the consumer happened to pass. Better to expose explicit
// subcomponents (`<Button.Text />`) so text always lands in the right
// shape and the component's API is checked at compile time.
export const noPolymorphicChildren = defineRule({
  id: "no-polymorphic-children",
  title: "Children type checked at runtime",
  severity: "warn",
  category: "Architecture",
  recommendation:
    "Add clear subcomponents like `<Button.Text>` and `<Button.Icon>` so callers don't have to check `typeof children`.",
  create: (context: RuleContext) => ({
    BinaryExpression(node: EsTreeNodeOfType<"BinaryExpression">) {
      if (node.operator !== "===" && node.operator !== "==") return;

      const isTypeofChildren = (operand: EsTreeNode | undefined): boolean =>
        isNodeOfType(operand, "UnaryExpression") &&
        operand.operator === "typeof" &&
        resolvesToPropsChildren(operand.argument, context.scopes);

      if (!isTypeofChildren(node.left) && !isTypeofChildren(node.right)) return;

      const isStringLiteral = (operand: EsTreeNode | undefined): boolean =>
        isNodeOfType(operand, "Literal") && operand.value === "string";

      if (!isStringLiteral(node.left) && !isStringLiteral(node.right)) return;

      context.report({
        node,
        message:
          'Your users hit inconsistent behavior because `typeof children === "string"` makes this component switch on what callers pass, so add clear subcomponents like `<Button.Text>` instead.',
      });
    },
  }),
});
