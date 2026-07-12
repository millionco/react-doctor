import { defineRule } from "../../utils/define-rule.js";
import { LARGE_TEXT_OPTIMIZATION_THRESHOLD_CHARS } from "../../constants/thresholds.js";
import { isComponentParameterSymbol } from "../../utils/is-component-parameter-symbol.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
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

const isJsxProducingCallee = (callee: EsTreeNode): boolean => {
  const calleeName = isNodeOfType(callee, "Identifier")
    ? callee.name
    : isNodeOfType(callee, "MemberExpression") &&
        !callee.computed &&
        isNodeOfType(callee.property, "Identifier")
      ? callee.property.name
      : null;
  return calleeName === "createElement" || calleeName === "cloneElement";
};

const containsRenderOutput = (root: EsTreeNode | null | undefined): boolean => {
  if (!root) return false;
  let didFindRenderOutput = false;
  const visit = (node: EsTreeNode): void => {
    if (didFindRenderOutput) return;
    if (isNodeOfType(node, "JSXElement") || isNodeOfType(node, "JSXFragment")) {
      didFindRenderOutput = true;
      return;
    }
    if (isNodeOfType(node, "ReturnStatement")) {
      didFindRenderOutput = true;
      return;
    }
    if (isNodeOfType(node, "CallExpression") && isJsxProducingCallee(node.callee)) {
      didFindRenderOutput = true;
      return;
    }
    const record = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent") continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === "object" && "type" in item) visit(item as EsTreeNode);
        }
      } else if (child && typeof child === "object" && "type" in child) {
        visit(child as EsTreeNode);
      }
    }
  };
  visit(root);
  return didFindRenderOutput;
};

const containsJsxValue = (root: EsTreeNode | null | undefined): boolean => {
  if (!root) return false;
  const inner = stripParenExpression(root);
  if (isNodeOfType(inner, "JSXElement") || isNodeOfType(inner, "JSXFragment")) return true;
  if (isNodeOfType(inner, "ConditionalExpression")) {
    return containsJsxValue(inner.consequent) || containsJsxValue(inner.alternate);
  }
  if (isNodeOfType(inner, "LogicalExpression")) {
    return containsJsxValue(inner.left) || containsJsxValue(inner.right);
  }
  if (isNodeOfType(inner, "CallExpression")) return isJsxProducingCallee(inner.callee);
  return false;
};

// The doc's bar: flag only when the branch "actually changes rendering
// rather than performing pure normalization or validation". Docs-validation
// 2026-07 found the dominant FP shape is the comparison result feeding a
// derived VALUE — a label fallback (`label={typeof children === 'string' ?
// children : field}`), a markdown source (`file.value = … ? children : ''`),
// a clsx toggle — where children render identically either way. So the
// comparison must sit in branching position (ternary test, if test, or
// `&&` guard) with JSX in a branch before it counts as polymorphic
// rendering.
const guardsRenderShape = (comparison: EsTreeNode): boolean => {
  let current: EsTreeNode = findTransparentExpressionRoot(comparison);
  while (current.parent) {
    const parent: EsTreeNode = current.parent;
    if (isNodeOfType(parent, "UnaryExpression") && parent.operator === "!") {
      current = findTransparentExpressionRoot(parent);
      continue;
    }
    if (isNodeOfType(parent, "LogicalExpression")) {
      if (parent.left === current && containsJsxValue(parent.right)) return true;
      current = findTransparentExpressionRoot(parent);
      continue;
    }
    if (isNodeOfType(parent, "ConditionalExpression") && parent.test === current) {
      return containsJsxValue(parent.consequent) || containsJsxValue(parent.alternate);
    }
    if (isNodeOfType(parent, "IfStatement") && parent.test === current) {
      return containsRenderOutput(parent.consequent) || containsRenderOutput(parent.alternate);
    }
    return false;
  }
  return false;
};

const isPropsChildrenLength = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const unwrappedNode = stripParenExpression(node);
  return (
    isNodeOfType(unwrappedNode, "MemberExpression") &&
    !unwrappedNode.computed &&
    isNodeOfType(unwrappedNode.property, "Identifier") &&
    unwrappedNode.property.name === "length" &&
    resolvesToPropsChildren(stripParenExpression(unwrappedNode.object), scopes)
  );
};

const isLargeTextLengthComparison = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const unwrappedNode = stripParenExpression(node);
  if (!isNodeOfType(unwrappedNode, "BinaryExpression")) return false;
  const leftIsLength = isPropsChildrenLength(unwrappedNode.left, scopes);
  const rightIsLength = isPropsChildrenLength(unwrappedNode.right, scopes);
  const thresholdNode = leftIsLength ? unwrappedNode.right : unwrappedNode.left;
  if ((!leftIsLength && !rightIsLength) || !isNodeOfType(thresholdNode, "Literal")) return false;
  if (
    typeof thresholdNode.value !== "number" ||
    thresholdNode.value < LARGE_TEXT_OPTIMIZATION_THRESHOLD_CHARS
  ) {
    return false;
  }
  return leftIsLength
    ? unwrappedNode.operator === ">" || unwrappedNode.operator === ">="
    : unwrappedNode.operator === "<" || unwrappedNode.operator === "<=";
};

const isLargeStringOptimizationGuard = (comparison: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let current = findTransparentExpressionRoot(comparison);
  while (current.parent) {
    const parent = current.parent;
    if (!isNodeOfType(parent, "LogicalExpression") || parent.operator !== "&&") return false;
    const otherOperand = parent.left === current ? parent.right : parent.left;
    if (isLargeTextLengthComparison(otherOperand, scopes)) return true;
    current = findTransparentExpressionRoot(parent);
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

      if (!guardsRenderShape(node)) return;
      if (isLargeStringOptimizationGuard(node, context.scopes)) return;

      context.report({
        node,
        message:
          'Your users hit inconsistent behavior because `typeof children === "string"` makes this component switch on what callers pass, so add clear subcomponents like `<Button.Text>` instead.',
      });
    },
  }),
});
