import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { getCallbackStatements } from "../../utils/get-callback-statements.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { collectUseStateBindings } from "./utils/collect-use-state-bindings.js";

// Every literal builds a value-equal result except a regex literal,
// which evaluates to a fresh `RegExp` object each render and so never
// passes React's `Object.is` bailout — the same as `[]` / `{}` / `new`.
const doesConstructFreshReference = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "ArrayExpression") ||
  isNodeOfType(node, "ObjectExpression") ||
  isNodeOfType(node, "NewExpression") ||
  (isNodeOfType(node, "Literal") && "regex" in node);

// True when `stateName` is read as a VALUE somewhere in the expression. A
// non-computed member property (`other.count`) and a non-computed object
// key (`{ count: 1 }`) are static names, not reads of the `count`
// binding, so they are skipped — walking every Identifier blindly would
// flag `setCount(other.count)` as self-referential.
const expressionReadsStateValue = (node: EsTreeNode, stateName: string): boolean => {
  // A nested closure (`registerCallback(() => count)`) captures the state
  // rather than reading it while computing the setter's argument — the
  // body runs later, or never. Synchronous reads that actually shape the
  // value (e.g. the `items` receiver in `items.filter(...)`) sit outside
  // the closure and are still seen, so stop at function boundaries.
  if (isNodeOfType(node, "ArrowFunctionExpression") || isNodeOfType(node, "FunctionExpression")) {
    return false;
  }
  if (isNodeOfType(node, "Identifier")) return node.name === stateName;
  if (isNodeOfType(node, "MemberExpression")) {
    if (expressionReadsStateValue(node.object, stateName)) return true;
    return node.computed ? expressionReadsStateValue(node.property, stateName) : false;
  }
  if (isNodeOfType(node, "Property")) {
    if (node.computed && expressionReadsStateValue(node.key, stateName)) return true;
    return expressionReadsStateValue(node.value, stateName);
  }
  const nodeRecord = node as unknown as Record<string, unknown>;
  for (const childKey of Object.keys(nodeRecord)) {
    if (childKey === "parent" || childKey === "type") continue;
    const childValue = nodeRecord[childKey];
    if (Array.isArray(childValue)) {
      for (const childArrayItem of childValue) {
        if (isAstNode(childArrayItem) && expressionReadsStateValue(childArrayItem, stateName)) {
          return true;
        }
      }
    } else if (isAstNode(childValue) && expressionReadsStateValue(childValue, stateName)) {
      return true;
    }
  }
  return false;
};

// A self-referential write only loops forever when its new value
// provably keeps changing every run. That holds for three shapes:
//   - a functional updater `(prev) => …` (React re-runs the effect, the
//     updater re-derives from the latest value),
//   - a freshly-constructed reference (`setItems([])`, `setUser({})`,
//     `new Map()`) that never passes React's `Object.is` bailout, and
//   - a value computed from the same state (`setCount(count + 1)`).
// Plausibly-stable scalar writes (`setOpen(true)`, `setTab(props.tab)`,
// `setX(other)`) settle after at most one extra render, and `setX(x)`
// is a no-op — none are render loops, so the detector stays quiet to
// avoid overclaiming.
const isNonSettlingSetterArgument = (
  setterCall: EsTreeNodeOfType<"CallExpression">,
  stateName: string,
): boolean => {
  const firstArgument = setterCall.arguments?.[0];
  // A bare `setX()` writes `undefined`; if the state already holds
  // `undefined` it settles, so it is not provably a loop.
  if (!firstArgument) return false;
  const argument = stripParenExpression(firstArgument);
  // `setX(x)` writes the current value straight back — an immediate
  // `Object.is` bailout, not a loop.
  if (isNodeOfType(argument, "Identifier") && argument.name === stateName) return false;
  if (
    isNodeOfType(argument, "ArrowFunctionExpression") ||
    isNodeOfType(argument, "FunctionExpression")
  ) {
    return true;
  }
  if (doesConstructFreshReference(argument)) return true;
  return expressionReadsStateValue(argument, stateName);
};

