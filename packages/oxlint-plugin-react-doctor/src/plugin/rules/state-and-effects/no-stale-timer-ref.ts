import {
  TIMER_CALLEE_NAMES_REQUIRING_CLEANUP,
  TIMER_CLEANUP_CALLEE_NAMES,
} from "../../constants/dom.js";
import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { getFunctionBindingName } from "../../utils/get-function-binding-name.js";
import { getRangeStart } from "../../utils/get-range-start.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isReactHookCall } from "../../utils/is-react-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isNullishExpression } from "../../utils/is-nullish-expression.js";
import {
  stripParenExpression,
  TRANSPARENT_EXPRESSION_WRAPPER_TYPES,
} from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { walkInsideStatementBlocks } from "../../utils/walk-inside-statement-blocks.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const GLOBAL_TIMER_RECEIVER_NAMES = new Set(["window", "globalThis", "self"]);
const NULLISH_COMPARISON_OPERATORS = new Set(["==", "===", "!=", "!=="]);

// `clearTimeout(...)` / `window.setTimeout(...)` — the timer built-in a call
// invokes, or null when the callee is neither a bare global identifier nor a
// member call through a global receiver.
const getGlobalTimerCalleeName = (node: EsTreeNode): string | null => {
  if (!isNodeOfType(node, "CallExpression")) return null;
  const callee = stripParenExpression(node.callee);
  if (isNodeOfType(callee, "Identifier")) return callee.name;
  if (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.property, "Identifier")
  ) {
    const receiver = stripParenExpression(callee.object);
    if (isNodeOfType(receiver, "Identifier") && GLOBAL_TIMER_RECEIVER_NAMES.has(receiver.name)) {
      return callee.property.name;
    }
  }
  return null;
};

// `<name>.current` (non-computed, identifier receiver) — the receiver name,
// or null for any other shape.
const getRefCurrentReceiverName = (node: EsTreeNode): string | null => {
  if (!isNodeOfType(node, "MemberExpression") || node.computed) return null;
  if (!isNodeOfType(node.property, "Identifier") || node.property.name !== "current") return null;
  const receiver = stripParenExpression(node.object);
  return isNodeOfType(receiver, "Identifier") ? receiver.name : null;
};

const isRefCurrentMemberOf = (node: EsTreeNode, refName: string): boolean =>
  getRefCurrentReceiverName(node) === refName;

interface ClearCallOnTimerRef {
  clearCalleeName: string;
  refName: string;
}

// `clearTimeout(ref.current)` / `window.clearInterval(ref.current)` — the
// clear built-in and the ref it clears, or null for any other call shape.
const parseClearCallOnTimerRef = (node: EsTreeNode): ClearCallOnTimerRef | null => {
  const clearCalleeName = getGlobalTimerCalleeName(node);
  if (clearCalleeName === null || !TIMER_CLEANUP_CALLEE_NAMES.has(clearCalleeName)) return null;
  if (!isNodeOfType(node, "CallExpression")) return null;
  const clearedArgument = node.arguments?.[0];
  if (!clearedArgument) return null;
  const refName = getRefCurrentReceiverName(stripParenExpression(clearedArgument));
  return refName === null ? null : { clearCalleeName, refName };
};

const isClearCallOnRef = (node: EsTreeNode, refName: string): boolean =>
  parseClearCallOnTimerRef(node)?.refName === refName;

const isNullishResetExpression = (node: EsTreeNode): boolean =>
  isNullishExpression(stripParenExpression(node));

const isAssignmentToRefCurrent = (
  node: EsTreeNode,
  refName: string,
): node is EsTreeNodeOfType<"AssignmentExpression"> =>
  isNodeOfType(node, "AssignmentExpression") &&
  node.operator === "=" &&
  isRefCurrentMemberOf(node.left, refName);

