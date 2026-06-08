import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isInsideFunctionScope } from "../../utils/is-inside-function-scope.js";
import { isJsxAttributeOnIntrinsicHtmlElement } from "../../utils/is-on-intrinsic-html-element.js";
import {
  buildSameFileMemoRegistry,
  memoStatusForJsxOpeningName,
  type MemoStatus,
} from "../../utils/build-same-file-memo-registry.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { Rule } from "../../utils/rule.js";
import {
  ACCESSOR_PREDICATE_PREFIXES,
  ONE_SHOT_HANDLER_SUFFIXES,
  ONE_SHOT_LIFECYCLE_HANDLER_NAMES,
  SAFE_RECEIVER_NAMES,
} from "./jsx-no-new-function-as-prop-tables.js";

const MESSAGE =
  "This child redraws every render because the prop gets a brand new function each time.";

const isAccessorPredicateName = (propName: string): boolean => {
  for (const prefix of ACCESSOR_PREDICATE_PREFIXES) {
    if (propName.length <= prefix.length) continue;
    if (!propName.startsWith(prefix)) continue;
    const nextChar = propName.charCodeAt(prefix.length);
    // require uppercase after the prefix (so `get` doesn't false-match
    // `gather`, `should` doesn't match `shouldery`, etc.)
    if (nextChar >= 65 && nextChar <= 90) return true;
  }
  return false;
};

const isOneShotHandlerName = (propName: string): boolean => {
  if (ONE_SHOT_LIFECYCLE_HANDLER_NAMES.has(propName)) return true;
  if (propName.startsWith("render") && propName.length > 6) {
    const fourthCharCode = propName.charCodeAt(6);
    // `render<X>` where X is uppercase A-Z = render-prop convention
    if (fourthCharCode >= 65 && fourthCharCode <= 90) return true;
  }
  if (isAccessorPredicateName(propName)) return true;
  for (const suffix of ONE_SHOT_HANDLER_SUFFIXES) {
    if (propName.length > suffix.length && propName.endsWith(suffix)) return true;
  }
  return false;
};

const isFunctionProducingExpression = (expression: EsTreeNode): boolean => {
  const stripped = stripParenExpression(expression);
  if (
    isNodeOfType(stripped, "ArrowFunctionExpression") ||
    isNodeOfType(stripped, "FunctionExpression") ||
    isNodeOfType(stripped, "FunctionDeclaration")
  ) {
    return true;
  }
  if (isNodeOfType(stripped, "NewExpression")) {
    return isNodeOfType(stripped.callee, "Identifier") && stripped.callee.name === "Function";
  }
  if (isNodeOfType(stripped, "CallExpression")) {
    if (isNodeOfType(stripped.callee, "Identifier") && stripped.callee.name === "Function") {
      return true;
    }
    if (
      isNodeOfType(stripped.callee, "MemberExpression") &&
      isNodeOfType(stripped.callee.property, "Identifier") &&
      stripped.callee.property.name === "bind"
    ) {
      return true;
    }
    return false;
  }
  if (isNodeOfType(stripped, "LogicalExpression")) {
    return (
      isFunctionProducingExpression(stripped.left) || isFunctionProducingExpression(stripped.right)
    );
  }
  if (isNodeOfType(stripped, "ConditionalExpression")) {
    return (
      isFunctionProducingExpression(stripped.consequent) ||
      isFunctionProducingExpression(stripped.alternate)
    );
  }
  return false;
};

