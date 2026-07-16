import { defineRule } from "../../utils/define-rule.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import { isSetterCall } from "../../utils/is-setter-call.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { patternBindsName } from "./utils/pattern-binds-name.js";

// Callees that defer execution past the current render — a toggle captured by
// one of these closures can read stale state because the callback runs after
// later renders. A synchronous `onClick={() => setX(!x)}` recreates the arrow
// (and re-reads fresh `x`) every render, so it is not a stale-read hazard.
// Effect hooks (useEffect/useLayoutEffect/useInsertionEffect) are deliberately
// NOT deferred: React runs the effect closure from the committing render, so a
// direct effect-body toggle always reads the latest committed value; only
// truly deferred calls nested inside an effect (setTimeout/subscribe/...)
// carry the hazard, and those entries already cover them.
const DEFERRED_EXECUTION_CALLEE_NAMES: ReadonlySet<string> = new Set([
  "setTimeout",
  "setInterval",
  "setImmediate",
  "queueMicrotask",
  "requestAnimationFrame",
  "requestIdleCallback",
  "then",
  "catch",
  "finally",
  "subscribe",
  "addEventListener",
  "addListener",
  "on",
  "once",
]);

const isInsideDeferredCallback = (node: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = node;
  while (current) {
    const parent: EsTreeNode | null | undefined = current.parent;
    if (!parent) return false;
    if (isFunctionLike(current) && isNodeOfType(parent, "CallExpression")) {
      const callee = parent.callee;
      let calleeName: string | null = null;
      if (isNodeOfType(callee, "Identifier")) {
        calleeName = callee.name;
      } else if (
        isNodeOfType(callee, "MemberExpression") &&
        isNodeOfType(callee.property, "Identifier")
      ) {
        calleeName = callee.property.name;
      }
      if (calleeName && DEFERRED_EXECUTION_CALLEE_NAMES.has(calleeName)) return true;
    }
    current = parent;
  }
  return false;
};

const isUseStateDeclarator = (declarator: EsTreeNode): boolean =>
  isNodeOfType(declarator, "VariableDeclarator") &&
  isNodeOfType(declarator.init, "CallExpression") &&
  isHookCall(declarator.init, "useState");

// Locates the `const [state, setX] = useState(...)` declarator that binds
// `setterName` at index 1 and returns the paired state name from index 0 —
// so `const [isOpen, setOpen]` pairs `setOpen` with `isOpen` instead of a
// naming-convention guess.
const findUseStatePairedStateName = (node: EsTreeNode, setterName: string): string | null => {
  let cursor: EsTreeNode | null | undefined = node;
  while (cursor) {
    if (isNodeOfType(cursor, "BlockStatement") || isNodeOfType(cursor, "Program")) {
      for (const statement of cursor.body ?? []) {
        if (!isNodeOfType(statement, "VariableDeclaration")) continue;
        for (const declarator of statement.declarations ?? []) {
          if (!isUseStateDeclarator(declarator)) continue;
          if (!isNodeOfType(declarator.id, "ArrayPattern")) continue;
          const elements = declarator.id.elements ?? [];
          const setterElement = elements.length > 1 ? elements[1] : null;
          if (!isNodeOfType(setterElement, "Identifier") || setterElement.name !== setterName) {
            continue;
          }
          const stateElement = elements[0];
          return isNodeOfType(stateElement, "Identifier") ? stateElement.name : null;
        }
      }
    }
    cursor = cursor.parent;
  }
  return null;
};

// True when a binding between the setter call and the useState declaration
// shadows the state name — a callback parameter or local const carrying the
// FRESH value (`(checked) => setChecked(!checked)`) is not a stale state read.
const isStateNameShadowedAtCall = (node: EsTreeNode, stateName: string): boolean => {
  let cursor: EsTreeNode | null | undefined = node;
  while (cursor) {
    if (isFunctionLike(cursor)) {
      for (const param of cursor.params ?? []) {
        if (patternBindsName(param, stateName)) return true;
      }
    }
    if (isNodeOfType(cursor, "BlockStatement") || isNodeOfType(cursor, "Program")) {
      for (const statement of cursor.body ?? []) {
        if (!isNodeOfType(statement, "VariableDeclaration")) continue;
        for (const declarator of statement.declarations ?? []) {
          if (!patternBindsName(declarator.id, stateName)) continue;
          if (isUseStateDeclarator(declarator)) return false;
          return true;
        }
      }
    }
    cursor = cursor.parent;
  }
  return false;
};

const EFFECT_HOOK_NAMES = new Set(["useEffect", "useLayoutEffect", "useInsertionEffect"]);

