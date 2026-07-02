import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripGroupingParens } from "../../utils/strip-grouping-parens.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";

// oxc-parser surfaces `(...)` as a node kind outside the TSESTree union,
// so it is matched via a `string`-typed constant to avoid a literal
// "no overlap" comparison error.
const PARENTHESIZED_EXPRESSION: string = "ParenthesizedExpression";
const DEPRECATED_NUMERIC_MEMBERS = new Set(["keyCode", "which", "charCode"]);
const COMPARISON_OPERATORS = new Set(["===", "!==", "==", "!=", "<", ">", "<=", ">="]);
const RELATIONAL_OPERATORS = new Set(["<", ">", "<=", ">="]);
const MOUSE_BUTTON_LITERALS = new Set([1, 2, 3, 4]);
const IME_COMPOSITION_KEYCODE = 229;
// Control/navigation/activation keyCodes (Backspace, Tab, Enter,
// modifiers, Escape, Space, PageUp/Down, End/Home, arrows, Insert,
// Delete, Meta, F1-F12, locks) are identical across keyboard layouts,
// browsers, and IMEs — comparing keyCode against them is layout-safe,
// unlike letter (65-90), digit (48-57), and punctuation (186-222) codes.
const LAYOUT_INVARIANT_CONTROL_KEYCODES = new Set([
  8, 9, 13, 16, 17, 18, 19, 20, 27, 32, 33, 34, 35, 36, 37, 38, 39, 40, 45, 46, 91, 92, 93, 112,
  113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 144, 145,
]);
const STANDARD_KEY_MEMBERS = new Set(["key", "code"]);
const MOUSE_BUTTON_MEMBERS = new Set(["button", "buttons"]);
const KEYBOARD_HANDLER_NAME_PATTERN = /key(down|up|press)/i;
const KEYBOARD_LISTENER_EVENTS = new Set(["keydown", "keyup", "keypress"]);

const MESSAGE =
  "`KeyboardEvent.keyCode`/`which`/`charCode` are deprecated, and this comparison targets a character code that varies by keyboard layout, browser, and input method, so the branch fires on the wrong key (or never) for untested layouts. Branch on the standardized `event.key` (logical key) or `event.code` (physical key) instead.";

const meaningfulParent = (node: EsTreeNode): EsTreeNode | null => {
  let parent = node.parent ?? null;
  while (parent && parent.type === PARENTHESIZED_EXPRESSION) parent = parent.parent ?? null;
  return parent;
};

const resolveNumericValue = (operand: EsTreeNode): number | null => {
  const valueNode = stripGroupingParens(operand);
  if (isNodeOfType(valueNode, "Literal") && typeof valueNode.value === "number") {
    return valueNode.value;
  }
  if (isNodeOfType(valueNode, "Identifier")) {
    const binding = findVariableInitializer(valueNode, valueNode.name);
    const initializer = binding?.initializer ?? null;
    if (
      initializer &&
      isNodeOfType(initializer, "Literal") &&
      typeof initializer.value === "number"
    ) {
      return initializer.value;
    }
  }
  return null;
};

interface DeprecatedReadComparison {
  operator: string;
  comparedValue: number | null;
}

const getComparison = (memberNode: EsTreeNode): DeprecatedReadComparison | null => {
  const parent = meaningfulParent(memberNode);
  if (!parent || !isNodeOfType(parent, "BinaryExpression")) return null;
  if (!COMPARISON_OPERATORS.has(parent.operator)) return null;
  const otherOperand =
    stripGroupingParens(parent.left as EsTreeNode) === memberNode ? parent.right : parent.left;
  return {
    operator: parent.operator,
    comparedValue: resolveNumericValue(otherOperand as EsTreeNode),
  };
};

const isLayoutSensitiveCode = (value: number): boolean =>
  value !== IME_COMPOSITION_KEYCODE && !LAYOUT_INVARIANT_CONTROL_KEYCODES.has(value);

const switchTargetsLayoutSensitiveCode = (conditionRoot: EsTreeNode): boolean => {
  const parent = conditionRoot.parent ?? null;
  if (
    !parent ||
    !isNodeOfType(parent, "SwitchStatement") ||
    parent.discriminant !== conditionRoot
  ) {
    return false;
  }
  return parent.cases.some((switchCase) => {
    const testNode = switchCase.test;
    if (!testNode) return false;
    const caseValue = resolveNumericValue(testNode as EsTreeNode);
    return caseValue !== null && isLayoutSensitiveCode(caseValue);
  });
};

interface BranchingContext {
  conditionRoot: EsTreeNode;
  branching: boolean;
}

