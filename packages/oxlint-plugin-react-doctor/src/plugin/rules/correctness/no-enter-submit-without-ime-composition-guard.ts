import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { getSingleReturnExpression } from "../../utils/get-single-return-expression.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isJsxAttributePotentiallyTruthy } from "../../utils/is-jsx-attribute-potentially-truthy.js";
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
const NON_COMMIT_CONSOLE_METHODS = new Set(["debug", "error", "info", "log", "trace", "warn"]);
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
  return isNodeOfType(node, "MemberExpression") ? getStaticPropertyName(node) : null;
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
  if (
    isJsxAttributePotentiallyTruthy(hasJsxPropIgnoreCase(node.attributes, "readOnly")) ||
    isJsxAttributePotentiallyTruthy(hasJsxPropIgnoreCase(node.attributes, "disabled"))
  ) {
    return false;
  }

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
const expressionRequiresModifier = (
  expression: EsTreeNode,
  predicateResult: boolean,
  visitedFunctions: ReadonlySet<EsTreeNode> = new Set(),
): boolean => {
  const strippedExpression = stripGroupingParens(expression);
  if (isNodeOfType(strippedExpression, "UnaryExpression") && strippedExpression.operator === "!") {
    return expressionRequiresModifier(
      strippedExpression.argument,
      !predicateResult,
      visitedFunctions,
    );
  }
  if (isNodeOfType(strippedExpression, "LogicalExpression")) {
    if (strippedExpression.operator === "&&" && predicateResult) {
      return (
        expressionRequiresModifier(strippedExpression.left, true, visitedFunctions) ||
        expressionRequiresModifier(strippedExpression.right, true, visitedFunctions)
      );
    }
    if (strippedExpression.operator === "||" && !predicateResult) {
      return (
        expressionRequiresModifier(strippedExpression.left, false, visitedFunctions) ||
        expressionRequiresModifier(strippedExpression.right, false, visitedFunctions)
      );
    }
    if (strippedExpression.operator === "||" && predicateResult) {
      return (
        expressionRequiresModifier(strippedExpression.left, true, visitedFunctions) &&
        expressionRequiresModifier(strippedExpression.right, true, visitedFunctions)
      );
    }
    return false;
  }
  const propertyName = memberPropertyName(strippedExpression);
  if (propertyName && MODIFIER_PROPERTIES.has(propertyName)) return predicateResult;
  if (isNodeOfType(strippedExpression, "CallExpression")) {
    const calledFunction = resolveCalledFunction(strippedExpression);
    if (calledFunction && !visitedFunctions.has(calledFunction)) {
      const returnedExpression = getSingleReturnExpression(calledFunction);
      return Boolean(
        returnedExpression &&
        expressionRequiresModifier(
          returnedExpression,
          predicateResult,
          new Set([...visitedFunctions, calledFunction]),
        ),
      );
    }
  }
  return false;
};

const testUsesModifierOrSpace = (testExpr: EsTreeNode): boolean =>
  expressionRequiresModifier(testExpr, true) || scopeUsesSpace(testExpr);