const getUnconditionalSetterCall = (
  statement: EsTreeNode,
  setterNames: ReadonlySet<string>,
): EsTreeNodeOfType<"CallExpression"> | null => {
  // `getCallbackStatements` hands back the bare expression for a concise
  // arrow body (`() => setCount(...)`) and the `ExpressionStatement` for a
  // block body (`() => { setCount(...); }`). Both are unconditional
  // synchronous writes, so unwrap the statement form and treat them alike.
  const expression = stripParenExpression(
    isNodeOfType(statement, "ExpressionStatement") ? statement.expression : statement,
  );
  if (!isNodeOfType(expression, "CallExpression")) return null;
  if (!isNodeOfType(expression.callee, "Identifier")) return null;
  if (!setterNames.has(expression.callee.name)) return null;
  return expression;
};

const collectDependencyStateNames = (depsNode: EsTreeNode): ReadonlySet<string> => {
  const dependencyNames = new Set<string>();
  if (!isNodeOfType(depsNode, "ArrayExpression")) return dependencyNames;
  for (const element of depsNode.elements ?? []) {
    if (isNodeOfType(element, "Identifier")) dependencyNames.add(element.name);
  }
  return dependencyNames;
};

// `if (<test>) return;` / `if (<test>) { …; return; }` — a consequent that
// unconditionally bails out of the effect.
const isEarlyReturnGuard = (
  statement: EsTreeNode,
): statement is EsTreeNodeOfType<"IfStatement"> => {
  if (!isNodeOfType(statement, "IfStatement")) return false;
  const consequent = statement.consequent;
  if (isNodeOfType(consequent, "ReturnStatement")) return true;
  if (isNodeOfType(consequent, "BlockStatement")) {
    return (consequent.body ?? []).some((inner) => isNodeOfType(inner, "ReturnStatement"));
  }
  return false;
};

// Numeric value of a literal node (handles a negated literal like `-1`), else
// null.
const numericLiteralValue = (node: EsTreeNode): number | null => {
  if (isNodeOfType(node, "Literal") && typeof node.value === "number") return node.value;
  if (
    isNodeOfType(node, "UnaryExpression") &&
    node.operator === "-" &&
    isNodeOfType(node.argument, "Literal") &&
    typeof node.argument.value === "number"
  ) {
    return -node.argument.value;
  }
  return null;
};

// `<reads the written state>.length` — the `.length` of the state itself,
// including the optional-chained form `state?.length` (which the parser wraps
// in a `ChainExpression`).
const isStateLength = (node: EsTreeNode, stateName: string): boolean => {
  const member = isNodeOfType(node, "ChainExpression") ? node.expression : node;
  return (
    isNodeOfType(member, "MemberExpression") &&
    !member.computed &&
    isNodeOfType(member.property, "Identifier") &&
    member.property.name === "length" &&
    expressionReadsStateValue(member.object, stateName)
  );
};

const isNullishLiteral = (node: EsTreeNode): boolean =>
  (isNodeOfType(node, "Literal") && node.value === null) ||
  (isNodeOfType(node, "Identifier") && node.name === "undefined");

const numericComparisonHolds = (operator: string, left: number, right: number): boolean => {
  switch (operator) {
    case "<":
      return left < right;
    case "<=":
      return left <= right;
    case ">":
      return left > right;
    case ">=":
      return left >= right;
    case "===":
    case "==":
      return left === right;
    case "!==":
    case "!=":
      return left !== right;
    default:
      return false;
  }
};

