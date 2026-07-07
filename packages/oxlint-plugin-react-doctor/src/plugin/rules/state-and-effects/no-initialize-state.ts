import type { Reference } from "eslint-scope";
import { containsNonDeterministicSource } from "../../utils/contains-non-deterministic-source.js";
import { defineRule } from "../../utils/define-rule.js";
import { getFunctionBindingName } from "../../utils/get-function-binding-name.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import {
  DOM_QUERY_MEMBER_NAMES,
  isMeasurementMemberRead,
  isPostMountGlobalRead,
} from "../../utils/reads-post-mount-value.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { getCallExpr, getRef, isSynchronous, resolveToFunction } from "./utils/effect/ast.js";
import { getProgramAnalysis, type ProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import {
  getEffectDepsRefs,
  getEffectFn,
  getEffectFnRefs,
  getUseStateDecl,
  isStateSetter,
  isSyncStateSetterCall,
  isUseEffect,
} from "./utils/effect/react.js";

// Storage globals (`localStorage.getItem(...)` → setter) are deliberately NOT
// measurement sources: a storage-seeded init is still the init-in-an-effect
// smell (the read is synchronous and cheap), whereas a DOM/layout measurement
// genuinely cannot exist before mount.
const MEASUREMENT_GLOBAL_NAMES: ReadonlySet<string> = new Set(["window", "document", "navigator"]);

const objectPatternBindsName = (pattern: EsTreeNode, name: string): boolean => {
  if (!isNodeOfType(pattern, "ObjectPattern")) return false;
  return (pattern.properties ?? []).some((property) => {
    if (!isNodeOfType(property, "Property")) return false;
    const bound = property.value;
    return Boolean(bound && isNodeOfType(bound, "Identifier") && bound.name === name);
  });
};

const findEffectLocalInitializer = (effectFn: EsTreeNode, name: string): EsTreeNode | null => {
  let initializer: EsTreeNode | null = null;
  walkAst(effectFn, (child: EsTreeNode): boolean | void => {
    if (initializer) return false;
    if (!isNodeOfType(child, "VariableDeclarator") || !child.init) return;
    if (
      (isNodeOfType(child.id, "Identifier") && child.id.name === name) ||
      // `const { scrollWidth, clientWidth } = breadcrumbsRef.current;` —
      // a destructured measurement read carries the same post-mount source.
      objectPatternBindsName(child.id as EsTreeNode, name)
    ) {
      initializer = child.init as EsTreeNode;
      return false;
    }
  });
  return initializer;
};

// A measurement-global identifier defers state init when it feeds a DOM API
// CALL (`window.matchMedia(...)`) or a VALUE property read
// (`window.innerWidth`, `window.location.pathname`, `document.documentElement`):
// both differ between server and client, so hoisting them into a
// `useState(initial)` breaks SSR hydration — the doc's named FP carve-out,
// whose dedicated fix is useSyncExternalStore, not lazy useState. A bare
// uninvoked method REFERENCE (`!!window.matchMedia`) is feature detection,
// not a value read, so it keeps the init-in-an-effect smell.
const isMeasurementGlobalValueRead = (identifier: EsTreeNode): boolean => {
  const memberParent = identifier.parent;
  if (!isNodeOfType(memberParent, "MemberExpression") || memberParent.object !== identifier) {
    return false;
  }
  if (
    isNodeOfType(memberParent.property, "Identifier") &&
    DOM_QUERY_MEMBER_NAMES.has(memberParent.property.name)
  ) {
    const callGrandparent = memberParent.parent;
    return Boolean(
      callGrandparent &&
      isNodeOfType(callGrandparent, "CallExpression") &&
      callGrandparent.callee === memberParent,
    );
  }
  return true;
};

// Does the setter argument derive from a DOM/layout measurement — directly
// (`setShowThumb(viewportRef.current.scrollHeight > 0)`) or through an
// effect-local variable (`const mq = window.matchMedia(...); setMode(mq.matches
// ? "dark" : "light")`)? Such values can't be hoisted into `useState(initial)`
// (the element isn't mounted; the API object has no render-time equivalent),
// so the mount effect is the correct home for them.
const argumentReadsPostMountMeasurement = (
  argument: EsTreeNode,
  effectFn: EsTreeNode,
  visitedLocalNames: Set<string> = new Set(),
): boolean => {
  let found = false;
  walkAst(argument, (child: EsTreeNode): boolean | void => {
    if (found) return false;
    if (isMeasurementMemberRead(child)) {
      found = true;
      return false;
    }
    if (!isNodeOfType(child, "Identifier")) return;
    if (
      isPostMountGlobalRead(child) &&
      MEASUREMENT_GLOBAL_NAMES.has(child.name) &&
      isMeasurementGlobalValueRead(child)
    ) {
      found = true;
      return false;
    }
    if (visitedLocalNames.has(child.name)) return;
    visitedLocalNames.add(child.name);
    const localInitializer = findEffectLocalInitializer(effectFn, child.name);
    if (
      localInitializer &&
      argumentReadsPostMountMeasurement(localInitializer, effectFn, visitedLocalNames)
    ) {
      found = true;
      return false;
    }
  });
  return found;
};

// A resource is something constructed at runtime (`new AudioContext()`,
// `navigator.mediaDevices.getUserMedia()`); plain data initializers
// (literals, object/array expressions) are hoistable and never need a
// dispose slot.
const isResourceLikeInitializer = (initializer: EsTreeNode): boolean => {
  if (isNodeOfType(initializer, "AwaitExpression")) {
    return isResourceLikeInitializer(initializer.argument as EsTreeNode);
  }
  return isNodeOfType(initializer, "NewExpression") || isNodeOfType(initializer, "CallExpression");
};

// Effect-local names that (transitively) produce the setter argument:
// `const audioContext = new AudioContext(); setGainNode(audioContext.createGain())`
// yields { audioContext }.
const collectArgumentSourceLocalNames = (
  argument: EsTreeNode,
  effectFn: EsTreeNode,
  sourceLocalNames: Set<string> = new Set(),
): Set<string> => {
  walkAst(argument, (child: EsTreeNode): void => {
    if (!isNodeOfType(child, "Identifier")) return;
    if (sourceLocalNames.has(child.name)) return;
    const localInitializer = findEffectLocalInitializer(effectFn, child.name);
    if (!localInitializer || !isResourceLikeInitializer(localInitializer)) return;
    sourceLocalNames.add(child.name);
    collectArgumentSourceLocalNames(localInitializer, effectFn, sourceLocalNames);
  });
  return sourceLocalNames;
};

const isFunctionExpressionLike = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "ArrowFunctionExpression") || isNodeOfType(node, "FunctionExpression");

