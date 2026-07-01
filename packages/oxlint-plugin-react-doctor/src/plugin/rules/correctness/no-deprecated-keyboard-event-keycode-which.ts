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
const MOUSE_BUTTON_LITERALS = new Set([1, 2, 3, 4]);
const IME_COMPOSITION_KEYCODE = 229;
const KEYBOARD_HANDLER_NAME_PATTERN = /key(down|up|press)/i;
const KEYBOARD_LISTENER_EVENTS = new Set(["keydown", "keyup", "keypress"]);

const MESSAGE =
  "`KeyboardEvent.keyCode`/`which`/`charCode` are deprecated and vary by keyboard layout, browser, and input method, so this branch fires on the wrong key (or never) for untested layouts. Branch on the standardized `event.key` (logical key) or `event.code` (physical key) instead.";

const meaningfulParent = (node: EsTreeNode): EsTreeNode | null => {
  let parent = node.parent ?? null;
  while (parent && parent.type === PARENTHESIZED_EXPRESSION) parent = parent.parent ?? null;
  return parent;
};

const getComparedNumericLiteral = (memberNode: EsTreeNode): number | null => {
  const parent = meaningfulParent(memberNode);
  if (!parent || !isNodeOfType(parent, "BinaryExpression")) return null;
  if (!COMPARISON_OPERATORS.has(parent.operator)) return null;
  const other =
    stripGroupingParens(parent.left as EsTreeNode) === memberNode ? parent.right : parent.left;
  const otherNode = stripGroupingParens(other as EsTreeNode);
  if (isNodeOfType(otherNode, "Literal") && typeof otherNode.value === "number") {
    return otherNode.value;
  }
  return null;
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

const conditionAlsoReadsKeyOrCode = (conditionRoot: EsTreeNode, receiverName: string): boolean => {
  let found = false;
  walkAst(conditionRoot, (child) => {
    if (found) return false;
    if (
      isNodeOfType(child, "MemberExpression") &&
      !child.computed &&
      isNodeOfType(child.object, "Identifier") &&
      child.object.name === receiverName &&
      isNodeOfType(child.property, "Identifier") &&
      (child.property.name === "key" || child.property.name === "code")
    ) {
      found = true;
      return false;
    }
  });
  return found;
};

const receiverAlsoReadsMouseButton = (fnNode: EsTreeNode, receiverName: string): boolean => {
  let found = false;
  walkAst(fnNode, (child) => {
    if (found) return false;
    if (
      isNodeOfType(child, "MemberExpression") &&
      !child.computed &&
      isNodeOfType(child.object, "Identifier") &&
      child.object.name === receiverName &&
      isNodeOfType(child.property, "Identifier") &&
      (child.property.name === "button" || child.property.name === "buttons")
    ) {
      found = true;
      return false;
    }
  });
  return found;
};

// Flags branching on a KeyboardEvent's deprecated numeric `keyCode` /
// `which` / `charCode` instead of the standardized `key` / `code`. The
// numeric codes drift across keyboard layouts, browsers, and input
// methods, so a switch/if keyed off them silently mishandles keys for
// untested layouts. Stays quiet on mouse-button `which`, the IME
// `keyCode === 229` idiom, transitional `key || which` fallbacks, and
// object-literal event-synthesis keys.
export const noDeprecatedKeyboardEventKeycodeWhich = defineRule({
  id: "no-deprecated-keyboard-event-keycode-which",
  title: "Deprecated KeyboardEvent keyCode or which",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "`KeyboardEvent.keyCode`/`which`/`charCode` are deprecated and layout/engine dependent. Branch on `event.key` (logical key like `'Escape'`) or `event.code` (physical position) so the handler works across keyboard layouts and browsers.",
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

      const comparedLiteral = getComparedNumericLiteral(node as EsTreeNode);
      if (comparedLiteral === IME_COMPOSITION_KEYCODE) return;
      if (
        propertyName === "which" &&
        comparedLiteral !== null &&
        MOUSE_BUTTON_LITERALS.has(comparedLiteral)
      ) {
        return;
      }
      if (
        propertyName === "which" &&
        receiverAlsoReadsMouseButton(enclosingFunction, receiverName)
      ) {
        return;
      }
      if (conditionAlsoReadsKeyOrCode(conditionRoot, receiverName)) return;

      context.report({ node, message: MESSAGE });
    },
  }),
});