// SOUND convergence test: does the early-return guard `test` evaluate to TRUE
// once the written state is empty (length 0 / nullish)? If so, a write that
// drives the state toward empty trips this guard on the next run and stops —
// the effect converges and is NOT a loop. Only structurally provable shapes
// return true; anything uncertain returns false so the write stays flagged
// (recall-safe — we never silence a write we cannot prove settles).
//
//   `!S.length`, `S.length === 0`, `S.length < n`, `S.length !== 1`  → exits empty
//   `S == null`, `S === undefined`                                   → exits nullish
//   `A || B` → exits-empty if EITHER side does
//   `A && B` → exits-empty only if BOTH sides do
//
// Deliberately NOT matched (stays flagged): `S.length > n` (a length-reducing
// write drives toward the empty fixpoint, AWAY from a high-watermark guard, so
// it loops at empty), and equality/identity guards (`text === cur.text`) whose
// convergence needs value tracking we do not attempt.
const guardExitsWhenStateEmpty = (test: EsTreeNode, stateName: string): boolean => {
  const node = isNodeOfType(test, "ChainExpression") ? test.expression : test;
  if (isNodeOfType(node, "UnaryExpression") && node.operator === "!") {
    // `!S.length` is true at length 0. (`!S` is not — an empty array is truthy.)
    return isStateLength(node.argument, stateName);
  }
  if (isNodeOfType(node, "LogicalExpression")) {
    if (node.operator === "||") {
      return (
        guardExitsWhenStateEmpty(node.left, stateName) ||
        guardExitsWhenStateEmpty(node.right, stateName)
      );
    }
    if (node.operator === "&&") {
      return (
        guardExitsWhenStateEmpty(node.left, stateName) &&
        guardExitsWhenStateEmpty(node.right, stateName)
      );
    }
    return false;
  }
  if (isNodeOfType(node, "BinaryExpression")) {
    const leftIsLength = isStateLength(node.left, stateName);
    const rightIsLength = isStateLength(node.right, stateName);
    if (leftIsLength || rightIsLength) {
      const other = numericLiteralValue(leftIsLength ? node.right : node.left);
      if (other === null) return false;
      return leftIsLength
        ? numericComparisonHolds(node.operator, 0, other)
        : numericComparisonHolds(node.operator, other, 0);
    }
    if (node.operator === "==" || node.operator === "===") {
      if (expressionReadsStateValue(node.left, stateName) && isNullishLiteral(node.right))
        return true;
      if (expressionReadsStateValue(node.right, stateName) && isNullishLiteral(node.left))
        return true;
    }
    return false;
  }
  return false;
};

// The empty fixpoint a write can drive the state toward: `[]`, `{}`, `""`, `0`,
// `false`, `null`, `undefined`.
const isEmptyOrFalsyValue = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "ArrayExpression")) return (node.elements ?? []).length === 0;
  if (isNodeOfType(node, "ObjectExpression")) return (node.properties ?? []).length === 0;
  if (isNodeOfType(node, "Literal")) {
    return node.value === null || node.value === "" || node.value === 0 || node.value === false;
  }
  if (isNodeOfType(node, "Identifier")) return node.name === "undefined";
  return false;
};

const functionReturnExpression = (fn: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(fn, "ArrowFunctionExpression") && !isNodeOfType(fn, "FunctionExpression")) {
    return null;
  }
  if (!isNodeOfType(fn.body, "BlockStatement")) {
    return fn.body ? stripParenExpression(fn.body) : null;
  }
  for (const statement of fn.body.body ?? []) {
    if (isNodeOfType(statement, "ReturnStatement") && statement.argument) {
      return stripParenExpression(statement.argument);
    }
  }
  return null;
};

// `(prev) => prev.slice(<positive int>)` — a strictly length-reducing updater
// whose fixpoint is the empty array. `.filter` can keep every element and loop
// forever, so it is intentionally NOT treated as reducing.
const isLengthReducingUpdater = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "ArrowFunctionExpression") && !isNodeOfType(node, "FunctionExpression")) {
    return false;
  }
  const firstParameter = node.params?.[0];
  if (!firstParameter || !isNodeOfType(firstParameter, "Identifier")) return false;
  const returned = functionReturnExpression(node);
  if (!returned || !isNodeOfType(returned, "CallExpression")) return false;
  const callee = returned.callee;
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return false;
  if (!isNodeOfType(callee.object, "Identifier") || callee.object.name !== firstParameter.name) {
    return false;
  }
  if (!isNodeOfType(callee.property, "Identifier") || callee.property.name !== "slice")
    return false;
  const sliceStart = numericLiteralValue(returned.arguments?.[0]);
  return sliceStart !== null && sliceStart >= 1;
};

// A guarded write is a PROVABLE non-loop only when it drives the state toward
// the empty fixpoint (an empty/falsy reset or a length-reducing updater) AND
// some early-return guard provably bails out once the state is empty. This is
// the early-return form of the inline `if (a !== b) setX(b)` exemption, made
// sound: it never silences a diverging write (`setX(x + 1)`), an appending
// write (`setX(p => [...p, x])`), or a guard that exits on a high length
// (`if (x.length > n) return`) — all of which keep looping.
const writeProvablyConverges = (
  setterArgument: EsTreeNode,
  stateName: string,
  earlyReturnGuardTests: readonly EsTreeNode[],
): boolean => {
  if (!isEmptyOrFalsyValue(setterArgument) && !isLengthReducingUpdater(setterArgument)) {
    return false;
  }
  return earlyReturnGuardTests.some((test) => guardExitsWhenStateEmpty(test, stateName));
};

