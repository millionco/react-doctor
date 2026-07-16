import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
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
  "number",
  "password",
  "tel",
  "date",
  "time",
  "week",
  "month",
  "datetime-local",
]);
const NUMERIC_INPUT_MODES = new Set(["numeric", "decimal"]);
const NUMERIC_COERCION_CALLEES = new Set(["Number", "parseInt", "parseFloat"]);
const NON_COMMIT_CALL_PROPERTIES = new Set([
  "preventDefault",
  "stopPropagation",
  "stopImmediatePropagation",
]);
const MODIFIER_PROPERTIES = new Set(["metaKey", "ctrlKey", "shiftKey", "altKey"]);
const COMPOSITION_TEXT_PATTERN = /composi/i;
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

const argumentReadsValueMember = (argument: EsTreeNode): boolean => {
  let readsValue = false;
  walkAst(argument, (child) => {
    if (readsValue) return false;
    if (memberPropertyName(child) === "value") {
      readsValue = true;
      return false;
    }
  });
  return readsValue;
};

// Regexes an onChange uses to strip a field down to digits — the field has
// numeric semantics even though its `type` stays "text".
const DIGIT_STRIP_REGEX_SOURCE = /\\D|\[\^0-9\]|\[\^\\d\]/;

const isDigitStripReplaceOfValue = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = stripGroupingParens(node.callee as EsTreeNode);
  if (memberPropertyName(callee) !== "replace") return false;
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const pattern = node.arguments[0];
  if (!pattern || !isNodeOfType(pattern, "Literal") || !("regex" in pattern)) return false;
  if (
    typeof pattern.regex?.pattern !== "string" ||
    !DIGIT_STRIP_REGEX_SOURCE.test(pattern.regex.pattern)
  ) {
    return false;
  }
  return argumentReadsValueMember(callee.object as EsTreeNode);
};

const isNumericCoercionOfValue = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "UnaryExpression") && node.operator === "+") {
    return argumentReadsValueMember(node.argument as EsTreeNode);
  }
  if (isDigitStripReplaceOfValue(node)) return true;
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = stripGroupingParens(node.callee as EsTreeNode);
  let calleeName: string | null = null;
  if (isNodeOfType(callee, "Identifier")) {
    calleeName = callee.name;
  } else if (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "Number" &&
    isNodeOfType(callee.property, "Identifier")
  ) {
    calleeName = callee.property.name;
  }
  if (!calleeName || !NUMERIC_COERCION_CALLEES.has(calleeName)) return false;
  const firstArgument = node.arguments[0];
  return Boolean(firstArgument) && argumentReadsValueMember(firstArgument as EsTreeNode);
};

const onChangeCoercesValueNumerically = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const attribute = hasJsxPropIgnoreCase(node.attributes, "onChange");
  if (!attribute || !attribute.value) return false;
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return false;
  let changeHandler = stripGroupingParens(attribute.value.expression as EsTreeNode);
  // `onChange={handleChange}` — resolve the same-file named handler so an
  // extracted numeric-coercion handler counts the same as an inline one.
  if (isNodeOfType(changeHandler, "Identifier")) {
    const binding = findVariableInitializer(changeHandler, changeHandler.name);
    if (binding?.initializer) changeHandler = binding.initializer;
  }
  if (!isFunctionLike(changeHandler)) return false;
  let coercesValue = false;
  walkAst(changeHandler, (child) => {
    if (coercesValue) return false;
    if (isNumericCoercionOfValue(child)) {
      coercesValue = true;
      return false;
    }
  });
  return coercesValue;
};

// A dynamic `type={...}` that can resolve to a non-text type — the
// password-reveal toggle `type={show ? "text" : "password"}` is the dominant
// shape — keeps its non-text semantics (no IME composition in practice).
const typeAttributeCanBeNonText = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const attribute = hasJsxPropIgnoreCase(node.attributes, "type");
  if (!attribute?.value || !isNodeOfType(attribute.value, "JSXExpressionContainer")) return false;
  let canBeNonText = false;
  walkAst(attribute.value.expression as EsTreeNode, (child) => {
    if (canBeNonText) return false;
    if (
      isNodeOfType(child, "Literal") &&
      typeof child.value === "string" &&
      NON_TEXT_INPUT_TYPES.has(child.value.toLowerCase())
    ) {
      canBeNonText = true;
      return false;
    }
  });
  return canBeNonText;
};