// `if (ref.current) { clearTimeout(ref.current); ref.current = null; }` —
// the standard clear-guard idiom. Its truthiness read exists only to avoid a
// redundant clear (or to lazily reset), so it does NOT treat the ref as a
// pending flag. Anything else in the consequent (calls, returns, setState,
// re-arming a timer) means the guard gates real behavior on pending-ness.
const isClearGuardIfIdiom = (
  ifStatement: EsTreeNodeOfType<"IfStatement">,
  refName: string,
): boolean => {
  if (ifStatement.alternate) return false;
  const consequent = ifStatement.consequent;
  const statements = isNodeOfType(consequent, "BlockStatement")
    ? (consequent.body ?? [])
    : [consequent];
  return statements.every((statement) => {
    if (!isNodeOfType(statement, "ExpressionStatement")) return false;
    const expression = stripParenExpression(statement.expression);
    if (isClearCallOnRef(expression, refName)) return true;
    return (
      isAssignmentToRefCurrent(expression, refName) && isNullishResetExpression(expression.right)
    );
  });
};

interface RefCurrentConditionClimb {
  conditionRoot: EsTreeNode;
  logicalAncestors: EsTreeNodeOfType<"LogicalExpression">[];
  didPassBooleanProjection: boolean;
}

// Climbs from a `ref.current` read through the expression layers that merely
// project it to a boolean (`!x`, `x !== null`, `a && x`, parens/TS wrappers)
// to the outermost expression whose position decides how the read is used.
const climbBooleanProjection = (refCurrentMember: EsTreeNode): RefCurrentConditionClimb => {
  let cursor: EsTreeNode = refCurrentMember;
  const logicalAncestors: EsTreeNodeOfType<"LogicalExpression">[] = [];
  let didPassBooleanProjection = false;
  while (cursor.parent) {
    const parent = cursor.parent;
    if (TRANSPARENT_EXPRESSION_WRAPPER_TYPES.has(parent.type)) {
      cursor = parent;
      continue;
    }
    if (isNodeOfType(parent, "UnaryExpression") && parent.operator === "!") {
      didPassBooleanProjection = true;
      cursor = parent;
      continue;
    }
    if (
      isNodeOfType(parent, "BinaryExpression") &&
      NULLISH_COMPARISON_OPERATORS.has(parent.operator) &&
      isNullishResetExpression(parent.left === cursor ? parent.right : parent.left)
    ) {
      didPassBooleanProjection = true;
      cursor = parent;
      continue;
    }
    if (isNodeOfType(parent, "LogicalExpression")) {
      logicalAncestors.push(parent);
      cursor = parent;
      continue;
    }
    break;
  }
  return { conditionRoot: cursor, logicalAncestors, didPassBooleanProjection };
};

// `ref.current && clearTimeout(ref.current)` — the guard idiom in expression
// form: the read sits in the left of an `&&` whose right side only clears.
const isLogicalClearGuardIdiom = (
  logicalAncestors: ReadonlyArray<EsTreeNodeOfType<"LogicalExpression">>,
  refName: string,
): boolean =>
  logicalAncestors.some(
    (logical) =>
      logical.operator === "&&" && isClearCallOnRef(stripParenExpression(logical.right), refName),
  );

const isPendingSignalRead = (refCurrentMember: EsTreeNode, refName: string): boolean => {
  const { conditionRoot, logicalAncestors, didPassBooleanProjection } =
    climbBooleanProjection(refCurrentMember);
  const conditionParent = conditionRoot.parent;
  if (isNodeOfType(conditionParent, "IfStatement") && conditionParent.test === conditionRoot) {
    return !isClearGuardIfIdiom(conditionParent, refName);
  }
  if (
    (isNodeOfType(conditionParent, "ConditionalExpression") ||
      isNodeOfType(conditionParent, "WhileStatement") ||
      isNodeOfType(conditionParent, "DoWhileStatement") ||
      isNodeOfType(conditionParent, "ForStatement")) &&
    conditionParent.test === conditionRoot
  ) {
    return true;
  }
  if (logicalAncestors.length > 0) {
    return !isLogicalClearGuardIdiom(logicalAncestors, refName);
  }
  // `const armed = !ref.current` / `return ref.current !== null` — the
  // boolean projection escapes into a value, which is still pending
  // semantics even without an enclosing conditional.
  return didPassBooleanProjection;
};