// A deferred closure created inside a useEffect that LISTS the state in its
// deps and returns a cleanup is torn down and re-created on every committed
// state change — the captured value is always the latest committed one, so
// `set(!state)` cannot read stale state.
const deferredClosureIsResubscribedOnState = (node: EsTreeNode, stateName: string): boolean => {
  let cursor: EsTreeNode | null | undefined = node;
  while (cursor) {
    if (
      isNodeOfType(cursor, "CallExpression") &&
      isNodeOfType(cursor.callee, "Identifier") &&
      EFFECT_HOOK_NAMES.has(cursor.callee.name)
    ) {
      const dependencyArray = cursor.arguments?.[1];
      if (!dependencyArray || !isNodeOfType(dependencyArray, "ArrayExpression")) return false;
      const listsState = (dependencyArray.elements ?? []).some(
        (element) => isNodeOfType(element, "Identifier") && element.name === stateName,
      );
      if (!listsState) return false;
      const effectCallback = cursor.arguments?.[0]
        ? stripParenExpression(cursor.arguments[0] as EsTreeNode)
        : null;
      if (
        !effectCallback ||
        (!isNodeOfType(effectCallback, "ArrowFunctionExpression") &&
          !isNodeOfType(effectCallback, "FunctionExpression"))
      ) {
        return false;
      }
      const effectBody = effectCallback.body as EsTreeNode;
      let hasCleanup = false;
      walkAst(effectBody, (child: EsTreeNode) => {
        if (hasCleanup) return false;
        if (child !== effectBody && isFunctionLike(child)) return false;
        if (isNodeOfType(child, "ReturnStatement") && child.argument) {
          hasCleanup = true;
          return false;
        }
      });
      return hasCleanup;
    }
    cursor = cursor.parent;
  }
  return false;
};

// `player.setMuted(!muted).then(() => setMuted(!muted))` — the state write
// mirrors an absolute external command built from the SAME `!state`
// expression; a functional updater here would desync the mirror from the
// command actually sent.
const thenChainRootReceivesSameToggle = (node: EsTreeNode, stateName: string): boolean => {
  let cursor: EsTreeNode | null | undefined = node;
  while (cursor) {
    const parent: EsTreeNode | null | undefined = cursor.parent;
    if (!parent) return false;
    if (isFunctionLike(cursor) && isNodeOfType(parent, "CallExpression")) {
      const callee = parent.callee;
      if (
        isNodeOfType(callee, "MemberExpression") &&
        !callee.computed &&
        isNodeOfType(callee.property, "Identifier") &&
        callee.property.name === "then"
      ) {
        const chainRoot = stripParenExpression(callee.object as EsTreeNode);
        if (isNodeOfType(chainRoot, "CallExpression")) {
          return (chainRoot.arguments ?? []).some((argument) => {
            const inner = stripParenExpression(argument as EsTreeNode);
            return (
              isNodeOfType(inner, "UnaryExpression") &&
              inner.operator === "!" &&
              isNodeOfType(stripParenExpression(inner.argument), "Identifier") &&
              (stripParenExpression(inner.argument) as EsTreeNodeOfType<"Identifier">).name ===
                stateName
            );
          });
        }
      }
    }
    cursor = parent;
  }
  return false;
};

// `if (openRef.current === open) setOpen(!open)` — a latest-ref equality
// guard proving the captured value is still current before toggling.
const dominatedByLatestRefEqualityGuard = (node: EsTreeNode, stateName: string): boolean => {
  let cursor: EsTreeNode | null | undefined = node;
  let child: EsTreeNode | null = null;
  while (cursor) {
    if (isNodeOfType(cursor, "IfStatement") && child === cursor.consequent) {
      const test = stripParenExpression(cursor.test as EsTreeNode);
      if (
        isNodeOfType(test, "BinaryExpression") &&
        (test.operator === "===" || test.operator === "==")
      ) {
        const sides = [test.left, test.right].map((side) =>
          stripParenExpression(side as EsTreeNode),
        );
        const readsCurrent = sides.some(
          (side) =>
            isNodeOfType(side, "MemberExpression") &&
            !side.computed &&
            isNodeOfType(side.property, "Identifier") &&
            side.property.name === "current",
        );
        const readsState = sides.some(
          (side) => isNodeOfType(side, "Identifier") && side.name === stateName,
        );
        if (readsCurrent && readsState) return true;
      }
    }
    child = cursor;
    cursor = cursor.parent;
  }
  return false;
};

export const noBooleanToggleWithoutFunctionalUpdate = defineRule({
  id: "no-boolean-toggle-without-functional-update",
  title: "Boolean toggle reads a stale value",
  severity: "warn",
  category: "Bugs",
  tags: ["test-noise"],
  recommendation:
    "Toggle boolean state with the functional updater `setX(prev => !prev)` so a deferred double-toggle always reads the latest committed value.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isSetterCall(node)) return;
      if (!node.arguments?.length) return;
      if (!isNodeOfType(node.callee, "Identifier")) return;

      const argument = node.arguments[0];
      if (!isNodeOfType(argument, "UnaryExpression") || argument.operator !== "!") return;

      // A bare Identifier only — `!field.value` / `!this.flag` (MemberExpression)
      // and `!isValid()` (CallExpression) are out of scope.
      const operand = stripParenExpression(argument.argument);
      if (!isNodeOfType(operand, "Identifier")) return;

      const pairedStateName = findUseStatePairedStateName(node, node.callee.name);
      if (!pairedStateName || operand.name !== pairedStateName) return;
      if (isStateNameShadowedAtCall(node, pairedStateName)) return;

      if (!isInsideDeferredCallback(node)) return;
      if (deferredClosureIsResubscribedOnState(node, pairedStateName)) return;
      if (thenChainRootReceivesSameToggle(node, pairedStateName)) return;
      if (dominatedByLatestRefEqualityGuard(node, pairedStateName)) return;

      context.report({
        node,
        message: `You can lose this update because ${node.callee.name}(!${operand.name}) reads a stale value; use ${node.callee.name}(prev => !prev).`,
      });
    },
  }),
});