const findCleanupFunction = (effectFn: EsTreeNode): EsTreeNode | null => {
  if (
    !isNodeOfType(effectFn, "ArrowFunctionExpression") &&
    !isNodeOfType(effectFn, "FunctionExpression")
  ) {
    return null;
  }
  const body = effectFn.body;
  if (!isNodeOfType(body, "BlockStatement")) return null;
  let cleanupFunction: EsTreeNode | null = null;
  walkAst(body, (child: EsTreeNode): boolean | void => {
    if (cleanupFunction) return false;
    if (isNodeOfType(child, "ReturnStatement")) {
      if (child.argument && isFunctionExpressionLike(child.argument as EsTreeNode)) {
        cleanupFunction = child.argument as EsTreeNode;
      }
      return false;
    }
    if (child !== body && isFunctionExpressionLike(child)) return false;
    if (isNodeOfType(child, "FunctionDeclaration")) return false;
  });
  return cleanupFunction;
};

// A mount effect whose CLEANUP disposes the very resource feeding the setter
// (`const audioContext = new AudioContext(); setGainNode(audioContext.createGain());
// return () => audioContext.close();`) owns a resource lifecycle — the value
// cannot be hoisted into `useState(initial)` because render has no matching
// dispose slot, so the effect is the correct home for the init.
const cleanupDisposesArgumentSource = (argument: EsTreeNode, effectFn: EsTreeNode): boolean => {
  const cleanupFunction = findCleanupFunction(effectFn);
  if (!cleanupFunction) return false;
  const sourceLocalNames = collectArgumentSourceLocalNames(argument, effectFn);
  if (sourceLocalNames.size === 0) return false;
  let referencesSource = false;
  walkAst(cleanupFunction, (child: EsTreeNode): boolean | void => {
    if (referencesSource) return false;
    if (isNodeOfType(child, "Identifier") && sourceLocalNames.has(child.name)) {
      referencesSource = true;
      return false;
    }
  });
  return referencesSource;
};

// `useEffect(() => { setMounted(true); return () => setMounted(false); }, [])`
// — the cleanup resets the very state the effect sets, so the effect owns the
// state's mount/unmount lifecycle (the SSR-safe portal `mounted` flag).
// Lazy-initializing the mounted value would break hydration: it must differ
// between the server render and the post-mount client state.
const cleanupResetsSameSetter = (effectFn: EsTreeNode, setterName: string): boolean => {
  const cleanupFunction = findCleanupFunction(effectFn);
  if (!cleanupFunction) return false;
  let resets = false;
  walkAst(cleanupFunction, (child: EsTreeNode): boolean | void => {
    if (resets) return false;
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "Identifier") &&
      child.callee.name === setterName
    ) {
      resets = true;
      return false;
    }
  });
  return resets;
};

