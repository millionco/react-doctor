import type { Reference } from "eslint-scope";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isInitialOnlyPropName } from "../../utils/is-initial-only-prop-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getCallExpr, getDownstreamRefs, getUpstreamRefs } from "./utils/effect/ast.js";
import { readsPostMountValueThroughLocals } from "./utils/reads-post-mount-through-locals.js";
import { getProgramAnalysis, type ProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import { isControlledPropMirror } from "./utils/is-controlled-prop-mirror.js";
import {
  getEffectDepsRefs,
  getEffectFn,
  getEffectFnRefs,
  getUseStateDecl,
  hasCleanup,
  isProp,
  isState,
  isStateSetter,
  isSyncStateSetterCall,
  isUseEffect,
} from "./utils/effect/react.js";
import { hasUserInputSetterWriter } from "./utils/has-user-input-setter-writer.js";

// 1:1 port of upstream
// `eslint-plugin-react-you-might-not-need-an-effect/src/rules/no-derived-state.js`.
// Diagnostic messages match upstream verbatim. The ESLint scope APIs
// upstream uses (`context.sourceCode.getScope`, `ref.resolved.defs`)
// are sourced from a cached eslint-scope `ScopeManager` via
// `getProgramAnalysis(node)`.

const countSetterCallSites = (ref: Reference): number => {
  if (!ref.resolved) return 0;
  let count = 0;
  for (const reference of ref.resolved.references) {
    const parent = (reference.identifier as unknown as { parent?: EsTreeNode | null }).parent;
    if (parent && isNodeOfType(parent, "CallExpression")) count += 1;
  }
  return count;
};

// Reads of the updater function's own parameter inside its body —
// `previous` in `setKeys((previous) => new Set(previous).add(key))`.
// Resolved through eslint-scope so a shadowing inner binding named the
// same does not count.
const collectUpdaterParameterReads = (
  analysis: ProgramAnalysis,
  updaterFn:
    | EsTreeNodeOfType<"ArrowFunctionExpression">
    | EsTreeNodeOfType<"FunctionExpression">
    | EsTreeNodeOfType<"FunctionDeclaration">,
): EsTreeNode[] => {
  const reads: EsTreeNode[] = [];
  for (const ref of getDownstreamRefs(analysis, updaterFn.body)) {
    const resolvesToOwnParameter = ref.resolved?.defs.some(
      (def) => def.type === "Parameter" && (def.node as unknown as EsTreeNode) === updaterFn,
    );
    if (resolvesToOwnParameter) reads.push(ref.identifier as unknown as EsTreeNode);
  }
  return reads;
};

// `(prev) => ({ ...prev, field: <derived> })` — the previous value is
// only carried through an object spread while every piece of NEW
// information comes from props/state, so the overwritten field is
// still derivable and the report stands (upstream invalid case
// "Partially update complex state from props via callback setter").
const readsParameterOnlyViaObjectSpread = (parameterReads: ReadonlyArray<EsTreeNode>): boolean =>
  parameterReads.every((read) => {
    const spread = read.parent;
    if (!spread || !isNodeOfType(spread, "SpreadElement")) return false;
    const container = spread.parent;
    return Boolean(container && isNodeOfType(container, "ObjectExpression"));
  });

// A functional updater whose new value is computed FROM the previous
// value (`setKeys((previous) => new Set(previous).add(key))`,
// `setTotal((prev) => prev + delta)`, `setItems((prev) => [...prev, item])`)
// accumulates state across renders. An accumulator is by definition not
// derivable from the CURRENT props/state — the rule's entire premise —
// so it must stay quiet. The spread-only object merge is the one
// param-reading shape that is still derived state, so it stays reported.
const isAccumulatingFunctionalUpdater = (
  analysis: ProgramAnalysis,
  callExpr: EsTreeNode,
): boolean => {
  if (!isNodeOfType(callExpr, "CallExpression")) return false;
  const firstArgument: EsTreeNode | undefined = callExpr.arguments?.[0];
  if (!firstArgument || !isFunctionLike(firstArgument)) return false;
  const parameterReads = collectUpdaterParameterReads(analysis, firstArgument);
  if (parameterReads.length === 0) return false;
  return !readsParameterOnlyViaObjectSpread(parameterReads);
};

// `setDateTime` -> "dateTime". Fallback for a destructured state slot
// (`const [{ date, time }, setState] = useState(...)`) that has no single
// identifier to name — keeps the diagnostic from rendering a literal
// "<state>" placeholder.
const deriveStateNameFromSetterName = (setterName: string): string => {
  if (setterName.length > 3 && setterName.startsWith("set")) {
    return setterName[3].toLowerCase() + setterName.slice(4);
  }
  return setterName;
};

const getStateNameForUseStateDecl = (useStateNode: EsTreeNode | null): string | null => {
  if (!useStateNode || !isNodeOfType(useStateNode, "VariableDeclarator")) return null;
  if (!isNodeOfType(useStateNode.id, "ArrayPattern")) return null;
  const elements = useStateNode.id.elements ?? [];
  const stateSlot = elements[0];
  if (stateSlot && isNodeOfType(stateSlot, "Identifier")) return stateSlot.name;
  const setterSlot = elements[1];
  if (setterSlot && isNodeOfType(setterSlot, "Identifier")) {
    return deriveStateNameFromSetterName(setterSlot.name);
  }
  return null;
};

const isUseStateCallExpression = (callExpr: EsTreeNode): boolean => {
  if (!isNodeOfType(callExpr, "CallExpression")) return false;
  const callee = callExpr.callee;
  if (isNodeOfType(callee, "Identifier")) return callee.name === "useState";
  return (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "useState"
  );
};

// Like `getArgsUpstreamRefs`, but skips the setter's own `useState(...)`
// declarator: ascending through the setter binding reaches its definition,
// and treating the useState INITIALIZER's arguments as "what the setter
// writes" made `useState(config.defaultLanguage)` + a mount sync from an
// external store (i18next, a bridge) look prop-derived (docs-validation FP).
const getSetterArgsUpstreamRefs = (analysis: ProgramAnalysis, ref: Reference): Reference[] => {
  const result: Reference[] = [];
  for (const upRef of getUpstreamRefs(analysis, ref)) {
    const callExpr = getCallExpr(upRef);
    if (!callExpr || !isNodeOfType(callExpr, "CallExpression")) continue;
    if (isUseStateCallExpression(callExpr)) continue;
    for (const argument of callExpr.arguments ?? []) {
      for (const argRef of getDownstreamRefs(analysis, argument as EsTreeNode)) {
        for (const innerRef of getUpstreamRefs(analysis, argRef)) {
          result.push(innerRef);
        }
      }
    }
  }
  return result;
};

const refResolvesToDeclarator = (ref: Reference, declarator: EsTreeNode | null): boolean =>
  Boolean(
    declarator &&
    ref.resolved?.defs.some((def) => (def.node as unknown as EsTreeNode) === declarator),
  );

const isUseContextLocal = (ref: Reference): boolean =>
  Boolean(
    ref.resolved?.defs.some((def) => {
      const node = def.node as unknown as EsTreeNode;
      if (!isNodeOfType(node, "VariableDeclarator")) return false;
      if (!isNodeOfType(node.init, "CallExpression")) return false;
      const callee = node.init.callee;
      if (isNodeOfType(callee, "Identifier")) return callee.name === "useContext";
      return (
        isNodeOfType(callee, "MemberExpression") &&
        isNodeOfType(callee.property, "Identifier") &&
        callee.property.name === "useContext"
      );
    }),
  );

const isPlainValueReadExpression = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "Identifier")) return true;
  if (isNodeOfType(node, "MemberExpression")) {
    if (node.computed && !isNodeOfType(node.property, "Literal")) return false;
    return isPlainValueReadExpression(node.object as EsTreeNode);
  }
  return false;
};