const followsRenderLocalFunctionBinding = (
  expression: EsTreeNode,
  jsxAttribute: EsTreeNode,
): boolean => {
  const stripped = stripParenExpression(expression);
  if (!isNodeOfType(stripped, "Identifier")) return false;
  const binding = findVariableInitializer(stripped, stripped.name);
  if (!binding || !binding.initializer) return false;
  let walker: EsTreeNode | null = jsxAttribute;
  while (walker) {
    if (walker === binding.scopeOwner) {
      if (binding.scopeOwner.type === "Program") return false;
      break;
    }
    walker = walker.parent ?? null;
  }
  if (!isFunctionProducingExpression(binding.initializer)) return false;
  // If the binding's initializer is itself a stable wrapper, then
  // naming it and passing it as `onClick={handleX}` is no different
  // from passing the inline arrow `onClick={() => fn()}`. `useCallback`
  // can't help in either shape, so don't flag.
  if (isParameterBindingWrapper(binding.initializer as EsTreeNode)) return false;
  // Also skip when the binding is a hooked-up handler from a hook
  // call — `const handleSubmit = useSubmit(...)` style. The hook
  // is responsible for its own memoisation (most React hooks
  // return stable refs for callbacks).
  const init = binding.initializer as EsTreeNode;
  if (isNodeOfType(init, "CallExpression")) {
    const callee = init.callee;
    if (isNodeOfType(callee, "Identifier") && callee.name.startsWith("use")) {
      return false;
    }
    if (
      isNodeOfType(callee, "MemberExpression") &&
      isNodeOfType(callee.property, "Identifier") &&
      callee.property.name.startsWith("use")
    ) {
      return false;
    }
  }
  return true;
};

// `(…params) => fn(arg1, arg2, …)` — an arrow whose ENTIRE body is a
// single call (or method invocation) where every argument is a stable
// value (literal, identifier, member access, the arrow's own param, or
// a chain expression of those). The wrapper exists purely to adapt the
// caller's signature to the inner call's argument list — and the user
// CAN'T `useCallback` it: the closure MUST capture the outer scope's
// identifier references (which themselves often aren't stable). The
// only "fix" would be restructuring the data flow (`<X arg={…} />`
// instead of `onClick={(e) => fn(arg, e)}`), which is a major refactor
// for a tiny perf gain that only materializes on `React.memo` consumers
// — most internal app components aren't memo'd, so the cost is zero.
//
// Covered shapes (all skipped):
//   () => fn()
//   () => fn(literal, outerIdentifier)
//   (e) => fn(e)
//   (e) => e.stopPropagation()
//   (value) => onChange?.(value)
//   (x) => x?.foo.bar
//   (a, b) => fn(a, b)
//   (e) => e.key === 'Enter' && saveProperty()
//
// NOT covered (still flagged):
//   () => fn({ ... })       — inline object construction is per-render
//   () => fn([...x, ...])   — inline array
//   () => { setA(); setB(); } — multiple statements (real work)
//   () => () => fn()        — returns a function (HoC-style)
const isStableArgumentValue = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "Literal")) return true;
  if (isNodeOfType(node, "TemplateLiteral")) {
    return (node.expressions ?? []).every((expression) =>
      isStableArgumentValue(expression as EsTreeNode),
    );
  }
  if (isNodeOfType(node, "Identifier")) return true;
  if (isNodeOfType(node, "MemberExpression")) return true;
  if (isNodeOfType(node, "UnaryExpression")) {
    return isStableArgumentValue(node.argument as EsTreeNode);
  }
  if (isNodeOfType(node, "ChainExpression")) {
    return isStableArgumentValue(node.expression as EsTreeNode);
  }
  // `value as string` / `value as MyType` — TypeScript type
  // assertions erase at runtime, the underlying expression is what
  // matters. Without this, `(value) => onTimeRangeChange(value as string, 1)`
  // (the canonical "narrow the typed arg" shape) doesn't match the
  // parameter-binding wrapper.
  if (
    (node as { type: string }).type === "TSAsExpression" ||
    (node as { type: string }).type === "TSTypeAssertion" ||
    (node as { type: string }).type === "TSNonNullExpression" ||
    (node as { type: string }).type === "TSSatisfiesExpression"
  ) {
    return isStableArgumentValue((node as { expression: EsTreeNode }).expression);
  }
  // `value ? 'on' : 'off'` — ternary with both branches stable.
  if (isNodeOfType(node, "ConditionalExpression")) {
    return (
      isStableArgumentValue(node.test as EsTreeNode) &&
      isStableArgumentValue(node.consequent as EsTreeNode) &&
      isStableArgumentValue(node.alternate as EsTreeNode)
    );
  }
  // `value ?? defaultValue` / `value || ''` — fallback with stable
  // both sides. `(v) => setX(v ?? '')` is still adapting one arg
  // into a setter call; useCallback won't help.
  if (
    isNodeOfType(node, "LogicalExpression") &&
    (node.operator === "??" || node.operator === "||" || node.operator === "&&")
  ) {
    return (
      isStableArgumentValue(node.left as EsTreeNode) &&
      isStableArgumentValue(node.right as EsTreeNode)
    );
  }
  // `value + 1` / `index - 1` / `'prefix' + value` — arithmetic /
  // concatenation with stable operands. Page-step handlers like
  // `() => setPage(page + 1)` get to this point.
  if (
    isNodeOfType(node, "BinaryExpression") &&
    isStableArgumentValue(node.left as EsTreeNode) &&
    isStableArgumentValue(node.right as EsTreeNode)
  ) {
    return true;
  }
  // `{ key: value }` / `{ value }` (shorthand) — shape-transformation
  // wrapper like `(value) => setFilters({ search: value })`. The
  // wrapper IS allocating an object per call, but useCallback can't
  // fix that — the OBJECT identity is per-invocation, not per-render.
  // The only "fix" would be to restructure the data flow (e.g.
  // `setFilters(prev => ({ ...prev, search: value }))`), which is a
  // major refactor. Skip unless one of the properties is itself a
  // non-stable shape.
  if (isNodeOfType(node, "ObjectExpression")) {
    for (const property of node.properties ?? []) {
      if (isNodeOfType(property, "SpreadElement")) {
        // `{ ...x, key: value }` — the spread brings in an outer
        // value, that's still stable (the spread is over an
        // identifier/member access).
        if (!isStableArgumentValue(property.argument as EsTreeNode)) return false;
        continue;
      }
      if (!isNodeOfType(property, "Property")) return false;
      if (property.shorthand) continue;
      if (!isStableArgumentValue(property.value as EsTreeNode)) return false;
    }
    return true;
  }
  // `[a, b, c]` — array shape transformation, same reasoning as
  // ObjectExpression.
  if (isNodeOfType(node, "ArrayExpression")) {
    for (const element of node.elements ?? []) {
      if (!element) continue;
      if (isNodeOfType(element, "SpreadElement")) {
        if (!isStableArgumentValue(element.argument as EsTreeNode)) return false;
        continue;
      }
      if (!isStableArgumentValue(element as EsTreeNode)) return false;
    }
    return true;
  }
  // Nested CallExpression — `setX(getValue(prop))` style. Accept
  // when the nested call is itself stable (pure namespace OR all
  // args are stable). Same reasoning as the wrapper itself:
  // useCallback can't fix nested-call allocation.
  if (isNodeOfType(node, "CallExpression")) {
    return isStableCallExpression(node);
  }
  // `tag\`literal\`` — i18n template tags like `t\`Save\``. Treat as
  // stable string-like result.
  if ((node as { type: string }).type === "TaggedTemplateExpression") {
    return true;
  }
  return false;
};