// ---------------------------------------------------------------------------
// Symbolic guard-establishment convergence.
//
// The general, sound principle behind every convergent self-updating effect:
// if, AFTER the effect runs its own writes once, one of its early-return guards
// would be TRUE, then the next render bails before re-writing — so the effect
// settles and is not a loop. We prove this by symbolically evaluating the guard
// against a state where each written value is substituted in. This subsumes the
// "normalize several states then guard that they are all normalized" idiom
// (e.g. clearing `{ ...prev, a: undefined }` and resetting `[]` under
// `if (!s.a && !s.b && list.length === 0) return`).
//
// SOUND BY CONSTRUCTION: every resolver returns null / false when uncertain, so
// `guardProvenAfterWrites` only returns true on an explicit proof — it never
// silences a write whose settling it cannot establish (recall-safe).
// ---------------------------------------------------------------------------

const SYMBOLIC_DEPTH_LIMIT = 16;

// Strip both parenthesized-expression wrappers (oxlint preserves parens, e.g.
// the body of `() => ({ ... })`) and optional-chaining `ChainExpression`
// wrappers, so the underlying value node is visible.
const unwrapChain = (node: EsTreeNode): EsTreeNode => {
  let current = node;
  for (;;) {
    const withoutParens = stripParenExpression(current);
    if (withoutParens !== current) {
      current = withoutParens;
      continue;
    }
    if (isNodeOfType(current, "ChainExpression")) {
      current = current.expression;
      continue;
    }
    return current;
  }
};

const isUndefinedValue = (node: EsTreeNode): boolean =>
  (isNodeOfType(node, "Identifier") && node.name === "undefined") ||
  (isNodeOfType(node, "Literal") && node.value === null);

const literalsEqual = (a: EsTreeNode, b: EsTreeNode): boolean =>
  isNodeOfType(a, "Literal") && isNodeOfType(b, "Literal") && a.value === b.value;

// Resolve `node` to a concrete value node (Literal / Array / Object / opaque
// Identifier) given the post-write state in `writes`, or null when unknown.
// `seen` breaks self-referential writes (`setX(x)` → x → x → …).
const resolveValueNode = (
  node: EsTreeNode,
  writes: ReadonlyMap<string, EsTreeNode>,
  depth: number,
  seen: ReadonlySet<string>,
): EsTreeNode | null => {
  if (depth > SYMBOLIC_DEPTH_LIMIT) return null;
  const current = unwrapChain(node);
  if (isNodeOfType(current, "Identifier")) {
    if (seen.has(current.name)) return null;
    const written = writes.get(current.name);
    if (written)
      return resolveValueNode(written, writes, depth + 1, new Set(seen).add(current.name));
    return current;
  }
  if (
    isNodeOfType(current, "Literal") ||
    isNodeOfType(current, "ArrayExpression") ||
    isNodeOfType(current, "ObjectExpression")
  ) {
    return current;
  }
  if (
    isNodeOfType(current, "MemberExpression") &&
    !current.computed &&
    isNodeOfType(current.property, "Identifier")
  ) {
    const objectValue = resolveValueNode(current.object, writes, depth + 1, seen);
    if (objectValue && isNodeOfType(objectValue, "ObjectExpression")) {
      const propertyKey = current.property.name;
      const properties = objectValue.properties ?? [];
      for (let index = properties.length - 1; index >= 0; index--) {
        const property = properties[index];
        if (isNodeOfType(property, "SpreadElement")) return null; // key may come from the spread
        if (
          isNodeOfType(property, "Property") &&
          !property.computed &&
          ((isNodeOfType(property.key, "Identifier") && property.key.name === propertyKey) ||
            (isNodeOfType(property.key, "Literal") && property.key.value === propertyKey))
        ) {
          return resolveValueNode(property.value, writes, depth + 1, seen);
        }
      }
    }
    return null;
  }
  return null;
};

