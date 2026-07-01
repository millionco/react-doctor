import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripGroupingParens } from "../../utils/strip-grouping-parens.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";

const KEY_HANDLER_ATTRS = ["onKeyDown", "onKeyUp"] as const;
const NON_TEXT_ENTRY_ROLES = new Set([
  "button",
  "radio",
  "checkbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "tab",
  "switch",
  "link",
  "slider",
  "spinbutton",
  "treeitem",
  "gridcell",
]);
const TEXT_ENTRY_ROLES = new Set(["textbox", "searchbox", "combobox"]);
const NON_TEXT_INPUT_TYPES = new Set([
  "radio",
  "checkbox",
  "button",
  "submit",
  "reset",
  "file",
  "range",
  "color",
  "image",
  "hidden",
]);
const MODIFIER_PROPERTIES = new Set(["metaKey", "ctrlKey", "shiftKey", "altKey"]);
const COMPOSITION_TEXT_PATTERN = /compos/i;
const IME_COMPOSITION_KEYCODE = 229;
const ENTER_KEYCODE = 13;
const SPACE_KEYCODE = 32;

const MESSAGE =
  "This text-entry Enter handler commits/submits without bailing on IME composition, so it fires mid-composition for CJK users pressing Enter to confirm a candidate. Bail first with `if (e.nativeEvent.isComposing) return;` (or track `onCompositionStart`/`onCompositionEnd`) before acting on Enter.";

const getStringAttr = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  name: string,
): string | null => {
  const attribute = hasJsxPropIgnoreCase(node.attributes, name);
  return attribute ? getJsxPropStringValue(attribute) : null;
};

const isTextEntryElement = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const role = getStringAttr(node, "role");
  if (role && NON_TEXT_ENTRY_ROLES.has(role)) return false;

  const tag = isNodeOfType(node.name, "JSXIdentifier") ? node.name.name.toLowerCase() : "";
  if (tag === "textarea") return true;
  if (tag === "input") {
    const inputType = getStringAttr(node, "type");
    if (inputType && NON_TEXT_INPUT_TYPES.has(inputType.toLowerCase())) return false;
    return true;
  }
  if (hasJsxPropIgnoreCase(node.attributes, "contentEditable")) return true;
  if (role && TEXT_ENTRY_ROLES.has(role)) return true;
  return false;
};

const memberPropertyName = (node: EsTreeNode): string | null => {
  if (
    isNodeOfType(node, "MemberExpression") &&
    !node.computed &&
    isNodeOfType(node.property, "Identifier")
  ) {
    return node.property.name;
  }
  return null;
};

const isEnterKeyTest = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "BinaryExpression")) return false;
  if (node.operator !== "===" && node.operator !== "==") return false;
  const left = stripGroupingParens(node.left as EsTreeNode);
  const right = stripGroupingParens(node.right as EsTreeNode);
  const check = (memberSide: EsTreeNode, valueSide: EsTreeNode): boolean => {
    const property = memberPropertyName(memberSide);
    if (property === "key") {
      return isNodeOfType(valueSide, "Literal") && valueSide.value === "Enter";
    }
    if (property === "keyCode" || property === "which") {
      return isNodeOfType(valueSide, "Literal") && valueSide.value === ENTER_KEYCODE;
    }
    return false;
  };
  return check(left, right) || check(right, left);
};

interface EnterBranch {
  testExpr: EsTreeNode;
  actionNode: EsTreeNode;
}

const analyzeEnterBranch = (enterTest: EsTreeNode): EnterBranch | null => {
  let prev = enterTest;
  let cursor = enterTest.parent ?? null;
  while (cursor) {
    if (isFunctionLike(cursor)) break;
    if (isNodeOfType(cursor, "IfStatement")) {
      if (cursor.test === prev)
        return {
          testExpr: cursor.test as EsTreeNode,
          actionNode: cursor.consequent as EsTreeNode,
        };
      break;
    }
    if (isNodeOfType(cursor, "ConditionalExpression")) {
      if (cursor.test === prev)
        return {
          testExpr: cursor.test as EsTreeNode,
          actionNode: cursor.consequent as EsTreeNode,
        };
      break;
    }
    if (isNodeOfType(cursor, "ExpressionStatement")) {
      const expr = stripGroupingParens(cursor.expression as EsTreeNode);
      if (isNodeOfType(expr, "LogicalExpression") && expr.operator === "&&") {
        return { testExpr: expr, actionNode: expr };
      }
      break;
    }
    prev = cursor;
    cursor = cursor.parent ?? null;
  }
  return null;
};

