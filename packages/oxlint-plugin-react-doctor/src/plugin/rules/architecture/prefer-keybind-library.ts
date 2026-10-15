import {
  KEY_IDENTITY_EVENT_PROPERTIES,
  KEYBOARD_EVENT_LISTENER_NAMES,
} from "../../constants/dom.js";
import {
  DEFAULT_KEYBIND_LIBRARY,
  KEYBIND_LIBRARY_BY_IMPORT_SOURCE,
} from "../../constants/library.js";
import { defineRule } from "../../utils/define-rule.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

// HACK: a `keydown`/`keyup`/`keypress` listener whose handler COMPARES a
// KeyboardEvent key-identity property (`event.key === "k"`,
// `switch (event.code)`, …) is hand-rolling a keyboard shortcut: parsing
// the combination, wiring the add/remove lifecycle, and (almost always)
// forgetting scoping, key sequences, input-field exclusion, and platform
// `meta` vs `ctrl` normalization. A dedicated library (react-hotkeys-hook
// and friends) owns all of that.
//
// Two real-world look-alikes are deliberately NOT shortcuts and stay
// quiet:
//   1. Input-modality detection (focus-visible polyfills) reads only
//      modifier flags (`event.metaKey || event.altKey`) and never a
//      key-identity property — so there's no key comparison to flag.
//   2. Focus trapping cycles focus on Tab. Its only key comparison is
//      against Tab (`event.key === "Tab"`, `=== KEYS.TAB`, `keyCode ===
//      9`), which is an accessibility concern a keybind library does not
//      replace. A handler whose key comparisons are ALL Tab is exempt.

const EQUALITY_OPERATORS = new Set(["===", "!==", "==", "!="]);
// Method calls that test a key-identity property without a comparison
// operand we can inspect (`SHORTCUTS.includes(event.key)`,
// `event.key.startsWith("Arrow")`). Their presence proves a key check;
// we just can't extract a literal to run the Tab-exemption against.
const KEY_TEST_METHOD_NAMES = new Set([
  "includes",
  "has",
  "startsWith",
  "endsWith",
  "match",
  "test",
]);
const TAB_KEY_NAME_PATTERN = /^tab$/i;
const TAB_KEY_CODE = 9;

type FunctionLikeNode =
  | EsTreeNodeOfType<"ArrowFunctionExpression">
  | EsTreeNodeOfType<"FunctionExpression">
  | EsTreeNodeOfType<"FunctionDeclaration">;

const resolveListenerHandler = (
  handlerArgument: EsTreeNode,
  contextNode: EsTreeNode,
): FunctionLikeNode | null => {
  const handler = stripParenExpression(handlerArgument);
  if (isFunctionLike(handler)) return handler;
  // `addEventListener("keydown", handleKey)` — follow one binding hop to
  // the locally-declared function. Imported / unresolved handlers stay
  // unknown and are left alone.
  if (isNodeOfType(handler, "Identifier")) {
    const binding = findVariableInitializer(contextNode, handler.name);
    if (binding?.initializer && isFunctionLike(binding.initializer)) {
      return binding.initializer;
    }
  }
  return null;
};

const collectKeyIdentityLocalNames = (handler: FunctionLikeNode): Set<string> => {
  const localNames = new Set<string>();
  const eventParam = handler.params?.[0];

  const addFromObjectPattern = (pattern: EsTreeNode): void => {
    if (!isNodeOfType(pattern, "ObjectPattern")) return;
    for (const property of pattern.properties ?? []) {
      if (!isNodeOfType(property, "Property") || property.computed) continue;
      const key = property.key;
      if (!isNodeOfType(key, "Identifier") || !KEY_IDENTITY_EVENT_PROPERTIES.has(key.name))
        continue;
      const local = property.value;
      if (isNodeOfType(local, "Identifier")) localNames.add(local.name);
    }
  };

  // `({ key, code }) => …` — destructured right at the parameter.
  if (eventParam) addFromObjectPattern(eventParam);

  // `(event) => { const { key } = event; … }` — destructured in the body.
  const eventParamName = isNodeOfType(eventParam, "Identifier") ? eventParam.name : null;
  if (eventParamName) {
    walkAst(handler.body, (child: EsTreeNode) => {
      if (child !== handler.body && isFunctionLike(child)) return false;
      if (
        isNodeOfType(child, "VariableDeclarator") &&
        isNodeOfType(child.init, "Identifier") &&
        child.init.name === eventParamName
      ) {
        addFromObjectPattern(child.id);
      }
    });
  }
  return localNames;
};

const isTabLikeOperand = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return false;
  if (isNodeOfType(node, "Literal")) {
    if (typeof node.value === "string") return TAB_KEY_NAME_PATTERN.test(node.value);
    if (typeof node.value === "number") return node.value === TAB_KEY_CODE;
    return false;
  }
  // `KEYS.TAB`, `Key.Tab` — match the terminal property name.
  if (isNodeOfType(node, "MemberExpression") && isNodeOfType(node.property, "Identifier")) {
    return TAB_KEY_NAME_PATTERN.test(node.property.name);
  }
  if (isNodeOfType(node, "Identifier")) return TAB_KEY_NAME_PATTERN.test(node.name);
  return false;
};