const calleeReceiverName = (callee: EsTreeNode): string | null => {
  let cursor: EsTreeNode = callee;
  // Walk down chains: `router.actions.push` → root is `router`.
  while (isNodeOfType(cursor, "MemberExpression")) {
    cursor = cursor.object as EsTreeNode;
  }
  return isNodeOfType(cursor, "Identifier") ? cursor.name : null;
};

const isStableCallExpression = (node: EsTreeNode): boolean => {
  let inner = node;
  if (isNodeOfType(inner, "ChainExpression")) inner = inner.expression as EsTreeNode;
  if (!isNodeOfType(inner, "CallExpression")) return false;
  const callee = inner.callee;
  if (!isNodeOfType(callee, "Identifier") && !isNodeOfType(callee, "MemberExpression"))
    return false;
  // For calls on safe-receiver namespaces (`router.push(...)`,
  // `console.log(...)`, `Sentry.captureException(...)`), any
  // argument shape is fine — these are fire-and-forget side
  // effects, not data hand-off to a memoised consumer.
  const receiverName = calleeReceiverName(callee);
  if (receiverName && SAFE_RECEIVER_NAMES.has(receiverName)) return true;
  for (const argument of inner.arguments ?? []) {
    if (!isStableArgumentValue(argument as EsTreeNode)) return false;
  }
  return true;
};

