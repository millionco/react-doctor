import {
  KEYBOARD_EVENT_LISTENER_NAMES,
  KEYBOARD_SHORTCUT_EVENT_PROPERTIES,
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

// HACK: a `keydown`/`keyup`/`keypress` listener whose handler reads a
// KeyboardEvent shortcut property (`event.key`, `event.metaKey`, …) is
// hand-rolling a keyboard shortcut: parsing the combination, wiring the
// add/remove lifecycle, and (almost always) forgetting scoping, key
// sequences, input-field exclusion, and platform `meta` vs `ctrl`
// normalization. A dedicated library (react-hotkeys-hook and friends)
// owns all of that. We only fire once we've PROVEN the handler inspects
// a shortcut signal, so plain "any key dismisses" / "is the user typing"
// listeners — which a keybind library wouldn't replace — stay quiet.

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

const objectPatternDestructuresShortcutProperty = (pattern: EsTreeNode): boolean => {
  if (!isNodeOfType(pattern, "ObjectPattern")) return false;
  for (const property of pattern.properties ?? []) {
    if (!isNodeOfType(property, "Property")) continue;
    if (property.computed) continue;
    const key = property.key;
    if (isNodeOfType(key, "Identifier") && KEYBOARD_SHORTCUT_EVENT_PROPERTIES.has(key.name)) {
      return true;
    }
  }
  return false;
};

const isShortcutMemberAccessOf = (node: EsTreeNode, eventParamName: string): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  isNodeOfType(node.object, "Identifier") &&
  node.object.name === eventParamName &&
  isNodeOfType(node.property, "Identifier") &&
  KEYBOARD_SHORTCUT_EVENT_PROPERTIES.has(node.property.name);

const isShortcutDestructureOf = (node: EsTreeNode, eventParamName: string): boolean =>
  isNodeOfType(node, "VariableDeclarator") &&
  isNodeOfType(node.init, "Identifier") &&
  node.init.name === eventParamName &&
  objectPatternDestructuresShortcutProperty(node.id);

const handlerInspectsKeyboardShortcut = (handler: FunctionLikeNode): boolean => {
  const eventParam = handler.params?.[0];
  if (!eventParam) return false;

  // `({ key, metaKey }) => …` — the shortcut signal is destructured right
  // at the parameter, so the event identifier never appears in the body.
  if (objectPatternDestructuresShortcutProperty(eventParam)) return true;

  if (!isNodeOfType(eventParam, "Identifier")) return false;
  const eventParamName = eventParam.name;

  let inspectsShortcut = false;
  walkAst(handler.body, (child: EsTreeNode) => {
    // Don't descend into nested functions: a shadowed `e` (e.g.
    // `items.forEach(e => e.key)`) is a different binding, and a keybind
    // library only replaces shortcut checks made directly in the handler.
    if (child !== handler.body && isFunctionLike(child)) return false;
    if (
      isShortcutMemberAccessOf(child, eventParamName) ||
      isShortcutDestructureOf(child, eventParamName)
    ) {
      inspectsShortcut = true;
      return false;
    }
  });
  return inspectsShortcut;
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
        if (!handlerInspectsKeyboardShortcut(handler)) return;

        context.report({
          node,
          message: `This addEventListener("${eventNameNode.value}") hand-rolls a keyboard shortcut. Use ${suggestedLibrary} so meta/ctrl, scoping, and listener cleanup are handled for you.`,
        });
      },
    };
  },
});