// Number a node resolves to: a numeric literal, or `<empty/known array>.length`.
const resolveToNumber = (
  node: EsTreeNode,
  writes: ReadonlyMap<string, EsTreeNode>,
  depth: number,
  seen: ReadonlySet<string>,
): number | null => {
  const value = resolveValueNode(node, writes, depth, seen);
  if (value && isNodeOfType(value, "Literal") && typeof value.value === "number")
    return value.value;
  const current = unwrapChain(node);
  if (
    isNodeOfType(current, "MemberExpression") &&
    !current.computed &&
    isNodeOfType(current.property, "Identifier") &&
    current.property.name === "length"
  ) {
    const objectValue = resolveValueNode(current.object, writes, depth, seen);
    if (objectValue && isNodeOfType(objectValue, "ArrayExpression")) {
      const elements = objectValue.elements ?? [];
      if (!elements.some((element) => element && isNodeOfType(element, "SpreadElement"))) {
        return elements.length;
      }
    }
  }
  return null;
};

const provablyEqualAfterWrites = (
  left: EsTreeNode,
  right: EsTreeNode,
  writes: ReadonlyMap<string, EsTreeNode>,
  depth: number,
  seen: ReadonlySet<string>,
): boolean => {
  const leftNumber = resolveToNumber(left, writes, depth, seen);
  const rightNumber = resolveToNumber(right, writes, depth, seen);
  if (leftNumber !== null && rightNumber !== null) return leftNumber === rightNumber;
  const a = resolveValueNode(left, writes, depth, seen);
  const b = resolveValueNode(right, writes, depth, seen);
  if (!a || !b) return false;
  if (literalsEqual(a, b)) return true;
  if (isUndefinedValue(a) && isUndefinedValue(b)) return true;
  return isNodeOfType(a, "Identifier") && isNodeOfType(b, "Identifier") && a.name === b.name;
};

const provablyFalsyAfterWrites = (
  node: EsTreeNode,
  writes: ReadonlyMap<string, EsTreeNode>,
  depth: number,
  seen: ReadonlySet<string>,
): boolean => {
  const value = resolveValueNode(node, writes, depth, seen);
  if (value) {
    if (isUndefinedValue(value)) return true;
    if (isNodeOfType(value, "Literal")) {
      return (
        value.value === null || value.value === 0 || value.value === false || value.value === ""
      );
    }
    // Array / object literals are truthy.
  }
  const asNumber = resolveToNumber(node, writes, depth, seen);
  return asNumber === 0;
};

// Does `test` provably evaluate to TRUE against the post-write state?
const guardProvenAfterWrites = (
  test: EsTreeNode,
  writes: ReadonlyMap<string, EsTreeNode>,
  depth: number,
  seen: ReadonlySet<string>,
): boolean => {
  if (depth > SYMBOLIC_DEPTH_LIMIT) return false;
  const node = unwrapChain(test);
  if (isNodeOfType(node, "LogicalExpression")) {
    if (node.operator === "&&") {
      return (
        guardProvenAfterWrites(node.left, writes, depth + 1, seen) &&
        guardProvenAfterWrites(node.right, writes, depth + 1, seen)
      );
    }
    if (node.operator === "||") {
      return (
        guardProvenAfterWrites(node.left, writes, depth + 1, seen) ||
        guardProvenAfterWrites(node.right, writes, depth + 1, seen)
      );
    }
    return false;
  }
  if (isNodeOfType(node, "UnaryExpression") && node.operator === "!") {
    return provablyFalsyAfterWrites(node.argument, writes, depth + 1, seen);
  }
  if (isNodeOfType(node, "BinaryExpression")) {
    if (node.operator === "===" || node.operator === "==") {
      return provablyEqualAfterWrites(node.left, node.right, writes, depth + 1, seen);
    }
    const leftNumber = resolveToNumber(node.left, writes, depth + 1, seen);
    const rightNumber = resolveToNumber(node.right, writes, depth + 1, seen);
    if (leftNumber !== null && rightNumber !== null) {
      return numericComparisonHolds(node.operator, leftNumber, rightNumber);
    }
    return false;
  }
  const value = resolveValueNode(node, writes, depth + 1, seen);
  if (value) {
    if (isNodeOfType(value, "ArrayExpression") || isNodeOfType(value, "ObjectExpression"))
      return true;
    if (isNodeOfType(value, "Literal")) return Boolean(value.value);
  }
  return false;
};