// `setMirror(someProp)` / `setMirror(props.value)` — the sole argument is
// an untransformed read of an existing value. The canonical mirror
// positive from react.dev's "you might not need an effect": even when
// handlers also write the state, the whole-value verbatim copy is
// derivable by definition, so the report stands.
const isWholeValueMirrorArgument = (callExpr: EsTreeNode): boolean => {
  if (!isNodeOfType(callExpr, "CallExpression")) return false;
  const args = callExpr.arguments ?? [];
  if (args.length !== 1) return false;
  return isPlainValueReadExpression(args[0] as EsTreeNode);
};

const collectEarlyReturnGuardTests = (
  block: EsTreeNode,
  beforeStatement: EsTreeNode,
): EsTreeNode[] => {
  const tests: EsTreeNode[] = [];
  if (!isNodeOfType(block, "BlockStatement")) return tests;
  for (const statement of block.body ?? []) {
    if ((statement as unknown as EsTreeNode) === beforeStatement) break;
    if (!isNodeOfType(statement, "IfStatement")) continue;
    const consequent = statement.consequent;
    const isEarlyReturn =
      isNodeOfType(consequent, "ReturnStatement") ||
      (isNodeOfType(consequent, "BlockStatement") &&
        (consequent.body ?? []).some((inner) => isNodeOfType(inner, "ReturnStatement")));
    if (isEarlyReturn) tests.push(statement.test as EsTreeNode);
  }
  return tests;
};