const isLightweightBodyExpression = (body: EsTreeNode): boolean => {
  // Direct call: `(e) => fn(e)`, `(e) => e.method()`, `(v) => fn?.(v)`
  if (isStableCallExpression(body)) return true;
  if (isNodeOfType(body, "ChainExpression")) {
    return isLightweightBodyExpression(body.expression as EsTreeNode);
  }
  // Short-circuit guard: `(e) => e.key === 'Enter' && saveProperty()`
  // / `(v) => v && onChange(v)` — left is any stable value (the
  // guard), right is a lightweight expression. At least one side
  // must be a call so we don't accidentally accept `(x) => x && x`.
  if (
    isNodeOfType(body, "LogicalExpression") &&
    (body.operator === "&&" || body.operator === "||" || body.operator === "??")
  ) {
    const leftStable =
      isStableArgumentValue(body.left as EsTreeNode) ||
      isLightweightBodyExpression(body.left as EsTreeNode);
    const rightStable =
      isStableArgumentValue(body.right as EsTreeNode) ||
      isLightweightBodyExpression(body.right as EsTreeNode);
    if (!leftStable || !rightStable) return false;
    const leftIsCall =
      isNodeOfType(body.left as EsTreeNode, "CallExpression") ||
      (isNodeOfType(body.left as EsTreeNode, "ChainExpression") &&
        isNodeOfType(
          (body.left as EsTreeNodeOfType<"ChainExpression">).expression as EsTreeNode,
          "CallExpression",
        ));
    const rightIsCall =
      isNodeOfType(body.right as EsTreeNode, "CallExpression") ||
      (isNodeOfType(body.right as EsTreeNode, "ChainExpression") &&
        isNodeOfType(
          (body.right as EsTreeNodeOfType<"ChainExpression">).expression as EsTreeNode,
          "CallExpression",
        ));
    return leftIsCall || rightIsCall;
  }
  // Ternary body: `(e) => cond ? fn(e) : other(e)` — accept when
  // both branches are themselves lightweight calls.
  if (isNodeOfType(body, "ConditionalExpression")) {
    return (
      isLightweightBodyExpression(body.consequent as EsTreeNode) &&
      isLightweightBodyExpression(body.alternate as EsTreeNode)
    );
  }
  // `void copyToClipboard(value)` — `void` wrapper around a stable
  // call. The void just discards the return value (often used to
  // signal "I'm intentionally not awaiting this promise").
  if (
    isNodeOfType(body, "UnaryExpression") &&
    (body.operator === "void" || body.operator === "!")
  ) {
    return isLightweightBodyExpression(body.argument as EsTreeNode);
  }
  // `await fn(arg)` — async wrappers, treated the same as the
  // underlying call. `async () => await save(item)` is just a
  // promise-returning wrapper.
  if ((body as { type: string }).type === "AwaitExpression") {
    return isLightweightBodyExpression((body as { argument: EsTreeNode }).argument);
  }
  // `(value as string)` style TS assertion at the body level — unwrap.
  if (
    (body as { type: string }).type === "TSAsExpression" ||
    (body as { type: string }).type === "TSTypeAssertion" ||
    (body as { type: string }).type === "TSNonNullExpression" ||
    (body as { type: string }).type === "TSSatisfiesExpression"
  ) {
    return isLightweightBodyExpression((body as { expression: EsTreeNode }).expression);
  }
  // Pure-value or no-call bodies (`() => true`, `(x) => x.length`) get
  // flagged — these can be trivially hoisted (`const T = () => true`).
  return false;
};

// At this depth the gate is "every statement is itself a stable
// wrapper-like expression", not "the block is short". A 5-statement
// block where every statement is `setX(literal)` / `if (cond)
// setY(literal)` is still tiny adaptation work that `useCallback`
// can't optimise.
const MAX_STABLE_STATEMENTS_IN_BLOCK = 8;