// New value each top-level unconditional setter writes (functional updater →
// its returned expression, direct call → the argument). Last write wins.
const collectTopLevelWrites = (
  statements: readonly EsTreeNode[],
  setterNameToStateName: ReadonlyMap<string, string>,
  setterNames: ReadonlySet<string>,
): { writes: ReadonlyMap<string, EsTreeNode>; setterCallNodes: ReadonlySet<EsTreeNode> } => {
  const writes = new Map<string, EsTreeNode>();
  const setterCallNodes = new Set<EsTreeNode>();
  for (const statement of statements) {
    const setterCall = getUnconditionalSetterCall(statement, setterNames);
    if (!setterCall || !isNodeOfType(setterCall.callee, "Identifier")) continue;
    setterCallNodes.add(setterCall);
    const stateName = setterNameToStateName.get(setterCall.callee.name);
    if (!stateName) continue;
    const argument = setterCall.arguments?.[0];
    if (!argument) continue;
    const newValue =
      isNodeOfType(argument, "ArrowFunctionExpression") ||
      isNodeOfType(argument, "FunctionExpression")
        ? functionReturnExpression(argument)
        : stripParenExpression(argument);
    if (newValue) writes.set(stateName, newValue);
  }
  return { writes, setterCallNodes };
};

// Walks the whole callback collecting every setter CallExpression (nested or
// not) whose callee is `setterName`, and runs `inspect` on each. Returns false
// as soon as `inspect` rejects one.
const everySetterCall = (
  root: EsTreeNode,
  setterName: string,
  inspect: (call: EsTreeNodeOfType<"CallExpression">) => boolean,
): boolean => {
  let ok = true;
  const visit = (node: EsTreeNode): void => {
    if (!ok) return;
    if (
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.callee, "Identifier") &&
      node.callee.name === setterName &&
      !inspect(node)
    ) {
      ok = false;
      return;
    }
    const record = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent" || key === "type") continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child) if (isAstNode(item)) visit(item);
      } else if (isAstNode(child)) {
        visit(child);
      }
      if (!ok) return;
    }
  };
  visit(root);
  return ok;
};

// SOUND gate for the monotonic empty-fixpoint path: every write to the state
// (including nested/conditional ones) must drive it toward empty. Otherwise a
// sibling write like `if (x) setItems([x])` re-dirties the state and the
// "converges at empty" argument breaks. (nhost stays valid — both its writes,
// `setPath([])` and `setPath(p => p.slice(1))`, drive toward empty.)
const everyWriteToStateDrivesTowardEmpty = (
  callbackBody: EsTreeNode,
  setterName: string,
): boolean =>
  everySetterCall(callbackBody, setterName, (call) => {
    const argument = call.arguments?.[0];
    if (!argument) return true; // `setX()` writes `undefined` — already empty/falsy
    const value = stripParenExpression(argument);
    return isEmptyOrFalsyValue(value) || isLengthReducingUpdater(value);
  });

// True only when every setter call in the effect is one of the top-level
// unconditional writes we captured. If a setter hides inside an `if` / callback,
// the post-write state we modelled may be wrong, so the symbolic proof is unsafe
// and we decline it (the monotonic-empty path still applies where valid).
const everySetterCallIsTopLevel = (
  callbackBody: EsTreeNode,
  setterNames: ReadonlySet<string>,
  topLevelSetterCalls: ReadonlySet<EsTreeNode>,
): boolean => {
  let safe = true;
  const visit = (node: EsTreeNode): void => {
    if (!safe) return;
    if (
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.callee, "Identifier") &&
      setterNames.has(node.callee.name) &&
      !topLevelSetterCalls.has(node)
    ) {
      safe = false;
      return;
    }
    const record = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent" || key === "type") continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child) if (isAstNode(item)) visit(item);
      } else if (isAstNode(child)) {
        visit(child);
      }
      if (!safe) return;
    }
  };
  visit(callbackBody);
  return safe;
};