const collectGuardTestsOnPath = (callExpr: EsTreeNode, effectFn: EsTreeNode): EsTreeNode[] => {
  const guardTests: EsTreeNode[] = [];
  let child: EsTreeNode = callExpr;
  let parent: EsTreeNode | null | undefined = callExpr.parent;
  while (parent && child !== effectFn) {
    if (isNodeOfType(parent, "IfStatement") && (parent.test as unknown as EsTreeNode) !== child) {
      guardTests.push(parent.test as EsTreeNode);
    } else if (
      isNodeOfType(parent, "ConditionalExpression") &&
      (parent.test as unknown as EsTreeNode) !== child
    ) {
      guardTests.push(parent.test as EsTreeNode);
    } else if (
      isNodeOfType(parent, "LogicalExpression") &&
      (parent.right as unknown as EsTreeNode) === child
    ) {
      guardTests.push(parent.left as EsTreeNode);
    } else if (isNodeOfType(parent, "BlockStatement")) {
      guardTests.push(...collectEarlyReturnGuardTests(parent, child));
    }
    child = parent;
    parent = parent.parent ?? null;
  }
  return guardTests;
};

// A guard reading the WRITTEN state marks a state-conditioned write —
// the `if (!items.some((item) => item.id === selectedId)) setSelectedId(first)`
// fallback shape. That write IS replaceable by a render-time derivation
// (`isValid ? selected : fallback`), so it stays reported even when the
// state has independent user-input writers. Guards reading OTHER state
// (`if (!isEditing) setValue(data)`) condition the re-sync on a mode flag —
// the edit-buffer idiom the docs-validation pass confirmed as FP.
const someGuardReadsWrittenState = (
  analysis: ProgramAnalysis,
  guardTests: ReadonlyArray<EsTreeNode>,
  writtenStateDecl: EsTreeNode | null,
): boolean =>
  guardTests.some((test) =>
    getDownstreamRefs(analysis, test).some((testRef) =>
      getUpstreamRefs(analysis, testRef).some(
        (upRef) => isState(analysis, upRef) && refResolvesToDeclarator(upRef, writtenStateDecl),
      ),
    ),
  );

// The whole-value carve-out below exists for the canonical PROP mirror.
// When the copied value is itself ANOTHER live useState value (seeding
// keyboard-highlight state from the selection on an open transition) or
// derives from useContext (preserving accordion state as memory), the
// parent-owned-value premise does not hold, so the carve-out is waived
// and the user-writer exemption may apply.
const copiesOtherStateOrContextValue = (
  analysis: ProgramAnalysis,
  callExpr: EsTreeNode,
  writtenStateDecl: EsTreeNode | null,
): boolean => {
  if (!isNodeOfType(callExpr, "CallExpression")) return false;
  const argument = callExpr.arguments?.[0];
  if (!argument) return false;
  for (const argRef of getDownstreamRefs(analysis, argument as EsTreeNode)) {
    // Direct read of another useState value — not a transitive derivation
    // through a useMemo local, which is still the mirror TP shape.
    if (isState(analysis, argRef) && !refResolvesToDeclarator(argRef, writtenStateDecl)) {
      return true;
    }
    for (const upRef of getUpstreamRefs(analysis, argRef)) {
      if (isUseContextLocal(upRef)) return true;
    }
  }
  return false;
};