// `contentEditable` only makes an element text-entry when it is actually
// editable — `contentEditable={false}` marks an atomic non-editable embed
// (activating it on Enter is deliberate and composition-free).
const isEditableContentEditable = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const attribute = hasJsxPropIgnoreCase(node.attributes, "contentEditable");
  if (!attribute) return false;
  if (!attribute.value) return true;
  if (isNodeOfType(attribute.value, "Literal")) return attribute.value.value !== "false";
  if (isNodeOfType(attribute.value, "JSXExpressionContainer")) {
    const expression = stripGroupingParens(attribute.value.expression as EsTreeNode);
    if (isNodeOfType(expression, "Literal")) {
      return expression.value !== false && expression.value !== "false";
    }
  }
  return true;
};

const isTextEntryElement = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const role = getStringAttr(node, "role");
  if (role && NON_TEXT_ENTRY_ROLES.has(role)) return false;
  if (hasJsxPropIgnoreCase(node.attributes, "readOnly")) return false;

  const inputMode = getStringAttr(node, "inputMode");
  if (inputMode && NUMERIC_INPUT_MODES.has(inputMode.toLowerCase())) return false;
  if (onChangeCoercesValueNumerically(node)) return false;

  const tag = isNodeOfType(node.name, "JSXIdentifier") ? node.name.name.toLowerCase() : "";
  if (tag === "textarea") return true;
  if (tag === "input") {
    const inputType = getStringAttr(node, "type");
    if (inputType && NON_TEXT_INPUT_TYPES.has(inputType.toLowerCase())) return false;
    if (!inputType && typeAttributeCanBeNonText(node)) return false;
    return true;
  }
  if (isEditableContentEditable(node)) return true;
  if (role && TEXT_ENTRY_ROLES.has(role)) return true;
  return false;
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

// The modifier gate may be extracted into a same-file helper —
// `if (e.key === 'Enter' && isModEnter(e))` — so scan the resolved bodies of
// helpers called from the test expression alongside the test itself.
const testUsesModifierOrSpace = (testExpr: EsTreeNode): boolean =>
  [testExpr, ...handlerCalleeInitializers(testExpr)].some(scopeUsesModifierOrSpace);

const scopeUsesModifierOrSpace = (testExpr: EsTreeNode): boolean => {
  let found = false;
  walkAst(testExpr, (child) => {
    if (found) return false;
    if (isNodeOfType(child, "UnaryExpression") && child.operator === "!") return false;
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
      const calleeProperty = memberPropertyName(stripGroupingParens(child.callee as EsTreeNode));
      if (calleeProperty && NON_COMMIT_CALL_PROPERTIES.has(calleeProperty)) return;
      found = true;
      return false;
    }
  });
  return found;
};

// "ime" as a standalone word in an identifier (`imeActive`, `isImeKeyEvent`,
// `IME_PROCESS_KEYCODE`) signals composition wiring the same way /composi/i
// does. Word-split on case/underscore boundaries so `time` / `setTimeout`
// never match.
const identifierHasImeWord = (name: string): boolean =>
  name
    .split(/[_\-$]+/)
    .flatMap((part) => part.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/))
    .some((word) => word.toLowerCase() === "ime");

