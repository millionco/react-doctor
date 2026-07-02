import { containsJsxElement } from "../../utils/contains-jsx-element.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { flattenLogicalAndChain } from "../../utils/flatten-logical-and-chain.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";

const ARITHMETIC_BINARY_OPERATORS = new Set(["-", "+", "*", "/", "%"]);
const NUMERIC_COERCION_CALLEE_NAMES = new Set(["Number", "parseInt", "parseFloat"]);
const MAP_OR_SET_CONSTRUCTOR_NAMES = new Set(["Map", "Set"]);
const PASSTHROUGH_WRAPPER_PARENT_TYPES = new Set<string>([
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
  "TSNonNullExpression",
  "TSInstantiationExpression",
  "ChainExpression",
]);

const isJsxNode = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "JSXElement") || isNodeOfType(node, "JSXFragment");

const isMapOrSetConstruction = (node: EsTreeNode): boolean => {
  const stripped = stripParenExpression(node);
  return (
    isNodeOfType(stripped, "NewExpression") &&
    isNodeOfType(stripped.callee, "Identifier") &&
    MAP_OR_SET_CONSTRUCTOR_NAMES.has(stripped.callee.name)
  );
};

const isHookCallNamed = (node: EsTreeNode, hookName: string): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = stripParenExpression(node.callee);
  if (isNodeOfType(callee, "Identifier")) return callee.name === hookName;
  return (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === hookName
  );
};

const isHookCallSeededWithMapOrSet = (node: EsTreeNode, hookName: string): boolean => {
  if (!isHookCallNamed(node, hookName) || !isNodeOfType(node, "CallExpression")) return false;
  const firstArgument = node.arguments[0];
  return Boolean(firstArgument && isMapOrSetConstruction(firstArgument));
};

const isFirstElementOfUseStateWithMapOrSet = (bindingIdentifier: EsTreeNode): boolean => {
  const pattern = bindingIdentifier.parent;
  if (!pattern || !isNodeOfType(pattern, "ArrayPattern")) return false;
  if (pattern.elements[0] !== bindingIdentifier) return false;
  const declarator = pattern.parent;
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator") || !declarator.init) {
    return false;
  }
  return isHookCallSeededWithMapOrSet(stripParenExpression(declarator.init), "useState");
};

const identifierResolvesToMapOrSet = (identifier: EsTreeNodeOfType<"Identifier">): boolean => {
  const binding = findVariableInitializer(identifier, identifier.name);
  if (!binding) return false;
  if (binding.initializer && isMapOrSetConstruction(binding.initializer)) return true;
  return isFirstElementOfUseStateWithMapOrSet(binding.bindingIdentifier);
};

const isRefCurrentOfMapOrSet = (objectNode: EsTreeNode): boolean => {
  if (
    !isNodeOfType(objectNode, "MemberExpression") ||
    objectNode.computed ||
    !isNodeOfType(objectNode.property, "Identifier") ||
    objectNode.property.name !== "current"
  ) {
    return false;
  }
  const refIdentifier = stripParenExpression(objectNode.object);
  if (!isNodeOfType(refIdentifier, "Identifier")) return false;
  const binding = findVariableInitializer(refIdentifier, refIdentifier.name);
  if (!binding || !binding.initializer) return false;
  return isHookCallSeededWithMapOrSet(stripParenExpression(binding.initializer), "useRef");
};

// `.size` collides with react-hook-form FieldError objects and string
// `size` props ("sm"/"md") far more often than it identifies a Map/Set,
// so it only counts when the receiver provably is one: a direct
// `new Map`/`new Set`, a binding initialized to one (including
// `useState(new Set())` destructures), or a `ref.current` whose ref was
// seeded with one.
const isProvableCollectionReceiver = (objectNode: EsTreeNode): boolean => {
  const stripped = stripParenExpression(objectNode);
  if (isMapOrSetConstruction(stripped)) return true;
  if (isNodeOfType(stripped, "Identifier")) return identifierResolvesToMapOrSet(stripped);
  return isRefCurrentOfMapOrSet(stripped);
};