// The effect consumes an event carried in state: the flagged setter's
// argument derives from state X, and the SAME effect synchronously resets
// X through its own setter. X is transient (cleared each pass, e.g. a
// screen-reader announcement queue), so no render-time derivation could
// read it — a state-machine step, not derived state.
const effectResetsArgumentSourceState = (
  analysis: ProgramAnalysis,
  effectFnRefs: ReadonlyArray<Reference>,
  effectFn: EsTreeNode,
  flaggedRef: Reference,
  argsUpstreamRefs: ReadonlyArray<Reference>,
): boolean => {
  const sourceStateDecls = new Set<EsTreeNode>();
  for (const argRef of argsUpstreamRefs) {
    if (!isState(analysis, argRef)) continue;
    for (const def of argRef.resolved?.defs ?? []) {
      sourceStateDecls.add(def.node as unknown as EsTreeNode);
    }
  }
  if (sourceStateDecls.size === 0) return false;
  for (const otherRef of effectFnRefs) {
    if (otherRef === flaggedRef) continue;
    if (!isSyncStateSetterCall(analysis, otherRef, effectFn)) continue;
    const otherDecl = getUseStateDecl(analysis, otherRef);
    if (otherDecl && sourceStateDecls.has(otherDecl)) return true;
  }
  return false;
};

// A setter with any reference outside this effect (a handler call, a
// subscription callback, the setter passed as a value) is not "only set
// here" — the second diagnostic's premise. `countSetterCallSites` only
// sees call parents, so `onDraftChange={setDraft}` slipped through.
const hasReferenceOutsideEffect = (ref: Reference, effectNode: EsTreeNode): boolean => {
  if (!ref.resolved) return false;
  const effectRange = (effectNode as unknown as { range?: [number, number] }).range;
  if (!effectRange) return false;
  for (const reference of ref.resolved.references) {
    if (reference.init) continue;
    const identifier = reference.identifier as unknown as { range?: [number, number] };
    if (!identifier.range) continue;
    const isInsideEffect =
      effectRange[0] <= identifier.range[0] && identifier.range[1] <= effectRange[1];
    if (!isInsideEffect) return true;
  }
  return false;
};