const testUsesModifierOrSpace = (testExpr: EsTreeNode): boolean => {
  let found = false;
  walkAst(testExpr, (child) => {
    if (found) return false;
    const property = memberPropertyName(child);
    if (property && MODIFIER_PROPERTIES.has(property)) {
      found = true;
      return false;
    }
    if (
      isNodeOfType(child, "BinaryExpression") &&
      (child.operator === "===" || child.operator === "==")
    ) {
      const left = stripGroupingParens(child.left as EsTreeNode);
      const right = stripGroupingParens(child.right as EsTreeNode);
      const checkSpace = (memberSide: EsTreeNode, valueSide: EsTreeNode): boolean => {
        const memberProperty = memberPropertyName(memberSide);
        if (memberProperty === "key") {
          return (
            isNodeOfType(valueSide, "Literal") &&
            (valueSide.value === " " || valueSide.value === "Spacebar")
          );
        }
        if (memberProperty === "keyCode" || memberProperty === "which") {
          return isNodeOfType(valueSide, "Literal") && valueSide.value === SPACE_KEYCODE;
        }
        return false;
      };
      if (checkSpace(left, right) || checkSpace(right, left)) {
        found = true;
        return false;
      }
    }
  });
  return found;
};

const branchPerformsCommit = (actionNode: EsTreeNode): boolean => {
  let found = false;
  walkAst(actionNode, (child) => {
    if (found) return false;
    if (isNodeOfType(child, "CallExpression")) {
      found = true;
      return false;
    }
  });
  return found;
};

const componentHasCompositionGuard = (scope: EsTreeNode): boolean => {
  let found = false;
  walkAst(scope, (child) => {
    if (found) return false;
    if (
      (isNodeOfType(child, "Identifier") || isNodeOfType(child, "JSXIdentifier")) &&
      COMPOSITION_TEXT_PATTERN.test(child.name)
    ) {
      found = true;
      return false;
    }
    if (isNodeOfType(child, "Literal") && child.value === IME_COMPOSITION_KEYCODE) {
      found = true;
      return false;
    }
  });
  return found;
};

const getHandlerFunction = (node: EsTreeNodeOfType<"JSXOpeningElement">): EsTreeNode | null => {
  for (const attributeName of KEY_HANDLER_ATTRS) {
    const attribute = hasJsxPropIgnoreCase(node.attributes, attributeName);
    if (!attribute || !attribute.value) continue;
    if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) continue;
    const expression = stripGroupingParens(attribute.value.expression as EsTreeNode);
    if (isFunctionLike(expression)) return expression;
  }
  return null;
};

const findCompositionScope = (node: EsTreeNode): EsTreeNode => {
  let ancestor = node.parent ?? null;
  while (ancestor) {
    if (isFunctionLike(ancestor)) return ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return node.parent ?? node;
};

// Flags an `onKeyDown`/`onKeyUp` handler on a text-entry element that
// commits/submits on plain Enter without an IME-composition bail-out.
// Pressing Enter while an IME is composing confirms the candidate, so a
// bare Enter-submit fires mid-composition and corrupts input for CJK
// users. Stays quiet on non-text-entry roles (button/radio/menuitem),
// modifier-gated (Cmd/Ctrl+Enter) or Space+Enter activation, and handlers
// already guarded by `isComposing` / `keyCode === 229` / composition
// state.
export const noEnterSubmitWithoutImeCompositionGuard = defineRule({
  id: "no-enter-submit-without-ime-composition-guard",
  title: "Enter submit without IME composition guard",
  severity: "warn",
  category: "Correctness",
  tags: ["react-jsx-only"],
  recommendation:
    "Bail on IME composition before acting on Enter: `if (e.nativeEvent.isComposing) return;` (or track composition with `onCompositionStart`/`onCompositionEnd`). Otherwise Enter fires mid-composition and commits a half-typed value for CJK users.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isTextEntryElement(node)) return;
      const handler = getHandlerFunction(node);
      if (!handler) return;

      const enterTests: EsTreeNode[] = [];
      walkAst(handler, (child) => {
        if (isEnterKeyTest(child)) enterTests.push(child);
      });
      if (enterTests.length === 0) return;

      let hasBareEnterCommit = false;
      for (const enterTest of enterTests) {
        const branch = analyzeEnterBranch(enterTest);
        if (!branch) continue;
        if (testUsesModifierOrSpace(branch.testExpr)) continue;
        if (!branchPerformsCommit(branch.actionNode)) continue;
        hasBareEnterCommit = true;
        break;
      }
      if (!hasBareEnterCommit) return;

      const scope = findCompositionScope(node as EsTreeNode);
      if (componentHasCompositionGuard(scope)) return;

      context.report({ node: node.name as EsTreeNode, message: MESSAGE });
    },
  }),
});