const isStableStatement = (statement: EsTreeNode): boolean => {
  if (isNodeOfType(statement, "ExpressionStatement")) {
    return isLightweightBodyExpression(statement.expression as EsTreeNode);
  }
  if (isNodeOfType(statement, "ReturnStatement")) {
    if (!statement.argument) return true;
    return isLightweightBodyExpression(statement.argument as EsTreeNode);
  }
  // `const x = stableValue; …` — local binding for a stable
  // computation. The init expression must itself be stable.
  if (isNodeOfType(statement, "VariableDeclaration")) {
    for (const declarator of statement.declarations ?? []) {
      if (!isNodeOfType(declarator, "VariableDeclarator")) return false;
      if (!declarator.init) continue;
      if (!isStableArgumentValue(declarator.init as EsTreeNode)) return false;
    }
    return true;
  }
  // `if (guard) stableStatement` — common pattern in event-handler
  // wrappers (`() => { if (!disabled) onChange(value) }`). The guard
  // is a stable test (literal / identifier / member / arithmetic /
  // logical) and the consequent is itself a stable statement (or
  // block of stable statements).
  if (isNodeOfType(statement, "IfStatement")) {
    if (!isStableArgumentValue(statement.test as EsTreeNode)) return false;
    if (!isStableStatement(statement.consequent as EsTreeNode)) return false;
    if (statement.alternate && !isStableStatement(statement.alternate as EsTreeNode)) {
      return false;
    }
    return true;
  }
  if (isNodeOfType(statement, "BlockStatement")) {
    return isStableStatementBlock(statement.body ?? []);
  }
  return false;
};

const isStableStatementBlock = (statements: ReadonlyArray<EsTreeNode>): boolean => {
  if (statements.length === 0) return true;
  if (statements.length > MAX_STABLE_STATEMENTS_IN_BLOCK) return false;
  for (const statement of statements) {
    if (!isStableStatement(statement)) return false;
  }
  return true;
};

// Returns true when the value at this prop slot is either nothing
// (null / undefined / not-passed) or a stable wrapper / identifier.
// The ternary `cond ? () => fn() : undefined` shape is the canonical
// "conditional handler" — one branch wraps, the other passes
// nothing. There's no useCallback win here: the wrapper still has
// to allocate when `cond` is truthy.
const isNullishOrStableWrapper = (expression: EsTreeNode): boolean => {
  const stripped = stripParenExpression(expression);
  if (isNodeOfType(stripped, "Literal")) {
    return (stripped as { value?: unknown }).value === null;
  }
  // Only the literal identifier `undefined` is nullish. Other
  // identifiers (`onClick`, `props.onSubmit`, etc.) might resolve to
  // a freshly-allocated function — `cond ? () => fn() : onClick`
  // still allocates on every render the truthy branch fires, and
  // `useCallback` IS able to fix that. Bailing out here would be a
  // false negative.
  if (isNodeOfType(stripped, "Identifier")) {
    return stripped.name === "undefined";
  }
  if (isNodeOfType(stripped, "ArrowFunctionExpression")) {
    return isParameterBindingWrapper(stripped);
  }
  if (isNodeOfType(stripped, "ConditionalExpression")) {
    return (
      isNullishOrStableWrapper(stripped.consequent as EsTreeNode) &&
      isNullishOrStableWrapper(stripped.alternate as EsTreeNode)
    );
  }
  if (
    isNodeOfType(stripped, "LogicalExpression") &&
    (stripped.operator === "??" || stripped.operator === "||" || stripped.operator === "&&")
  ) {
    return (
      isNullishOrStableWrapper(stripped.left as EsTreeNode) &&
      isNullishOrStableWrapper(stripped.right as EsTreeNode)
    );
  }
  return false;
};

const isParameterBindingWrapper = (expression: EsTreeNode): boolean => {
  const stripped = stripParenExpression(expression);
  // `cond ? () => fn(arg) : undefined` — ternary where each branch
  // is itself a stable wrapper / nullish. Same `useCallback can't
  // help` reasoning as the underlying wrapper.
  if (isNodeOfType(stripped, "ConditionalExpression")) {
    return (
      isNullishOrStableWrapper(stripped.consequent as EsTreeNode) &&
      isNullishOrStableWrapper(stripped.alternate as EsTreeNode) &&
      // Require AT LEAST one branch to be a wrapper (else the rule
      // never would have fired — it's not function-producing at all).
      (isNodeOfType(stripped.consequent as EsTreeNode, "ArrowFunctionExpression") ||
        isNodeOfType(stripped.alternate as EsTreeNode, "ArrowFunctionExpression"))
    );
  }
  if (!isNodeOfType(stripped, "ArrowFunctionExpression")) return false;
  // Expression-form body (no braces) — single expression at the top.
  const body = stripped.body as EsTreeNode;
  if (!isNodeOfType(body, "BlockStatement")) {
    return isLightweightBodyExpression(body);
  }
  // Block body — accept up to MAX stable statements OR a single
  // if-guard around stable work. The wrapper is doing tiny
  // adaptation work that useCallback can't meaningfully optimise.
  return isStableStatementBlock(body.body ?? []);
};