const TYPEOF_BROWSER_GLOBAL_NAMES: ReadonlySet<string> = new Set(["window", "document"]);

// `useState(typeof document !== "undefined")` /
// `useState(() => typeof window === "undefined" ? fallback : window.innerWidth)`
// — a typeof-browser-global initializer is the SSR-hydration seed: the value
// deliberately differs between server and client, and the mount effect is the
// hydration completion step, not a hoistable init (doc's SSR carve-out).
const initializerHasTypeofBrowserGlobalCheck = (useStateDecl: EsTreeNode): boolean => {
  if (!isNodeOfType(useStateDecl, "VariableDeclarator")) return false;
  if (!isNodeOfType(useStateDecl.init, "CallExpression")) return false;
  const initialArgument = useStateDecl.init.arguments?.[0];
  if (!initialArgument) return false;
  let found = false;
  walkAst(initialArgument as EsTreeNode, (child: EsTreeNode): boolean | void => {
    if (found) return false;
    if (
      isNodeOfType(child, "UnaryExpression") &&
      child.operator === "typeof" &&
      isNodeOfType(child.argument, "Identifier") &&
      TYPEOF_BROWSER_GLOBAL_NAMES.has(child.argument.name)
    ) {
      found = true;
      return false;
    }
  });
  return found;
};

const HANDLER_HELPER_NAME_PATTERN = /^(on|handle)[A-Z_]/;

const isSameValueExpression = (leftNode: EsTreeNode, rightNode: EsTreeNode): boolean => {
  const left = stripParenExpression(leftNode);
  const right = stripParenExpression(rightNode);
  if (left.type !== right.type) return false;
  if (isNodeOfType(left, "Identifier") && isNodeOfType(right, "Identifier")) {
    return left.name === right.name;
  }
  if (isNodeOfType(left, "Literal") && isNodeOfType(right, "Literal")) {
    return left.value === right.value;
  }
  if (isNodeOfType(left, "MemberExpression") && isNodeOfType(right, "MemberExpression")) {
    if (left.computed !== right.computed) return false;
    return (
      isSameValueExpression(left.property as EsTreeNode, right.property as EsTreeNode) &&
      isSameValueExpression(left.object as EsTreeNode, right.object as EsTreeNode)
    );
  }
  if (isNodeOfType(left, "CallExpression") && isNodeOfType(right, "CallExpression")) {
    const leftArguments = left.arguments ?? [];
    const rightArguments = right.arguments ?? [];
    if (leftArguments.length !== rightArguments.length) return false;
    if (!isSameValueExpression(left.callee as EsTreeNode, right.callee as EsTreeNode)) {
      return false;
    }
    return leftArguments.every((leftArgument, argumentIndex) =>
      isSameValueExpression(
        leftArgument as EsTreeNode,
        rightArguments[argumentIndex] as EsTreeNode,
      ),
    );
  }
  if (isNodeOfType(left, "UnaryExpression") && isNodeOfType(right, "UnaryExpression")) {
    return (
      left.operator === right.operator &&
      isSameValueExpression(left.argument as EsTreeNode, right.argument as EsTreeNode)
    );
  }
  return false;
};

const unwrapLazyInitializer = (initializer: EsTreeNode): EsTreeNode => {
  if (!isNodeOfType(initializer, "ArrowFunctionExpression")) return initializer;
  const body = initializer.body;
  if (!isNodeOfType(body, "BlockStatement")) return body as EsTreeNode;
  const statements = body.body ?? [];
  if (statements.length === 1 && isNodeOfType(statements[0], "ReturnStatement")) {
    const returned = statements[0].argument;
    if (returned) return returned as EsTreeNode;
  }
  return initializer;
};

// Every value the state can start as: the `useState` argument itself plus,
// for `useState(a ?? b)` / `useState(a || b)`, each operand.
const collectInitializerValueExpressions = (useStateDecl: EsTreeNode): EsTreeNode[] => {
  if (!isNodeOfType(useStateDecl, "VariableDeclarator")) return [];
  if (!isNodeOfType(useStateDecl.init, "CallExpression")) return [];
  const initialArgument = useStateDecl.init.arguments?.[0];
  if (!initialArgument) return [];
  const expressions: EsTreeNode[] = [];
  const expand = (node: EsTreeNode): void => {
    expressions.push(node);
    if (
      isNodeOfType(node, "LogicalExpression") &&
      (node.operator === "??" || node.operator === "||")
    ) {
      expand(node.left as EsTreeNode);
      expand(node.right as EsTreeNode);
    }
  };
  expand(unwrapLazyInitializer(initialArgument as EsTreeNode));
  return expressions;
};