const scopeHasCompositionGuard = (scope: EsTreeNode): boolean => {
  let found = false;
  walkAst(scope, (child) => {
    if (found) return false;
    if (
      (isNodeOfType(child, "Identifier") || isNodeOfType(child, "JSXIdentifier")) &&
      (COMPOSITION_TEXT_PATTERN.test(child.name) || identifierHasImeWord(child.name))
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

// `this.commitEntry()` delegates to a class member — resolve it to the
// method/property function on the enclosing class so a guard inside the
// instance method suppresses the same way a resolved const helper does.
const resolveClassMemberFunction = (
  callSite: EsTreeNode,
  memberName: string,
): EsTreeNode | null => {
  let cursor: EsTreeNode | null = callSite;
  while (cursor) {
    if (isNodeOfType(cursor, "ClassBody")) {
      for (const element of cursor.body) {
        const classElement = element as EsTreeNode;
        if (
          (isNodeOfType(classElement, "MethodDefinition") ||
            isNodeOfType(classElement, "PropertyDefinition")) &&
          isNodeOfType(classElement.key, "Identifier") &&
          classElement.key.name === memberName &&
          classElement.value &&
          isFunctionLike(classElement.value as EsTreeNode)
        ) {
          return classElement.value as EsTreeNode;
        }
      }
      return null;
    }
    cursor = cursor.parent ?? null;
  }
  return null;
};

// Same-file function bodies reachable from the handler through bare
// identifier calls (`commitEdit()` resolved to its `const commitEdit = …`
// or `function commitEdit` initializer, then that body's own callees,
// transitively) or `this.commitEdit()` class-member calls — a composition
// guard may live inside the commit helper chain rather than the inline
// handler.
const handlerCalleeInitializers = (handler: EsTreeNode): EsTreeNode[] => {
  const initializers: EsTreeNode[] = [];
  const seenCalleeNames = new Set<string>();
  const pendingScopes: EsTreeNode[] = [handler];
  while (pendingScopes.length > 0) {
    const scope = pendingScopes.pop();
    if (!scope) continue;
    walkAst(scope, (child) => {
      if (!isNodeOfType(child, "CallExpression")) return;
      const callee = stripGroupingParens(child.callee as EsTreeNode);
      if (isNodeOfType(callee, "Identifier")) {
        if (seenCalleeNames.has(callee.name)) return;
        seenCalleeNames.add(callee.name);
        const binding = findVariableInitializer(callee, callee.name);
        if (binding?.initializer) {
          initializers.push(binding.initializer);
          pendingScopes.push(binding.initializer);
        }
        return;
      }
      if (
        isNodeOfType(callee, "MemberExpression") &&
        isNodeOfType(callee.object, "ThisExpression") &&
        !callee.computed &&
        isNodeOfType(callee.property, "Identifier")
      ) {
        const memberName = `this.${callee.property.name}`;
        if (seenCalleeNames.has(memberName)) return;
        seenCalleeNames.add(memberName);
        const memberFunction = resolveClassMemberFunction(child, callee.property.name);
        if (memberFunction) {
          initializers.push(memberFunction);
          pendingScopes.push(memberFunction);
        }
      }
    });
  }
  return initializers;
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

// Flags an `onKeyDown`/`onKeyUp` handler on a text-entry element that
// commits/submits on plain Enter without an IME-composition bail-out.
// Pressing Enter while an IME is composing confirms the candidate, so a
// bare Enter-submit fires mid-composition and corrupts input for CJK
// users. Stays quiet on non-text-entry roles (button/radio/menuitem),
// inputs that cannot host composition (type number/password/date/time,
// `inputMode` numeric/decimal, `readOnly`, or an `onChange` that coerces
// the value via Number/parseInt/parseFloat), modifier-gated
// (Cmd/Ctrl+Enter) or Space+Enter activation, `preventDefault`-only
// handlers, and handlers guarded by `isComposing` / `keyCode === 229` /
// composition wiring on the element itself, in the handler body, or in a
// same-file function the handler calls — a sibling control's guard does
// not protect this handler and does not suppress. A negated modifier
// (`!e.shiftKey`) is not a gate — plain Enter still commits there.
//
// KNOWN ACCEPTED NOISE: a commit gated on a validity flag whose setter
// rejects non-ASCII input (bulwarkmail's sub-address tag field, where an
// imported `TAG_REGEX = /^[a-zA-Z0-9-]{1,30}$/` sets `error` on every
// keystroke, so `tag && !error` can never hold mid-composition) still
// fires. Proving the gate excludes IME text requires resolving the
// validator's regex across files, and validity gates themselves are not
// a discriminator — `if (e.key === 'Enter' && isValid) onSave()` over
// natural-language fields is a REAL bug this rule must keep flagging.
export const noEnterSubmitWithoutImeCompositionGuard = defineRule({
  id: "no-enter-submit-without-ime-composition-guard",
  title: "Enter submit without IME composition guard",
  severity: "warn",
  category: "Correctness",
  tags: ["react-jsx-only"],
  // Gated on the `i18n` capability: the missing guard only misbehaves for
  // composed (IME) input, so the rule stays silent on projects with no
  // internationalization library — where flagging every plain-Enter submit
  // is noise, not protection.
  requires: ["i18n"],
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

      // A composition guard only protects THIS handler when it is wired
      // on the element itself (`onCompositionStart`/`onCompositionEnd`
      // attrs), read inside the handler (`isComposing`, `229`), or
      // checked inside a same-file function the handler calls. A sibling
      // control's guard elsewhere in the component does not stop this
      // handler firing mid-composition, so it must not suppress.
      const guardScopes = [node as EsTreeNode, ...handlerCalleeInitializers(handler)];
      if (guardScopes.some(scopeHasCompositionGuard)) return;

      context.report({ node: node.name as EsTreeNode, message: MESSAGE });
    },
  }),
});