// Port of `oxc_linter::rules::react_perf::jsx_no_new_function_as_prop`.
// Covers inline expressions AND render-local identifier bindings:
// `const x = () => {}; return <C onClick={x} />` IS flagged when `x`
// is declared in the render function's scope. Hoisted bindings
// (module scope) are exempt — the allocation only happens once.
// See `followsRenderLocalFunctionBinding` for the resolution details.
export const jsxNoNewFunctionAsProp = defineRule<Rule>({
  id: "jsx-no-new-function-as-prop",
  title: "New function passed as a prop",
  tags: ["react-jsx-only"],
  severity: "warn",
  // React Compiler auto-memoizes inline callbacks. The perf footgun this
  // rule guards against doesn't exist in compiler-enabled projects.
  disabledBy: ["react-compiler"],
  recommendation:
    "Wrap the callback in `useCallback` or move it outside the component so memoized children do not redraw every render.",
  category: "Performance",
  create: (context) => {
    const isTestlikeFile = isTestlikeFilename(context.filename);
    let memoRegistry: Map<string, MemoStatus> | null = null;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        memoRegistry = buildSameFileMemoRegistry(node as EsTreeNode);
      },
      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        if (isTestlikeFile) return;
        // Intrinsic HTML elements (`<button onClick={...}>`) aren't
        // memoized — neither the browser nor React caches DOM event
        // listeners, so a new function per render has no measurable
        // cost. Flagging them is unactionable noise. The rule still
        // fires on custom-component props where downstream `React.memo`
        // bails on the new reference.
        if (isJsxAttributeOnIntrinsicHtmlElement(node)) return;
        // Consumer-memo gate. The `useCallback`/extract-handler fix
        // ONLY produces a measurable render saving when the consumer
        // component is wrapped in `React.memo` / `memo` / `forwardRef`
        // / `observer` — otherwise the parent re-renders unconditionally
        // on every prop change regardless of function identity.
        //
        // Earlier behaviour: skip ONLY when same-file analysis proves
        // the consumer is NOT memoised (otherwise fire). Audit on 100
        // repos showed this was ~95 % FP: most consumers are imported
        // from another file (status: "unknown"), and the vast majority
        // of those imported components AREN'T memoised either.
        //
        // New behaviour: only fire when same-file analysis PROVES the
        // consumer IS memoised. "unknown" and "not-memoised" both
        // short-circuit. Trades coverage of "imported-memoed consumer"
        // (rare in real codebases) for ~85 % FP reduction on the
        // dominant "imported-non-memoed consumer" case.
        const parentJsxOpening = node.parent;
        const openingName =
          parentJsxOpening && isNodeOfType(parentJsxOpening, "JSXOpeningElement")
            ? (parentJsxOpening.name as EsTreeNode)
            : null;
        if (memoStatusForJsxOpeningName(memoRegistry, openingName) !== "memoised") return;
        // One-shot lifecycle handlers (onMount / onError / onClose /
        // etc.) and render-prop slots (`fallback`, `render*`, `*Render`,
        // `*Renderer`, etc.) accept inline functions by design — they
        // either fire at most once per lifecycle or are used by the
        // parent for opaque rendering. New function reference per
        // render has zero measurable perf impact.
        if (isNodeOfType(node.name, "JSXIdentifier") && isOneShotHandlerName(node.name.name)) {
          return;
        }
        if (!isInsideFunctionScope(node)) return;
        const value = node.value;
        if (!value || !isNodeOfType(value, "JSXExpressionContainer")) return;
        const expression = value.expression;
        if (!expression || expression.type === "JSXEmptyExpression") return;
        const expressionNode = expression as EsTreeNode;
        // Parameter-binding wrappers (`() => fn(arg1, arg2)`) can't be
        // useCallback-ed — the closure must capture `arg1`/`arg2`.
        if (isParameterBindingWrapper(expressionNode)) return;
        if (
          !isFunctionProducingExpression(expressionNode) &&
          !followsRenderLocalFunctionBinding(expressionNode, node)
        ) {
          return;
        }
        context.report({ node, message: MESSAGE });
      },
    };
  },
});