const isUseStateWithoutArgument = (useStateDecl: EsTreeNode): boolean =>
  isNodeOfType(useStateDecl, "VariableDeclarator") &&
  isNodeOfType(useStateDecl.init, "CallExpression") &&
  (useStateDecl.init.arguments ?? []).length === 0;

const isUndefinedExpression = (node: EsTreeNode): boolean => {
  const unwrapped = stripParenExpression(node);
  if (isNodeOfType(unwrapped, "Identifier")) return unwrapped.name === "undefined";
  return isNodeOfType(unwrapped, "UnaryExpression") && unwrapped.operator === "void";
};

// `useState(socket.connected)` + `setConnected(socket.connected)` — the
// mount effect rewrites the value the state already starts as (React
// bails out or renders the same output), so there is no "extra render
// with an empty value" to report. Common in subscribe-then-resync and
// `useState(initialValue ?? '')` + `setValue(initialValue)` shapes.
const isSameValueAsInitializer = (callExpr: EsTreeNode, useStateDecl: EsTreeNode): boolean => {
  if (!isNodeOfType(callExpr, "CallExpression")) return false;
  const args = callExpr.arguments ?? [];
  if (args.length !== 1) return false;
  const setterArgument = args[0] as EsTreeNode;
  if (isUseStateWithoutArgument(useStateDecl) && isUndefinedExpression(setterArgument)) {
    return true;
  }
  return collectInitializerValueExpressions(useStateDecl).some((initializerValue) =>
    isSameValueExpression(setterArgument, initializerValue),
  );
};

interface InnerSetterCall {
  ref: Reference;
  callExpr: EsTreeNode;
  isSyncWithinFunction: boolean;
}

// State-setter calls inside a helper function the mount effect invokes
// (`const updateWidth = () => setTrackWidth(track.clientWidth); updateWidth();`).
// The outer call's argument list is empty, so the measurement /
// non-determinism guards must inspect the INNER setter calls instead.
const collectInnerStateSetterCalls = (
  analysis: ProgramAnalysis,
  helperFn: EsTreeNode,
): InnerSetterCall[] => {
  const innerCalls: InnerSetterCall[] = [];
  const helperBody = (helperFn as unknown as { body?: EsTreeNode }).body;
  if (!helperBody) return innerCalls;
  walkAst(helperBody, (child: EsTreeNode): void => {
    if (!isNodeOfType(child, "Identifier")) return;
    const innerRef = getRef(analysis, child);
    if (!innerRef || !isStateSetter(analysis, innerRef)) return;
    const innerCallExpr = getCallExpr(innerRef);
    if (!innerCallExpr) return;
    innerCalls.push({
      ref: innerRef,
      callExpr: innerCallExpr,
      isSyncWithinFunction: isSynchronous(child, helperFn),
    });
  });
  return innerCalls;
};

const isNodeWithinRange = (inner: EsTreeNode, outer: EsTreeNode): boolean => {
  const innerRange = (inner as unknown as { range?: [number, number] }).range;
  const outerRange = (outer as unknown as { range?: [number, number] }).range;
  if (!innerRange || !outerRange) return false;
  return outerRange[0] <= innerRange[0] && innerRange[1] <= outerRange[1];
};

// 1:1 port of upstream `src/rules/no-initialize-state.js`.
// Difference vs upstream: upstream uses `context.sourceCode.getText`
// for the diagnostic's "arguments" field; we use
// `stringifyExpressionSnippet` since oxlint plugins don't expose
// source text. Output text matches upstream byte-for-byte on the
// canonical literal / identifier / call shapes; falls back to
// `<expression>` for complex inputs.