export const noDerivedState = defineRule({
  id: "no-derived-state",
  title: "Derived value copied into state",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Work out the value while rendering (or with useMemo if it's expensive) instead of copying it into useState through a useEffect. See https://react.dev/learn/you-might-not-need-an-effect#updating-state-based-on-props-or-state",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isUseEffect(node)) return;
      const analysis = getProgramAnalysis(node);
      if (!analysis) return;
      if (hasCleanup(analysis, node)) return;
      const effectFnRefs = getEffectFnRefs(analysis, node);
      const depsRefs = getEffectDepsRefs(analysis, node);
      if (!effectFnRefs || !depsRefs) return;
      const effectFn = getEffectFn(analysis, node);
      if (!effectFn) return;

      for (const ref of effectFnRefs) {
        if (!isSyncStateSetterCall(analysis, ref, effectFn)) continue;

        const callExpr = getCallExpr(ref);
        if (!callExpr) continue;
        // A value measured from the DOM / a ref / a browser global can't be
        // "worked out while rendering" — the element isn't mounted yet. This
        // is a deferred measurement, not a derived value copied into state.
        // The measurement often flows through an effect-local first
        // (`const { width } = ref.current.getBoundingClientRect()`).
        if (readsPostMountValueThroughLocals(callExpr, effectFn)) continue;
        const useStateNode = getUseStateDecl(analysis, ref);
        const stateName = getStateNameForUseStateDecl(useStateNode) ?? "<state>";

        const argsUpstreamRefs = getSetterArgsUpstreamRefs(analysis, ref);
        const depsUpstreamRefs: Reference[] = depsRefs.flatMap((depRef) =>
          getUpstreamRefs(analysis, depRef),
        );

        // Initial-only / default / seed prop pattern. When the
        // setter receives EXACTLY one arg that IS a bare prop
        // identifier whose name signals init-only intent
        // (`initialValue`, `defaultX`, `seedY`, etc.), the consumer
        // is intentionally re-syncing on a controlled-init prop —
        // `useState(initialValue) + useEffect(() => setX(initialValue), [initialValue])`
        // to rebind on explicit "reset". Strict shape: avoids
        // `.every([]) === true` and AST-shape false-positives.
        if (isInitialOnlySetterCall(callExpr)) continue;

        // Controlled/uncontrolled value mirror: a bare-prop setter argument
        // whose setter is wired into a JSX event-handler attribute
        // (`onChange={setValue}` / `onChange={(e) => setValue(e.target.value)}`).
        // See `is-controlled-prop-mirror.ts` for the full discriminator.
        if (isControlledPropMirror(node, callExpr)) continue;

        if (isAccumulatingFunctionalUpdater(analysis, callExpr)) continue;

        if (
          effectResetsArgumentSourceState(analysis, effectFnRefs, effectFn, ref, argsUpstreamRefs)
        ) {
          continue;
        }

        // User-editable state that a GUARDED effect merely re-syncs from
        // props on specific changes (edit-form drafts, keyboard-navigation
        // indexes, toggled selections): the state carries user input that
        // no render-time derivation could reproduce, so "derive it" is
        // wrong. Three derived-write shapes stay reported despite user
        // writers: the unguarded write (it clobbers the user's edits on
        // EVERY dep change — the classic mirror bug), the whole-value
        // PROP mirror, and the written-state-conditioned fallback
        // (`if (!isValid(selected)) setSelected(first)` — replaceable by a
        // render-time clamp). The user-writer lookup resolves through an
        // indirect call (`revertToData()` whose body does the setState) via
        // the upstream setter reference.
        const guardTestsOnPath = collectGuardTestsOnPath(callExpr, effectFn);
        const upstreamSetterRef =
          getUpstreamRefs(analysis, ref).find((upRef) => isStateSetter(analysis, upRef)) ?? null;
        if (
          guardTestsOnPath.length > 0 &&
          upstreamSetterRef !== null &&
          hasUserInputSetterWriter(upstreamSetterRef, node, true) &&
          (!isWholeValueMirrorArgument(callExpr) ||
            copiesOtherStateOrContextValue(analysis, callExpr, useStateNode)) &&
          !someGuardReadsWrittenState(analysis, guardTestsOnPath, useStateNode)
        ) {
          continue;
        }

        const isSomeArgsInternal = argsUpstreamRefs.some(
          (argRef) => isState(analysis, argRef) || isProp(analysis, argRef),
        );

        const isAllArgsInDeps =
          argsUpstreamRefs.length > 0 &&
          argsUpstreamRefs.every((argRef) =>
            depsUpstreamRefs.some((depRef) => argRef.resolved === depRef.resolved),
          );
        const isValueAlwaysInSync =
          isAllArgsInDeps &&
          countSetterCallSites(ref) === 1 &&
          !hasReferenceOutsideEffect(ref, node);

        if (isSomeArgsInternal) {
          context.report({
            node: callExpr,
            message: `Storing "${stateName}" in state when you can derive it from other values costs an extra render.`,
          });
        } else if (isValueAlwaysInSync) {
          context.report({
            node: callExpr,
            message: `"${stateName}" is only set here from other values, so storing it costs an extra render.`,
          });
        }
      }
    },
  }),
});

// `setX(initialValue)` — sole argument is a bare identifier whose name
// signals the consumer's controlled-init / reset intent.
const isInitialOnlySetterCall = (callExpr: EsTreeNode): boolean => {
  if (!isNodeOfType(callExpr, "CallExpression")) return false;
  const args = callExpr.arguments ?? [];
  if (args.length !== 1) return false;
  const arg = args[0] as EsTreeNode;
  if (!isNodeOfType(arg, "Identifier")) return false;
  return isInitialOnlyPropName(arg.name);
};