interface TimerRefUsageFacts {
  holdsScheduledTimerId: boolean;
  hasPendingSignalRead: boolean;
}

const collectTimerRefUsageFacts = (ownerScope: EsTreeNode, refName: string): TimerRefUsageFacts => {
  const facts: TimerRefUsageFacts = {
    holdsScheduledTimerId: false,
    hasPendingSignalRead: false,
  };
  walkAst(ownerScope, (child: EsTreeNode) => {
    if (isAssignmentToRefCurrent(child, refName)) {
      const assignedCalleeName = getGlobalTimerCalleeName(stripParenExpression(child.right));
      if (
        assignedCalleeName !== null &&
        TIMER_CALLEE_NAMES_REQUIRING_CLEANUP.has(assignedCalleeName)
      ) {
        facts.holdsScheduledTimerId = true;
      }
      return;
    }
    if (isRefCurrentMemberOf(child, refName) && isPendingSignalRead(child, refName)) {
      facts.hasPendingSignalRead = true;
    }
  });
  return facts;
};

const isEffectCallbackFunction = (functionNode: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const parent = functionNode.parent;
  if (!parent || !isNodeOfType(parent, "CallExpression")) return false;
  return (
    isReactHookCall(parent, EFFECT_HOOK_NAMES, scopes) && getEffectCallback(parent) === functionNode
  );
};

const doesEffectCallbackReturnName = (effectCallback: EsTreeNode, name: string): boolean => {
  if (!isFunctionLike(effectCallback)) return false;
  let isReturnedByName = false;
  walkInsideStatementBlocks(effectCallback.body, (child: EsTreeNode) => {
    if (isReturnedByName || !isNodeOfType(child, "ReturnStatement") || !child.argument) return;
    const returned = stripParenExpression(child.argument);
    if (isNodeOfType(returned, "Identifier") && returned.name === name) {
      isReturnedByName = true;
    }
  });
  return isReturnedByName;
};

const isFunctionReturnedFromEffectCallback = (
  functionNode: EsTreeNode,
  effectCallback: EsTreeNode,
): boolean => {
  if (!isFunctionLike(effectCallback)) return false;
  if (isNodeOfType(functionNode.parent, "ReturnStatement")) return true;
  if (effectCallback.body === functionNode) return true;
  // `const stop = () => clearTimeout(...); return stop;` — the cleanup bound
  // to a local first. Missing this shape would flag a cleanup clear.
  const cleanupBindingName = getFunctionBindingName(functionNode);
  return (
    cleanupBindingName !== null && doesEffectCallbackReturnName(effectCallback, cleanupBindingName)
  );
};

// `const stop = () => clearTimeout(...);` declared in the component body and
// handed to an effect via `return stop` — the cleanup lives OUTSIDE the
// effect callback, so the nesting walk in `isInsideEffectCleanupReturn`
// cannot link the two; match it by binding name against every effect in the
// component/hook scope instead.
const isReturnedFromAnyEffectInScope = (
  functionNode: EsTreeNode,
  ownerScope: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const cleanupBindingName = getFunctionBindingName(functionNode);
  if (cleanupBindingName === null) return false;
  let isReturnedFromEffect = false;
  walkAst(ownerScope, (child: EsTreeNode) => {
    if (isReturnedFromEffect) return false;
    if (
      !isNodeOfType(child, "CallExpression") ||
      !isReactHookCall(child, EFFECT_HOOK_NAMES, scopes)
    ) {
      return;
    }
    const effectCallback = getEffectCallback(child);
    if (effectCallback && doesEffectCallbackReturnName(effectCallback, cleanupBindingName)) {
      isReturnedFromEffect = true;
    }
  });
  return isReturnedFromEffect;
};