export const noInitializeState = defineRule({
  id: "no-initialize-state",
  title: "State initialized from a mount effect",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Pass the initial value directly to useState() instead of setting it from a mount-only useEffect. For SSR hydration, prefer useSyncExternalStore().",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isUseEffect(node)) return;
      const analysis = getProgramAnalysis(node);
      if (!analysis) return;
      const effectFnRefs = getEffectFnRefs(analysis, node);
      const depsRefs = getEffectDepsRefs(analysis, node);
      if (!effectFnRefs || !depsRefs) return;
      const effectFn = getEffectFn(analysis, node);
      if (!effectFn) return;

      const isEffectRunOnlyOnMount =
        depsRefs.filter((ref) => !isStateSetter(analysis, ref)).length === 0;
      if (!isEffectRunOnlyOnMount) return;

      for (const ref of effectFnRefs) {
        if (!isSyncStateSetterCall(analysis, ref, effectFn)) continue;
        const callExpr = getCallExpr(ref);
        if (!callExpr || !isNodeOfType(callExpr, "CallExpression")) continue;
        // A non-deterministic source (`crypto.randomUUID()`, `Math.random()`,
        // `Date.now()`, an id generator, …) can't be a deterministic
        // `useState(initial)` argument and is SSR-unsafe, so deferring it to a
        // mount effect is the correct pattern, not an init smell.
        if (
          callExpr.arguments?.some(
            (argument) => Boolean(argument) && containsNonDeterministicSource(argument),
          )
        ) {
          continue;
        }
        if (
          callExpr.arguments?.some(
            (argument) =>
              Boolean(argument) && argumentReadsPostMountMeasurement(argument, effectFn),
          )
        ) {
          continue;
        }
        if (
          callExpr.arguments?.some(
            (argument) => Boolean(argument) && cleanupDisposesArgumentSource(argument, effectFn),
          )
        ) {
          continue;
        }
        // An INDIRECT setter call (`updateWidth()` where updateWidth's body
        // does the setState) hides the real arguments from the guards above.
        // Re-run them against the inner setter calls: skip when every
        // synchronous inner write is measurement/non-deterministic-exempt,
        // and skip entirely when the helper only writes state from async
        // continuations (`fetch().then(setX)`) — that is data loading, not a
        // hoistable initial value.
        if (!isStateSetter(analysis, ref)) {
          const helperFn = resolveToFunction(ref);
          // Calling an event-handler-named component function at mount
          // (`if (defaultIsOpen) handleShow(true)`) triggers an imperative
          // flow — show delays, DOM anchor queries — not a "load initial
          // value into state" init, so the lazy-useState fix cannot apply.
          if (helperFn) {
            const helperName = getFunctionBindingName(helperFn as unknown as EsTreeNode);
            if (helperName && HANDLER_HELPER_NAME_PATTERN.test(helperName)) continue;
          }
          if (helperFn) {
            const innerSetterCalls = collectInnerStateSetterCalls(
              analysis,
              helperFn as unknown as EsTreeNode,
            );
            if (innerSetterCalls.length > 0) {
              const syncInnerCalls = innerSetterCalls.filter(
                (innerCall) => innerCall.isSyncWithinFunction,
              );
              if (syncInnerCalls.length === 0) continue;
              const measurementLookupFn = isNodeWithinRange(
                helperFn as unknown as EsTreeNode,
                effectFn,
              )
                ? effectFn
                : (helperFn as unknown as EsTreeNode);
              const isEverySyncInnerCallExempt = syncInnerCalls.every((innerCall) => {
                if (!isNodeOfType(innerCall.callExpr, "CallExpression")) return false;
                const innerUseStateDecl = getUseStateDecl(analysis, innerCall.ref);
                if (
                  innerUseStateDecl &&
                  isSameValueAsInitializer(innerCall.callExpr, innerUseStateDecl)
                ) {
                  return true;
                }
                return (innerCall.callExpr.arguments ?? []).some(
                  (argument) =>
                    Boolean(argument) &&
                    (containsNonDeterministicSource(argument) ||
                      argumentReadsPostMountMeasurement(argument, measurementLookupFn)),
                );
              });
              if (isEverySyncInnerCallExempt) continue;
            }
          }
        }
        const useStateDecl = getUseStateDecl(analysis, ref);
        if (!useStateDecl || !isNodeOfType(useStateDecl, "VariableDeclarator")) continue;
        if (isSameValueAsInitializer(callExpr, useStateDecl)) continue;
        if (initializerHasTypeofBrowserGlobalCheck(useStateDecl)) continue;
        if (
          isNodeOfType(callExpr.callee, "Identifier") &&
          cleanupResetsSameSetter(effectFn, callExpr.callee.name)
        ) {
          continue;
        }
        if (!isNodeOfType(useStateDecl.id, "ArrayPattern")) continue;
        const elements = useStateDecl.id.elements ?? [];
        const stateBinding = elements[0] ?? elements[1];
        const stateName =
          stateBinding && isNodeOfType(stateBinding, "Identifier") ? stateBinding.name : "<state>";
        context.report({
          node: callExpr,
          message: `Your users see an extra render with empty "${stateName}" because a useEffect sets its starting value.`,
        });
      }
    },
  }),
});