// True only for expressions whose runtime value is syntactically numeric, so
// short-circuiting to a falsy `0`/`NaN` leaks a visible text node. No type
// inference — comparisons, `!`/`!!`, `Boolean(...)`, strings, and bare
// identifiers are deliberately excluded because their falsy values render
// nothing.
const isSyntacticallyNumeric = (node: EsTreeNode): boolean => {
  const stripped = stripParenExpression(node);

  if (
    isNodeOfType(stripped, "MemberExpression") &&
    !stripped.computed &&
    isNodeOfType(stripped.property, "Identifier")
  ) {
    if (stripped.property.name === "length") return true;
    if (stripped.property.name === "size") return isProvableCollectionReceiver(stripped.object);
    return false;
  }

  if (
    isNodeOfType(stripped, "BinaryExpression") &&
    ARITHMETIC_BINARY_OPERATORS.has(stripped.operator)
  ) {
    return true;
  }

  if (
    isNodeOfType(stripped, "CallExpression") &&
    isNodeOfType(stripped.callee, "Identifier") &&
    NUMERIC_COERCION_CALLEE_NAMES.has(stripped.callee.name)
  ) {
    return true;
  }

  if (isNodeOfType(stripped, "Literal") && typeof stripped.value === "number") return true;

  return false;
};

const isJsxProducingMapCall = (node: EsTreeNode): boolean => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    !isNodeOfType(node.callee, "MemberExpression") ||
    node.callee.computed ||
    !isNodeOfType(node.callee.property, "Identifier") ||
    node.callee.property.name !== "map"
  ) {
    return false;
  }
  const callback = node.arguments[0];
  return Boolean(
    callback &&
    (isNodeOfType(callback, "ArrowFunctionExpression") ||
      isNodeOfType(callback, "FunctionExpression")) &&
    containsJsxElement(callback),
  );
};

const isRenderExpression = (node: EsTreeNode): boolean => {
  const stripped = stripParenExpression(node);
  return isJsxNode(stripped) || isJsxProducingMapCall(stripped);
};

// A falsy-numeric `&&` leaks its `0` whenever the expression's value
// reaches a JSX child position, including through ternary branches, the
// right arm of `||` / `??`, and the right arm of an enclosing `&&`.
const flowsIntoJsxChild = (node: EsTreeNode): boolean => {
  let current: EsTreeNode = node;
  let parent: EsTreeNode | null | undefined = current.parent;
  while (parent) {
    if (isNodeOfType(parent, "JSXExpressionContainer")) {
      const containerParent = parent.parent;
      return Boolean(
        containerParent &&
        (isNodeOfType(containerParent, "JSXElement") ||
          isNodeOfType(containerParent, "JSXFragment")),
      );
    }
    const isPassthroughWrapper = PASSTHROUGH_WRAPPER_PARENT_TYPES.has(parent.type);
    const isFlowingConditionalBranch =
      isNodeOfType(parent, "ConditionalExpression") &&
      (parent.consequent === current || parent.alternate === current);
    const isFlowingLogicalRightArm =
      isNodeOfType(parent, "LogicalExpression") && parent.right === current;
    if (!isPassthroughWrapper && !isFlowingConditionalBranch && !isFlowingLogicalRightArm) {
      return false;
    }
    current = parent;
    parent = parent.parent;
  }
  return false;
};

export const jsxNumericAndLeakedRender = defineRule({
  id: "jsx-numeric-and-leaked-render",
  title: "Numeric && renders a stray 0",
  severity: "warn",
  recommendation:
    "In `{items.length && <List/>}` React renders a literal `0` when the count is 0. Compare explicitly (`items.length > 0 && <List/>`) or use a ternary (`items.length ? <List/> : null`).",
  create: (context: RuleContext) => ({
    LogicalExpression(node: EsTreeNodeOfType<"LogicalExpression">) {
      if (node.operator !== "&&") return;

      // Only handle the outermost `&&` of a chain; inner ones are folded in
      // via `flattenLogicalAndChain` below.
      const parent = node.parent;
      if (isNodeOfType(parent, "LogicalExpression") && parent.operator === "&&") return;

      if (!flowsIntoJsxChild(node)) return;

      const operands = flattenLogicalAndChain(node);
      const renderOperand = operands[operands.length - 1];
      if (!renderOperand || !isRenderExpression(renderOperand)) return;

      const leakingOperand = operands
        .slice(0, -1)
        .find((guardOperand) => isSyntacticallyNumeric(guardOperand));
      if (!leakingOperand) return;

      context.report({
        node: leakingOperand,
        message:
          "React renders a literal `0` into your page when this count is 0 instead of nothing — compare it explicitly (`count > 0 && <X/>`) or use a ternary (`count ? <X/> : null`).",
      });
    },
  }),
});