interface KeyComparisonAnalysis {
  hasKeyComparison: boolean;
  comparedOperands: EsTreeNode[];
}

const analyzeKeyComparisons = (
  handler: FunctionLikeNode,
  keyIdentityLocalNames: ReadonlySet<string>,
): KeyComparisonAnalysis => {
  const eventParam = handler.params?.[0];
  const eventParamName = isNodeOfType(eventParam, "Identifier") ? eventParam.name : null;

  const isKeyIdentityExpression = (node: EsTreeNode | null | undefined): boolean => {
    if (!node) return false;
    if (
      eventParamName &&
      isNodeOfType(node, "MemberExpression") &&
      !node.computed &&
      isNodeOfType(node.object, "Identifier") &&
      node.object.name === eventParamName &&
      isNodeOfType(node.property, "Identifier") &&
      KEY_IDENTITY_EVENT_PROPERTIES.has(node.property.name)
    ) {
      return true;
    }
    return isNodeOfType(node, "Identifier") && keyIdentityLocalNames.has(node.name);
  };

  let hasKeyComparison = false;
  const comparedOperands: EsTreeNode[] = [];

  walkAst(handler.body, (child: EsTreeNode) => {
    if (child !== handler.body && isFunctionLike(child)) return false;

    if (isNodeOfType(child, "BinaryExpression") && EQUALITY_OPERATORS.has(child.operator ?? "")) {
      if (isKeyIdentityExpression(child.left)) {
        hasKeyComparison = true;
        comparedOperands.push(child.right);
      } else if (isKeyIdentityExpression(child.right)) {
        hasKeyComparison = true;
        comparedOperands.push(child.left);
      }
      return;
    }

    if (isNodeOfType(child, "SwitchStatement") && isKeyIdentityExpression(child.discriminant)) {
      hasKeyComparison = true;
      for (const switchCase of child.cases ?? []) {
        if (switchCase.test) comparedOperands.push(switchCase.test);
      }
      return;
    }

    // `SHORTCUTS.includes(event.key)` / `event.code.startsWith("Arrow")`.
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "MemberExpression") &&
      isNodeOfType(child.callee.property, "Identifier") &&
      KEY_TEST_METHOD_NAMES.has(child.callee.property.name)
    ) {
      if (
        isKeyIdentityExpression(child.callee.object) ||
        (child.arguments ?? []).some((argument: EsTreeNode) => isKeyIdentityExpression(argument))
      ) {
        hasKeyComparison = true;
      }
    }
  });

  return { hasKeyComparison, comparedOperands };
};

const handlerImplementsKeyboardShortcut = (handler: FunctionLikeNode): boolean => {
  if (!handler.params?.[0]) return false;
  const keyIdentityLocalNames = collectKeyIdentityLocalNames(handler);
  const { hasKeyComparison, comparedOperands } = analyzeKeyComparisons(
    handler,
    keyIdentityLocalNames,
  );
  if (!hasKeyComparison) return false;
  // Focus trapping: every key the handler compares against is Tab.
  if (comparedOperands.length > 0 && comparedOperands.every(isTabLikeOperand)) return false;
  return true;
};

export const preferKeybindLibrary = defineRule<Rule>({
  id: "prefer-keybind-library",
  title: "Hand-rolled keyboard shortcut",
  tags: ["test-noise"],
  severity: "warn",
  // Draft / opt-in: a maintainability preference, not a correctness or
  // accessibility bug. Teams enable it once they've adopted a keybind
  // library. Opt in via `severityControls.rules`.
  defaultEnabled: false,
  recommendation:
    "Use a keyboard-shortcut library like react-hotkeys-hook instead of a manual addEventListener('keydown') handler. The library normalizes meta vs ctrl across platforms, scopes shortcuts, supports key sequences, skips text inputs, and cleans up the listener for you.",
  create: (context: RuleContext) => {
    let suggestedLibrary = DEFAULT_KEYBIND_LIBRARY;

    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        for (const statement of node.body ?? []) {
          if (!isNodeOfType(statement, "ImportDeclaration")) continue;
          const source = statement.source?.value;
          if (typeof source !== "string") continue;
          const known = KEYBIND_LIBRARY_BY_IMPORT_SOURCE.get(source);
          if (known) {
            suggestedLibrary = known;
            break;
          }
        }
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isMemberProperty(node.callee, "addEventListener")) return;
        const callArguments = node.arguments ?? [];
        if (callArguments.length < 2) return;

        const eventNameNode = callArguments[0];
        if (
          !isNodeOfType(eventNameNode, "Literal") ||
          typeof eventNameNode.value !== "string" ||
          !KEYBOARD_EVENT_LISTENER_NAMES.has(eventNameNode.value)
        )
          return;

        const handler = resolveListenerHandler(callArguments[1], node);
        if (!handler) return;
        if (!handlerImplementsKeyboardShortcut(handler)) return;

        context.report({
          node,
          message: `This addEventListener("${eventNameNode.value}") hand-rolls a keyboard shortcut. Use ${suggestedLibrary} so meta/ctrl, scoping, and listener cleanup are handled for you.`,
        });
      },
    };
  },
});
