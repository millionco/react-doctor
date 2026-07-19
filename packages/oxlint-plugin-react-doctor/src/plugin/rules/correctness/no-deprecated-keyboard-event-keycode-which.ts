import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isNonSourceFilename } from "../../utils/is-non-source-filename.js";
import { stripGroupingParens } from "../../utils/strip-grouping-parens.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { statementAlwaysExits } from "../../utils/statement-always-exits.js";
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
// keyCode 0 is the legacy "unidentified"/IME-in-progress marker some
// engines emit alongside 229 — comparing against either is the
// progressive IME guard, not layout-sensitive branching.
const LEGACY_IME_KEYCODES = new Set([0, IME_COMPOSITION_KEYCODE]);
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

const resolveNumericValue = (operand: EsTreeNode, context: RuleContext): number | null => {
  const valueNode = stripGroupingParens(operand);
  if (isNodeOfType(valueNode, "Literal") && typeof valueNode.value === "number") {
    return valueNode.value;
  }
  if (isNodeOfType(valueNode, "Identifier")) {
    const symbol = context.scopes.symbolFor(valueNode);
    if (!symbol || symbol.kind !== "const") return null;
    const initializer = symbol.initializer;
    if (
      initializer &&
      !symbol.references.some((reference) => reference.flag !== "read") &&
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

const getComparison = (
  memberNode: EsTreeNode,
  context: RuleContext,
): DeprecatedReadComparison | null => {
  const parent = findTransparentExpressionRoot(memberNode).parent;
  if (!parent || !isNodeOfType(parent, "BinaryExpression")) return null;
  if (!COMPARISON_OPERATORS.has(parent.operator)) return null;
  const otherOperand =
    stripParenExpression(parent.left as EsTreeNode) === stripParenExpression(memberNode)
      ? parent.right
      : parent.left;
  return {
    operator: parent.operator,
    comparedValue: resolveNumericValue(otherOperand as EsTreeNode, context),
  };
};

const isLayoutSensitiveCode = (value: number): boolean =>
  !LEGACY_IME_KEYCODES.has(value) && !LAYOUT_INVARIANT_CONTROL_KEYCODES.has(value);

const switchTargetsLayoutSensitiveCode = (
  conditionRoot: EsTreeNode,
  context: RuleContext,
): boolean => {
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
    const caseValue = resolveNumericValue(testNode as EsTreeNode, context);
    return caseValue !== null && isLayoutSensitiveCode(caseValue);
  });
};

interface BranchingContext {
  conditionRoot: EsTreeNode;
  branching: boolean;
  climbedThroughLogical: boolean;
}

const resolveBranchingContext = (memberNode: EsTreeNode): BranchingContext => {
  let node = findTransparentExpressionRoot(memberNode);
  let climbedThroughComparison = false;
  let climbedThroughLogical = false;
  while (node.parent) {
    const parent = node.parent;
    if (parent.type === PARENTHESIZED_EXPRESSION || parent.type === "UnaryExpression") {
      node = findTransparentExpressionRoot(parent);
      continue;
    }
    if (parent.type === "LogicalExpression") {
      climbedThroughLogical = true;
      node = findTransparentExpressionRoot(parent);
      continue;
    }
    if (isNodeOfType(parent, "BinaryExpression") && COMPARISON_OPERATORS.has(parent.operator)) {
      climbedThroughComparison = true;
      node = findTransparentExpressionRoot(parent);
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
    climbedThroughLogical,
  };
};

const LOGIC_SINK_PARENT_TYPES = new Set([
  "VariableDeclarator",
  "AssignmentExpression",
  "ReturnStatement",
]);

// Climbs from a property read to the value it produces: through grouping
// parens, member chains rooted at the read (`event.key.toLowerCase()`),
// and calls of those chains, so the classification below sees where the
// derived value lands rather than the raw read.
const readValueRoot = (readNode: EsTreeNode): EsTreeNode => {
  let current = readNode;
  while (current.parent) {
    const parent = current.parent;
    if (parent.type === PARENTHESIZED_EXPRESSION || isNodeOfType(parent, "ChainExpression")) {
      current = parent;
      continue;
    }
    if (isNodeOfType(parent, "MemberExpression") && parent.object === current) {
      current = parent;
      continue;
    }
    if (isNodeOfType(parent, "CallExpression") && parent.callee === current) {
      current = parent;
      continue;
    }
    break;
  }
  return current;
};

// A `key`/`code` read only signals the progressive-enhancement fallback
// idiom when its value feeds logic: a comparison, a branch test or switch
// discriminant, a `||`/`??` fallback chain, an alias/assignment/return
// that carries it onward, or a helper call whose RESULT feeds logic
// (`if (isHotkey(event.key))`). A read whose value is discarded
// (`console.log(event.key);`) leaves the deprecated branching as the
// sole control path and must not suppress the report.
const readFeedsLogic = (readNode: EsTreeNode): boolean => {
  const valueRoot = readValueRoot(readNode);
  const { conditionRoot, branching, climbedThroughLogical } = resolveBranchingContext(valueRoot);
  if (branching || climbedThroughLogical) return true;
  const parent = conditionRoot.parent ?? null;
  if (!parent) return false;
  if (LOGIC_SINK_PARENT_TYPES.has(parent.type)) return true;
  if (isNodeOfType(parent, "CallExpression") && parent.callee !== conditionRoot) {
    return readFeedsLogic(parent as EsTreeNode);
  }
  return false;
};

// An explicit param type that is a TSTypeReference to something OTHER than
// KeyboardEvent (a stored keystroke record, a replay-log entry) says the
// receiver is plain data — the handler-name heuristic must not override it.
const typeReferenceNamesOtherType = (typeAnnotation: EsTreeNode | null | undefined): boolean => {
  if (!typeAnnotation || !isNodeOfType(typeAnnotation, "TSTypeAnnotation")) return false;
  const typeNode = typeAnnotation.typeAnnotation as EsTreeNode;
  if (!isNodeOfType(typeNode, "TSTypeReference")) return false;
  return !typeReferenceIsKeyboardEvent(typeAnnotation);
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

const directLogicControlsFallback = (
  signalNode: EsTreeNode,
  fallbackConditionRoot: EsTreeNode,
): boolean => {
  if (isAstDescendant(signalNode, fallbackConditionRoot)) return true;
  let ancestor = signalNode.parent ?? null;
  while (ancestor && !isFunctionLike(ancestor)) {
    if (
      isNodeOfType(ancestor, "LogicalExpression") &&
      isAstDescendant(fallbackConditionRoot, ancestor)
    ) {
      return true;
    }
    if (
      isNodeOfType(ancestor, "ConditionalExpression") &&
      isAstDescendant(fallbackConditionRoot, ancestor) &&
      (isAstDescendant(signalNode, ancestor.test) ||
        isAstDescendant(signalNode, ancestor.consequent))
    ) {
      return true;
    }
    if (isNodeOfType(ancestor, "IfStatement") && isAstDescendant(signalNode, ancestor.test)) {
      if (ancestor.alternate && isAstDescendant(fallbackConditionRoot, ancestor.alternate)) {
        return true;
      }
      const block = ancestor.parent;
      if (
        block &&
        isNodeOfType(block, "BlockStatement") &&
        statementAlwaysExits(ancestor.consequent)
      ) {
        let fallbackStatement: EsTreeNode = fallbackConditionRoot;
        while (fallbackStatement.parent && fallbackStatement.parent !== block) {
          fallbackStatement = fallbackStatement.parent;
        }
        const signalIndex = block.body.findIndex((statement) => statement === ancestor);
        const fallbackIndex = block.body.findIndex((statement) => statement === fallbackStatement);
        if (signalIndex >= 0 && fallbackIndex > signalIndex) return true;
      }
    }
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

const standardReadControlsFallback = (
  readNode: EsTreeNode,
  fallbackConditionRoot: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (directLogicControlsFallback(readNode, fallbackConditionRoot)) return true;
  const valueRoot = readValueRoot(readNode);
  const parent = valueRoot.parent ?? null;
  if (
    parent &&
    isNodeOfType(parent, "VariableDeclarator") &&
    parent.init === valueRoot &&
    isNodeOfType(parent.id, "Identifier")
  ) {
    const aliasSymbol = context.scopes.symbolFor(parent.id);
    return Boolean(
      aliasSymbol?.references.some((reference) =>
        directLogicControlsFallback(reference.identifier, fallbackConditionRoot),
      ),
    );
  }
  return false;
};

const receiverReadsAnyProperty = (
  scopeNode: EsTreeNode,
  receiverParameter: EsTreeNodeOfType<"Identifier">,
  propertyNames: Set<string>,
  context: RuleContext,
  fallbackConditionRoot?: EsTreeNode,
  readQualifies?: (readNode: EsTreeNode) => boolean,
): boolean => {
  const receiverSymbol = context.scopes.symbolFor(receiverParameter);
  let found = false;
  walkAst(scopeNode, (child) => {
    if (found) return false;
    if (child !== scopeNode && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "MemberExpression") &&
      !child.computed &&
      isNodeOfType(child.object, "Identifier") &&
      context.scopes.symbolFor(child.object)?.id === receiverSymbol?.id &&
      isNodeOfType(child.property, "Identifier") &&
      propertyNames.has(child.property.name) &&
      (!readQualifies || readQualifies(child)) &&
      (!fallbackConditionRoot ||
        standardReadControlsFallback(child, fallbackConditionRoot, context))
    ) {
      found = true;
      return false;
    }
  });
  return found;
};

// `const { key } = event` reads the standard member through destructuring —
// the same progressive-enhancement signal receiverReadsAnyProperty sees for
// `event.key`, one syntax over.
const receiverDestructuresAnyProperty = (
  scopeNode: EsTreeNode,
  receiverParameter: EsTreeNodeOfType<"Identifier">,
  propertyNames: Set<string>,
  context: RuleContext,
  fallbackConditionRoot: EsTreeNode,
): boolean => {
  const receiverSymbol = context.scopes.symbolFor(receiverParameter);
  let found = false;
  walkAst(scopeNode, (child) => {
    if (found) return false;
    if (child !== scopeNode && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "VariableDeclarator") &&
      child.init &&
      isNodeOfType(stripGroupingParens(child.init as EsTreeNode), "Identifier") &&
      context.scopes.symbolFor(stripGroupingParens(child.init as EsTreeNode))?.id ===
        receiverSymbol?.id &&
      isNodeOfType(child.id, "ObjectPattern")
    ) {
      for (const property of child.id.properties) {
        if (
          isNodeOfType(property, "Property") &&
          !property.computed &&
          ((isNodeOfType(property.key, "Identifier") && propertyNames.has(property.key.name)) ||
            (isNodeOfType(property.key, "Literal") &&
              typeof property.key.value === "string" &&
              propertyNames.has(property.key.value)))
        ) {
          const bindingNode = isNodeOfType(property.value, "AssignmentPattern")
            ? property.value.left
            : property.value;
          if (isNodeOfType(bindingNode, "Identifier")) {
            const bindingSymbol = context.scopes.symbolFor(bindingNode);
            if (
              bindingSymbol?.references.some(
                (reference) =>
                  readFeedsLogic(reference.identifier) &&
                  directLogicControlsFallback(reference.identifier, fallbackConditionRoot),
              )
            ) {
              found = true;
              return false;
            }
          }
        }
      }
    }
  });
  return found;
};

// `'key' in event` is explicit feature detection — the most direct spelling
// of the guard the rule already exempts as `event.key !== undefined`.
const receiverFeatureDetectedWithIn = (
  scopeNode: EsTreeNode,
  receiverParameter: EsTreeNodeOfType<"Identifier">,
  propertyNames: Set<string>,
  context: RuleContext,
  fallbackConditionRoot: EsTreeNode,
): boolean => {
  const receiverSymbol = context.scopes.symbolFor(receiverParameter);
  let found = false;
  walkAst(scopeNode, (child) => {
    if (found) return false;
    if (child !== scopeNode && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "BinaryExpression") &&
      child.operator === "in" &&
      isNodeOfType(child.left, "Literal") &&
      typeof child.left.value === "string" &&
      propertyNames.has(child.left.value) &&
      isNodeOfType(child.right, "Identifier") &&
      context.scopes.symbolFor(child.right)?.id === receiverSymbol?.id &&
      readFeedsLogic(child) &&
      directLogicControlsFallback(child, fallbackConditionRoot)
    ) {
      found = true;
      return false;
    }
  });
  return found;
};

const MAX_RELATIONAL_RANGE_SPAN = 100;

// `e.keyCode >= 37 && e.keyCode <= 40` — when BOTH endpoints of the range
// resolve and every code inside is layout-invariant (arrows, modifiers,
// space..arrows navigation block), the range is exactly as layout-safe as
// the equality comparisons the rule already exempts.
const relationalRangeIsLayoutInvariant = (
  memberNode: EsTreeNode,
  receiverParameter: EsTreeNodeOfType<"Identifier">,
  propertyName: string,
  context: RuleContext,
): boolean => {
  const receiverSymbol = context.scopes.symbolFor(receiverParameter);
  const comparisonNode = findTransparentExpressionRoot(memberNode).parent;
  if (!comparisonNode || !isNodeOfType(comparisonNode, "BinaryExpression")) return false;
  let logicalRoot: EsTreeNode = comparisonNode;
  while (logicalRoot.parent && isNodeOfType(logicalRoot.parent, "LogicalExpression")) {
    if (logicalRoot.parent.operator !== "&&") return false;
    logicalRoot = logicalRoot.parent;
  }
  let lowerBound: number | null = null;
  let upperBound: number | null = null;
  walkAst(logicalRoot, (child) => {
    if (!isNodeOfType(child, "BinaryExpression") || !RELATIONAL_OPERATORS.has(child.operator)) {
      return;
    }
    const matchesRead = (side: EsTreeNode): boolean => {
      const stripped = stripGroupingParens(side);
      return (
        isNodeOfType(stripped, "MemberExpression") &&
        !stripped.computed &&
        isNodeOfType(stripped.object, "Identifier") &&
        context.scopes.symbolFor(stripped.object)?.id === receiverSymbol?.id &&
        isNodeOfType(stripped.property, "Identifier") &&
        stripped.property.name === propertyName
      );
    };
    const left = child.left as EsTreeNode;
    const right = child.right as EsTreeNode;
    let operator = child.operator;
    let valueSide: EsTreeNode | null = null;
    if (matchesRead(left)) {
      valueSide = right;
    } else if (matchesRead(right)) {
      valueSide = left;
      operator = operator === "<" ? ">" : operator === ">" ? "<" : operator === "<=" ? ">=" : "<=";
    }
    if (!valueSide) return;
    const value = resolveNumericValue(stripGroupingParens(valueSide), context);
    if (value === null) return;
    if (operator === ">=") lowerBound = lowerBound === null ? value : Math.max(lowerBound, value);
    if (operator === ">") {
      lowerBound = lowerBound === null ? value + 1 : Math.max(lowerBound, value + 1);
    }
    if (operator === "<=") upperBound = upperBound === null ? value : Math.min(upperBound, value);
    if (operator === "<") {
      upperBound = upperBound === null ? value - 1 : Math.min(upperBound, value - 1);
    }
  });
  if (lowerBound === null || upperBound === null) return false;
  if (upperBound < lowerBound || upperBound - lowerBound > MAX_RELATIONAL_RANGE_SPAN) return false;
  for (let code = lowerBound; code <= upperBound; code++) {
    if (isLayoutSensitiveCode(code)) return false;
  }
  return true;
};

// Flags branching on a KeyboardEvent's deprecated numeric `keyCode` /
// `which` / `charCode` where the targeted code is genuinely layout- or
// IME-sensitive: any `charCode` read, relational character-range checks,
// and comparisons against resolvable numeric codes for letters, digits,
// or punctuation (which drift across keyboard layouts). Stays quiet on
// layout-invariant control keys (Enter, Escape, Space, Tab, arrows, …),
// unresolvable named key constants (`KeyCode.ENTER`), mouse-button
// `which`, the IME `keyCode === 229` idiom, handlers whose `key`/`code`
// reads feed logic (comparisons, branch tests, fallback chains, aliases)
// as a progressive-enhancement fallback — a read that is only a bare call
// argument like `console.log(event.key)` does not suppress — and
// object-literal event-synthesis keys.
export const noDeprecatedKeyboardEventKeycodeWhich = defineRule({
  id: "no-deprecated-keyboard-event-keycode-which",
  title: "Deprecated KeyboardEvent keyCode or which",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "`KeyboardEvent.keyCode`/`which`/`charCode` are deprecated and layout/engine dependent for character keys. Branch on `event.key` (logical key like `'/'`) or `event.code` (physical position) so the handler works across keyboard layouts and browsers.",
  create: (context: RuleContext) => ({
    MemberExpression(node: EsTreeNodeOfType<"MemberExpression">) {
      if (isNonSourceFilename(context.filename)) return;
      if (node.computed) return;
      if (!isNodeOfType(node.property, "Identifier")) return;
      const propertyName = node.property.name;
      if (!DEPRECATED_NUMERIC_MEMBERS.has(propertyName)) return;
      const receiver = node.object;
      if (!isNodeOfType(receiver, "Identifier")) return;
      const receiverName = receiver.name;

      const { conditionRoot, branching } = resolveBranchingContext(node as EsTreeNode);
      if (!branching) return;

      const enclosingFunction = findEnclosingFunction(node as EsTreeNode);
      if (!enclosingFunction || !isFunctionLike(enclosingFunction)) return;
      const firstParam = enclosingFunction.params?.[0];
      if (!firstParam || !isNodeOfType(firstParam as EsTreeNode, "Identifier")) return;
      const firstParamIdentifier = firstParam as EsTreeNodeOfType<"Identifier">;
      if (firstParamIdentifier.name !== receiverName) return;

      const signalTypedKeyboardEvent = typeReferenceIsKeyboardEvent(
        (firstParamIdentifier.typeAnnotation as EsTreeNode) ?? null,
      );
      if (
        !signalTypedKeyboardEvent &&
        typeReferenceNamesOtherType((firstParamIdentifier.typeAnnotation as EsTreeNode) ?? null)
      ) {
        return;
      }
      const signalHandlerContext = functionIsKeyboardHandler(enclosingFunction);
      if (!signalTypedKeyboardEvent && !signalHandlerContext) return;

      // A same-file binding could shadow an outer param name, but the
      // first-param match above already anchors the receiver to this
      // handler's event parameter. Guard against a stray outer binding
      // that resolves to a non-parameter declaration.
      if (
        context.scopes.symbolFor(receiver)?.id !==
        context.scopes.symbolFor(firstParamIdentifier)?.id
      ) {
        return;
      }

      const comparison = getComparison(node as EsTreeNode, context);
      const comparedValue = comparison ? comparison.comparedValue : null;
      if (comparedValue !== null && LEGACY_IME_KEYCODES.has(comparedValue)) return;
      if (
        propertyName === "which" &&
        comparedValue !== null &&
        MOUSE_BUTTON_LITERALS.has(comparedValue)
      ) {
        return;
      }
      if (
        propertyName === "which" &&
        receiverReadsAnyProperty(
          enclosingFunction,
          firstParamIdentifier,
          MOUSE_BUTTON_MEMBERS,
          context,
          undefined,
        )
      ) {
        return;
      }
      if (
        receiverReadsAnyProperty(
          enclosingFunction,
          firstParamIdentifier,
          STANDARD_KEY_MEMBERS,
          context,
          conditionRoot,
          readFeedsLogic,
        ) ||
        receiverDestructuresAnyProperty(
          enclosingFunction,
          firstParamIdentifier,
          STANDARD_KEY_MEMBERS,
          context,
          conditionRoot,
        ) ||
        receiverFeatureDetectedWithIn(
          enclosingFunction,
          firstParamIdentifier,
          STANDARD_KEY_MEMBERS,
          context,
          conditionRoot,
        )
      ) {
        return;
      }

      if (propertyName !== "charCode") {
        const isRelationalRangeCheck = Boolean(
          comparison &&
          RELATIONAL_OPERATORS.has(comparison.operator) &&
          !relationalRangeIsLayoutInvariant(
            node as EsTreeNode,
            firstParamIdentifier,
            propertyName,
            context,
          ),
        );
        const comparesLayoutSensitiveCode =
          comparedValue !== null && isLayoutSensitiveCode(comparedValue);
        const switchesOnLayoutSensitiveCode = switchTargetsLayoutSensitiveCode(
          conditionRoot,
          context,
        );
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