const scopeUsesSpace = (testExpr: EsTreeNode): boolean => {
  let found = false;
  walkAst(testExpr, (child) => {
    if (found) return false;
    if (isNodeOfType(child, "UnaryExpression") && child.operator === "!") return false;
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

const branchPerformsCommit = (actionNode: EsTreeNode, context: RuleContext): boolean => {
  let found = false;
  walkAst(actionNode, (child) => {
    if (found) return false;
    if (child !== actionNode && isFunctionLike(child)) return false;
    if (isNodeOfType(child, "CallExpression")) {
      const callee = stripGroupingParens(child.callee as EsTreeNode);
      const calleeProperty = memberPropertyName(callee);
      if (calleeProperty && NON_COMMIT_CALL_PROPERTIES.has(calleeProperty)) return;
      if (
        calleeProperty &&
        NON_COMMIT_CONSOLE_METHODS.has(calleeProperty) &&
        isNodeOfType(callee, "MemberExpression") &&
        isNodeOfType(callee.object, "Identifier") &&
        callee.object.name === "console" &&
        context.scopes.isGlobalReference(callee.object)
      ) {
        return;
      }
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

const subtreeHasCompositionSignal = (scope: EsTreeNode): boolean => {
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

const mergeCompositionState = (
  leftState: boolean | null,
  rightState: boolean | null,
): boolean | null => {
  if (leftState === null) return rightState;
  if (rightState === null) return leftState;
  return leftState === rightState ? leftState : null;
};

const compositionIsActiveWhenPredicate = (
  expression: EsTreeNode,
  predicateResult: boolean,
): boolean | null => {
  const strippedExpression = stripGroupingParens(expression);
  if (isNodeOfType(strippedExpression, "UnaryExpression") && strippedExpression.operator === "!") {
    return compositionIsActiveWhenPredicate(strippedExpression.argument, !predicateResult);
  }
  if (isNodeOfType(strippedExpression, "LogicalExpression")) {
    if (strippedExpression.operator === "&&" && predicateResult) {
      return mergeCompositionState(
        compositionIsActiveWhenPredicate(strippedExpression.left, true),
        compositionIsActiveWhenPredicate(strippedExpression.right, true),
      );
    }
    if (strippedExpression.operator === "||" && !predicateResult) {
      return mergeCompositionState(
        compositionIsActiveWhenPredicate(strippedExpression.left, false),
        compositionIsActiveWhenPredicate(strippedExpression.right, false),
      );
    }
    return null;
  }
  if (
    (isNodeOfType(strippedExpression, "Identifier") ||
      isNodeOfType(strippedExpression, "MemberExpression") ||
      isNodeOfType(strippedExpression, "CallExpression")) &&
    subtreeHasCompositionSignal(strippedExpression)
  ) {
    return predicateResult;
  }
  if (!isNodeOfType(strippedExpression, "BinaryExpression")) return null;
  if (
    strippedExpression.operator !== "===" &&
    strippedExpression.operator !== "==" &&
    strippedExpression.operator !== "!==" &&
    strippedExpression.operator !== "!="
  ) {
    return null;
  }
  const left = stripGroupingParens(strippedExpression.left);
  const right = stripGroupingParens(strippedExpression.right);
  const isImeKeyCodeMember = (candidate: EsTreeNode): boolean => {
    const propertyName = memberPropertyName(candidate);
    return propertyName === "keyCode" || propertyName === "which";
  };
  const isImeKeyCodeValue = (candidate: EsTreeNode): boolean =>
    (isNodeOfType(candidate, "Literal") && candidate.value === IME_COMPOSITION_KEYCODE) ||
    (isNodeOfType(candidate, "Identifier") && identifierHasImeWord(candidate.name));
  const isEquality = strippedExpression.operator === "===" || strippedExpression.operator === "==";
  if (
    (isImeKeyCodeMember(left) && isImeKeyCodeValue(right)) ||
    (isImeKeyCodeMember(right) && isImeKeyCodeValue(left))
  ) {
    return predicateResult === isEquality;
  }
  const compositionSide = subtreeHasCompositionSignal(left)
    ? left
    : subtreeHasCompositionSignal(right)
      ? right
      : null;
  const valueSide = compositionSide === left ? right : left;
  if (!compositionSide || !isNodeOfType(valueSide, "Literal")) return null;
  if (typeof valueSide.value === "boolean") {
    const comparisonResultWhenActive = isEquality ? valueSide.value : !valueSide.value;
    return predicateResult === comparisonResultWhenActive;
  }
  if (valueSide.value === IME_COMPOSITION_KEYCODE) {
    return predicateResult === isEquality;
  }
  return null;
};

const statementTerminatesFlow = (statement: EsTreeNode): boolean => {
  if (isNodeOfType(statement, "ReturnStatement") || isNodeOfType(statement, "ThrowStatement")) {
    return true;
  }
  if (!isNodeOfType(statement, "BlockStatement")) return false;
  const lastStatement = statement.body.at(-1);
  return Boolean(lastStatement && statementTerminatesFlow(lastStatement));
};

const hasPriorCompositionEarlyExit = (handler: EsTreeNode, branchTest: EsTreeNode): boolean => {
  let current: EsTreeNode = branchTest;
  while (current !== handler) {
    const parent = current.parent ?? null;
    if (!parent) return false;
    if (isNodeOfType(parent, "BlockStatement")) {
      const currentIndex = parent.body.findIndex((statement) => statement === current);
      if (currentIndex >= 0) {
        for (let statementIndex = 0; statementIndex < currentIndex; statementIndex += 1) {
          const statement = parent.body[statementIndex];
          if (
            isNodeOfType(statement, "IfStatement") &&
            compositionIsActiveWhenPredicate(statement.test, true) === true &&
            statementTerminatesFlow(statement.consequent)
          ) {
            return true;
          }
        }
      }
    }
    current = parent;
  }
  return false;
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

const isInsideCompositionSafeCondition = (node: EsTreeNode, boundary: EsTreeNode): boolean => {
  let child = node;
  let ancestor = node.parent ?? null;
  while (ancestor && ancestor !== boundary) {
    if (isNodeOfType(ancestor, "IfStatement") || isNodeOfType(ancestor, "ConditionalExpression")) {
      let predicateResult: boolean | null = null;
      if (ancestor.consequent === child) predicateResult = true;
      else if (ancestor.alternate === child) predicateResult = false;
      if (
        predicateResult !== null &&
        compositionIsActiveWhenPredicate(ancestor.test, predicateResult) === false
      ) {
        return true;
      }
    }
    if (
      (isNodeOfType(ancestor, "WhileStatement") || isNodeOfType(ancestor, "DoWhileStatement")) &&
      ancestor.body === child &&
      compositionIsActiveWhenPredicate(ancestor.test, true) === false
    ) {
      return true;
    }
    if (isNodeOfType(ancestor, "LogicalExpression") && ancestor.right === child) {
      let predicateResult: boolean | null = null;
      if (ancestor.operator === "&&") predicateResult = true;
      else if (ancestor.operator === "||") predicateResult = false;
      if (
        predicateResult !== null &&
        compositionIsActiveWhenPredicate(ancestor.left, predicateResult) === false
      ) {
        return true;
      }
    }
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

const resolveCalledFunction = (call: EsTreeNodeOfType<"CallExpression">): EsTreeNode | null => {
  const callee = stripGroupingParens(call.callee as EsTreeNode);
  if (isNodeOfType(callee, "Identifier")) {
    const binding = findVariableInitializer(callee, callee.name);
    return binding?.initializer && isFunctionLike(binding.initializer) ? binding.initializer : null;
  }
  if (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.object, "ThisExpression") &&
    !callee.computed &&
    isNodeOfType(callee.property, "Identifier")
  ) {
    return resolveClassMemberFunction(call, callee.property.name);
  }
  return null;
};

const scopeCommitsAreCompositionGuarded = (
  scope: EsTreeNode,
  visitedFunctions: Set<EsTreeNode>,
): boolean => {
  if (visitedFunctions.has(scope)) return false;
  visitedFunctions.add(scope);
  let foundCommit = false;
  let foundUnguardedCommit = false;
  walkAst(scope, (child) => {
    if (foundUnguardedCommit) return false;
    if (child !== scope && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    const calleeProperty = memberPropertyName(stripGroupingParens(child.callee as EsTreeNode));
    if (calleeProperty && NON_COMMIT_CALL_PROPERTIES.has(calleeProperty)) return;
    foundCommit = true;
    if (isInsideCompositionSafeCondition(child, scope)) return;
    if (hasPriorCompositionEarlyExit(scope, child)) return;
    const calledFunction = resolveCalledFunction(child);
    if (
      calledFunction &&
      scopeCommitsAreCompositionGuarded(calledFunction, new Set(visitedFunctions))
    ) {
      return;
    }
    foundUnguardedCommit = true;
    return false;
  });
  return foundCommit && !foundUnguardedCommit;
};

const getHandlerFunction = (node: EsTreeNodeOfType<"JSXOpeningElement">): EsTreeNode | null => {
  for (const attributeName of KEY_HANDLER_ATTRS) {
    const attribute = hasJsxPropIgnoreCase(node.attributes, attributeName);
    if (!attribute || !attribute.value) continue;
    if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) continue;
    const expression = stripGroupingParens(attribute.value.expression as EsTreeNode);
    if (isFunctionLike(expression)) return expression;
    if (isNodeOfType(expression, "Identifier")) {
      const binding = findVariableInitializer(expression, expression.name);
      if (binding?.initializer && isFunctionLike(binding.initializer)) return binding.initializer;
    }
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
// composition state read in the handler body or in a same-file function
// the Enter action calls. A negated modifier
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
        if (child !== handler && isFunctionLike(child)) return false;
        if (isEnterKeyTest(child)) enterTests.push(child);
      });
      if (enterTests.length === 0) return;

      let hasBareEnterCommit = false;
      for (const enterTest of enterTests) {
        const branch = analyzeEnterBranch(enterTest);
        if (!branch) continue;
        if (
          compositionIsActiveWhenPredicate(branch.testExpr, true) === false ||
          hasPriorCompositionEarlyExit(handler, branch.testExpr)
        ) {
          continue;
        }
        if (testUsesModifierOrSpace(branch.testExpr)) continue;
        if (!branchPerformsCommit(branch.actionNode, context)) continue;
        if (scopeCommitsAreCompositionGuarded(branch.actionNode, new Set())) continue;
        hasBareEnterCommit = true;
        break;
      }
      if (!hasBareEnterCommit) return;

      context.report({ node: node.name as EsTreeNode, message: MESSAGE });
    },
  }),
});