// Clears inside an effect's cleanup return are a v1 non-goal: the stale
// window there is unmount / StrictMode remount, and the re-run path
// immediately re-arms the ref in the effect body, so flagging the ubiquitous
// `return () => clearTimeout(ref.current)` idiom would be mostly noise.
const isInsideEffectCleanupReturn = (
  node: EsTreeNode,
  ownerScope: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  let functionNode = findEnclosingFunction(node);
  while (functionNode) {
    const outerFunction = findEnclosingFunction(functionNode);
    if (
      outerFunction &&
      isEffectCallbackFunction(outerFunction, scopes) &&
      isFunctionReturnedFromEffectCallback(functionNode, outerFunction)
    ) {
      return true;
    }
    if (isReturnedFromAnyEffectInScope(functionNode, ownerScope, scopes)) return true;
    functionNode = outerFunction;
  }
  return false;
};

// Any `ref.current = ...` (null, undefined, or a re-armed timer) lexically
// after the clear in the same function ends the stale window — the debounce
// `clearTimeout(ref.current); ref.current = setTimeout(...)` shape is fine.
const hasRefCurrentReassignmentAfterClear = (clearCall: EsTreeNode, refName: string): boolean => {
  const enclosingFunction = findEnclosingFunction(clearCall);
  if (!isFunctionLike(enclosingFunction)) return false;
  if (!isNodeOfType(enclosingFunction.body, "BlockStatement")) return false;
  const clearStart = getRangeStart(clearCall);
  if (clearStart === null) return false;
  let didFindLaterReassignment = false;
  walkInsideStatementBlocks(enclosingFunction.body, (child: EsTreeNode) => {
    if (didFindLaterReassignment) return;
    if (!isAssignmentToRefCurrent(child, refName)) return;
    const assignmentStart = getRangeStart(child);
    if (assignmentStart !== null && assignmentStart > clearStart) {
      didFindLaterReassignment = true;
    }
  });
  return didFindLaterReassignment;
};

const isShadowedTimerGlobal = (clearCall: EsTreeNodeOfType<"CallExpression">): boolean => {
  const callee = stripParenExpression(clearCall.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  return findVariableInitializer(callee, callee.name) !== null;
};

export const noStaleTimerRef = defineRule({
  id: "no-stale-timer-ref",
  title: "Cleared timer ref keeps the stale id",
  severity: "warn",
  recommendation:
    "Reset the ref right after clearing (`clearTimeout(ref.current); ref.current = null`) so truthiness checks on the ref keep meaning \u201Ctimer still pending\u201D.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const clearCall = parseClearCallOnTimerRef(node);
      if (!clearCall) return;
      if (isShadowedTimerGlobal(node)) return;
      const { clearCalleeName, refName } = clearCall;

      // Closest-scope binding resolution — a shadowing parameter or local
      // re-declaration of the name wins over an outer `useRef` binding.
      const refBinding = findVariableInitializer(node, refName);
      if (
        !refBinding?.initializer ||
        !isReactHookCall(refBinding.initializer, "useRef", context.scopes)
      ) {
        return;
      }

      const usageFacts = collectTimerRefUsageFacts(refBinding.scopeOwner, refName);
      if (!usageFacts.holdsScheduledTimerId || !usageFacts.hasPendingSignalRead) return;

      if (isInsideEffectCleanupReturn(node, refBinding.scopeOwner, context.scopes)) return;
      if (hasRefCurrentReassignmentAfterClear(node, refName)) return;

      context.report({
        node,
        message: `\`${clearCalleeName}(${refName}.current)\` cancels the timer but leaves the old id in \`${refName}.current\`, and this component reads \`${refName}.current\` as a \u201Ctimer pending\u201D signal — assign \`${refName}.current = null\` right after clearing so a cancelled timer does not look pending.`,
      });
    },
  }),
});