const resolveBranchingContext = (memberNode: EsTreeNode): BranchingContext => {
  let node = memberNode;
  let climbedThroughComparison = false;
  while (node.parent) {
    const parent = node.parent;
    if (parent.type === PARENTHESIZED_EXPRESSION || parent.type === "UnaryExpression") {
      node = parent;
      continue;
    }
    if (parent.type === "LogicalExpression") {
      node = parent;
      continue;
    }
    if (isNodeOfType(parent, "BinaryExpression") && COMPARISON_OPERATORS.has(parent.operator)) {
      climbedThroughComparison = true;
      node = parent;
      continue;
    }
    break;
  }
  const parent = node.parent ?? null;
  const isTestOrDiscriminant = Boolean(
    parent &&
    ((isNodeOfType(parent, "SwitchStatement") && parent.discriminant === node) ||
      ((isNodeOfType(parent, "IfStatement") ||
        isNodeOfType(parent, "ConditionalExpression") ||
        isNodeOfType(parent, "WhileStatement") ||
        isNodeOfType(parent, "DoWhileStatement")) &&
        parent.test === node)),
  );
  return {
    conditionRoot: node,
    branching: climbedThroughComparison || isTestOrDiscriminant,
  };
};

const getEnclosingFunction = (node: EsTreeNode): EsTreeNode | null => {
  let ancestor = node.parent ?? null;
  while (ancestor) {
    if (isFunctionLike(ancestor)) return ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return null;
};

const typeReferenceIsKeyboardEvent = (typeAnnotation: EsTreeNode | null | undefined): boolean => {
  if (!typeAnnotation || !isNodeOfType(typeAnnotation, "TSTypeAnnotation")) return false;
  const typeNode = typeAnnotation.typeAnnotation as EsTreeNode;
  if (!isNodeOfType(typeNode, "TSTypeReference")) return false;
  const typeName = typeNode.typeName;
  if (isNodeOfType(typeName, "Identifier")) return typeName.name === "KeyboardEvent";
  if (isNodeOfType(typeName, "TSQualifiedName")) {
    return isNodeOfType(typeName.right, "Identifier") && typeName.right.name === "KeyboardEvent";
  }
  return false;
};

const nameLooksLikeKeyboardHandler = (name: string | null | undefined): boolean =>
  Boolean(name && KEYBOARD_HANDLER_NAME_PATTERN.test(name));

const functionIsKeyboardHandler = (fnNode: EsTreeNode): boolean => {
  if (isNodeOfType(fnNode, "FunctionDeclaration") && fnNode.id) {
    if (nameLooksLikeKeyboardHandler(fnNode.id.name)) return true;
  }
  const parent = fnNode.parent ?? null;
  if (!parent) return false;
  if (isNodeOfType(parent, "VariableDeclarator") && isNodeOfType(parent.id, "Identifier")) {
    return nameLooksLikeKeyboardHandler(parent.id.name);
  }
  if (isNodeOfType(parent, "Property") && isNodeOfType(parent.key, "Identifier")) {
    return nameLooksLikeKeyboardHandler(parent.key.name);
  }
  if (isNodeOfType(parent, "PropertyDefinition") && isNodeOfType(parent.key, "Identifier")) {
    return nameLooksLikeKeyboardHandler(parent.key.name);
  }
  if (isNodeOfType(parent, "MethodDefinition") && isNodeOfType(parent.key, "Identifier")) {
    return nameLooksLikeKeyboardHandler(parent.key.name);
  }
  if (
    isNodeOfType(parent, "AssignmentExpression") &&
    isNodeOfType(parent.left, "MemberExpression")
  ) {
    const property = parent.left.property;
    if (!parent.left.computed && isNodeOfType(property, "Identifier")) {
      return nameLooksLikeKeyboardHandler(property.name);
    }
  }
  if (isNodeOfType(parent, "JSXExpressionContainer") && parent.parent) {
    const attribute = parent.parent;
    if (isNodeOfType(attribute, "JSXAttribute")) {
      const attributeName = getJsxAttributeName(attribute.name as EsTreeNode);
      if (attributeName && /^onkey/i.test(attributeName)) return true;
    }
  }
  if (isNodeOfType(parent, "CallExpression")) {
    const callee = parent.callee;
    const isAddListener =
      isNodeOfType(callee, "MemberExpression") &&
      !callee.computed &&
      isNodeOfType(callee.property, "Identifier") &&
      callee.property.name === "addEventListener";
    const firstArg = parent.arguments?.[0];
    if (
      isAddListener &&
      parent.arguments?.[1] === fnNode &&
      firstArg &&
      isNodeOfType(firstArg as EsTreeNode, "Literal") &&
      typeof (firstArg as EsTreeNodeOfType<"Literal">).value === "string" &&
      KEYBOARD_LISTENER_EVENTS.has(String((firstArg as EsTreeNodeOfType<"Literal">).value))
    ) {
      return true;
    }
  }
  return false;
};

const receiverReadsAnyProperty = (
  scopeNode: EsTreeNode,
  receiverName: string,
  propertyNames: Set<string>,
): boolean => {
  let found = false;
  walkAst(scopeNode, (child) => {
    if (found) return false;
    if (
      isNodeOfType(child, "MemberExpression") &&
      !child.computed &&
      isNodeOfType(child.object, "Identifier") &&
      child.object.name === receiverName &&
      isNodeOfType(child.property, "Identifier") &&
      propertyNames.has(child.property.name)
    ) {
      found = true;
      return false;
    }
  });
  return found;
};

// Flags branching on a KeyboardEvent's deprecated numeric `keyCode` /
// `which` / `charCode` where the targeted code is genuinely layout- or
// IME-sensitive: any `charCode` read, relational character-range checks,
// and comparisons against resolvable numeric codes for letters, digits,
// or punctuation (which drift across keyboard layouts). Stays quiet on
// layout-invariant control keys (Enter, Escape, Space, Tab, arrows, …),
// unresolvable named key constants (`KeyCode.ENTER`), mouse-button
// `which`, the IME `keyCode === 229` idiom, handlers that already read
// `key`/`code` as a progressive-enhancement fallback, and object-literal
// event-synthesis keys.
export const noDeprecatedKeyboardEventKeycodeWhich = defineRule({
  id: "no-deprecated-keyboard-event-keycode-which",
  title: "Deprecated KeyboardEvent keyCode or which",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "`KeyboardEvent.keyCode`/`which`/`charCode` are deprecated and layout/engine dependent for character keys. Branch on `event.key` (logical key like `'/'`) or `event.code` (physical position) so the handler works across keyboard layouts and browsers.",
  create: (context: RuleContext) => ({
    MemberExpression(node: EsTreeNodeOfType<"MemberExpression">) {
      if (node.computed) return;
      if (!isNodeOfType(node.property, "Identifier")) return;
      const propertyName = node.property.name;
      if (!DEPRECATED_NUMERIC_MEMBERS.has(propertyName)) return;
      const receiver = node.object;
      if (!isNodeOfType(receiver, "Identifier")) return;
      const receiverName = receiver.name;

      const { conditionRoot, branching } = resolveBranchingContext(node as EsTreeNode);
      if (!branching) return;

      const enclosingFunction = getEnclosingFunction(node as EsTreeNode);
      if (!enclosingFunction || !isFunctionLike(enclosingFunction)) return;
      const firstParam = enclosingFunction.params?.[0];
      if (!firstParam || !isNodeOfType(firstParam as EsTreeNode, "Identifier")) return;
      const firstParamIdentifier = firstParam as EsTreeNodeOfType<"Identifier">;
      if (firstParamIdentifier.name !== receiverName) return;

      const signalTypedKeyboardEvent = typeReferenceIsKeyboardEvent(
        (firstParamIdentifier.typeAnnotation as EsTreeNode) ?? null,
      );
      const signalHandlerContext = functionIsKeyboardHandler(enclosingFunction);
      if (!signalTypedKeyboardEvent && !signalHandlerContext) return;

      // A same-file binding could shadow an outer param name, but the
      // first-param match above already anchors the receiver to this
      // handler's event parameter. Guard against a stray outer binding
      // that resolves to a non-parameter declaration.
      const binding = findVariableInitializer(receiver, receiverName);
      if (binding && binding.scopeOwner !== enclosingFunction) return;

      const comparison = getComparison(node as EsTreeNode);
      const comparedValue = comparison ? comparison.comparedValue : null;
      if (comparedValue === IME_COMPOSITION_KEYCODE) return;
      if (
        propertyName === "which" &&
        comparedValue !== null &&
        MOUSE_BUTTON_LITERALS.has(comparedValue)
      ) {
        return;
      }
      if (
        propertyName === "which" &&
        receiverReadsAnyProperty(enclosingFunction, receiverName, MOUSE_BUTTON_MEMBERS)
      ) {
        return;
      }
      if (receiverReadsAnyProperty(enclosingFunction, receiverName, STANDARD_KEY_MEMBERS)) return;

      if (propertyName !== "charCode") {
        const isRelationalRangeCheck = Boolean(
          comparison && RELATIONAL_OPERATORS.has(comparison.operator),
        );
        const comparesLayoutSensitiveCode =
          comparedValue !== null && isLayoutSensitiveCode(comparedValue);
        const switchesOnLayoutSensitiveCode = switchTargetsLayoutSensitiveCode(conditionRoot);
        if (
          !isRelationalRangeCheck &&
          !comparesLayoutSensitiveCode &&
          !switchesOnLayoutSensitiveCode
        ) {
          return;
        }
      }

      context.report({ node, message: MESSAGE });
    },
  }),
});