export const noSelfUpdatingEffect = defineRule<Rule>({
  id: "no-self-updating-effect",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Remove the feedback loop: derive the value during render, move the write into an event handler, or guard the update so it reaches a fixed point. See https://react.dev/learn/you-might-not-need-an-effect",
  create: (context: RuleContext) => {
    const checkFunctionScope = (functionBody: EsTreeNode | null | undefined): void => {
      if (!functionBody || !isNodeOfType(functionBody, "BlockStatement")) return;

      const useStateBindings = collectUseStateBindings(functionBody);
      if (useStateBindings.length === 0) return;

      const setterNameToStateName = new Map<string, string>();
      for (const binding of useStateBindings) {
        setterNameToStateName.set(binding.setterName, binding.valueName);
      }
      const setterNames = new Set(setterNameToStateName.keys());

      for (const statement of functionBody.body ?? []) {
        if (!isNodeOfType(statement, "ExpressionStatement")) continue;
        const effectCall = statement.expression;
        if (!isNodeOfType(effectCall, "CallExpression")) continue;
        if (!isHookCall(effectCall, EFFECT_HOOK_NAMES)) continue;
        if ((effectCall.arguments?.length ?? 0) < 2) continue;

        const dependencyStateNames = collectDependencyStateNames(effectCall.arguments[1]);
        if (dependencyStateNames.size === 0) continue;

        const callback = getEffectCallback(effectCall);
        if (!callback) continue;

        // Only the effect's own synchronous statements are walked.
        // Setters inside nested timer / subscription / promise
        // callbacks are deferred writes that fire on a later tick, and
        // setters guarded by an `if` can reach a fixed point — neither
        // is an unconditional feedback loop, so both are left to other
        // rules.
        const callbackStatements = getCallbackStatements(callback);
        // Guards that run BEFORE any write — only these can bail out the next
        // run before the writes re-execute, so only these prove convergence.
        const firstWriteIndex = callbackStatements.findIndex(
          (candidate) => getUnconditionalSetterCall(candidate, setterNames) !== null,
        );
        const guardCutoff = firstWriteIndex < 0 ? callbackStatements.length : firstWriteIndex;
        const earlyReturnGuardTests = callbackStatements
          .slice(0, guardCutoff)
          .filter(isEarlyReturnGuard)
          .map((guard) => guard.test);

        // General convergence proof: if the effect's own writes make one of its
        // pre-write guards TRUE, the next render bails before re-writing, so the
        // whole effect settles. Only trusted when every setter is a top-level
        // unconditional write (else the modelled post-write state is unreliable).
        const { writes: topLevelWrites, setterCallNodes } = collectTopLevelWrites(
          callbackStatements,
          setterNameToStateName,
          setterNames,
        );
        const effectConvergesByGuard =
          everySetterCallIsTopLevel(callback, setterNames, setterCallNodes) &&
          earlyReturnGuardTests.some((test) =>
            guardProvenAfterWrites(test, topLevelWrites, 0, new Set<string>()),
          );
        if (effectConvergesByGuard) continue;

        const reportedStateNames = new Set<string>();
        for (const callbackStatement of callbackStatements) {
          const setterCall = getUnconditionalSetterCall(callbackStatement, setterNames);
          if (!setterCall || !isNodeOfType(setterCall.callee, "Identifier")) continue;

          const stateName = setterNameToStateName.get(setterCall.callee.name);
          if (!stateName || !dependencyStateNames.has(stateName)) continue;
          if (reportedStateNames.has(stateName)) continue;
          if (!isNonSettlingSetterArgument(setterCall, stateName)) continue;

          const firstArgument = setterCall.arguments?.[0];
          if (
            firstArgument &&
            writeProvablyConverges(
              stripParenExpression(firstArgument),
              stateName,
              earlyReturnGuardTests,
            ) &&
            everyWriteToStateDrivesTowardEmpty(callback, setterCall.callee.name)
          ) {
            continue;
          }

          reportedStateNames.add(stateName);
          context.report({
            node: setterCall,
            message: `${setterCall.callee.name}() runs unconditionally inside this effect, which depends on \`${stateName}\` — setting the same state the effect reacts to re-runs the effect on every commit and causes a render loop. Derive the value during render, move the write into an event handler, or guard the update so it settles.`,
          });
        }
      }
    };

    return {
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        const functionName = node.id?.name;
        if (!functionName || (!isUppercaseName(functionName) && !isReactHookName(functionName))) {
          return;
        }
        checkFunctionScope(node.body);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        const isHookAssignment =
          isNodeOfType(node.id, "Identifier") &&
          isReactHookName(node.id.name) &&
          (isNodeOfType(node.init, "ArrowFunctionExpression") ||
            isNodeOfType(node.init, "FunctionExpression"));
        if (!isComponentAssignment(node) && !isHookAssignment) return;
        if (
          !isNodeOfType(node.init, "ArrowFunctionExpression") &&
          !isNodeOfType(node.init, "FunctionExpression")
        ) {
          return;
        }
        checkFunctionScope(node.init.body);
      },
    };
  },
});
