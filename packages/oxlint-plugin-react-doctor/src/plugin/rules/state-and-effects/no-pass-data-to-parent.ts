import type { Reference } from "eslint-scope";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNamespacedApiCallee } from "../../utils/is-namespaced-api-call.js";
import {
  DATA_SINK_METHOD_NAMES,
  STRING_READ_METHOD_NAMES,
} from "../../constants/data-sink-method-names.js";
import { getCallMethodName } from "../../utils/get-call-method-name.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import {
  getArgsUpstreamRefs,
  getCallExpr,
  getDownstreamRefs,
  getRef,
  getUpstreamRefs,
  isSynchronous,
  resolveToFunction,
} from "./utils/effect/ast.js";
import type { ProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import {
  getEffectFn,
  getEffectFnRefs,
  hasCleanup,
  isConstant,
  isCustomHookParameter,
  isProp,
  isRefCall,
  isRefCurrent,
  isUseEffect,
  isWholePropsObjectReference,
} from "./utils/effect/react.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

// 1:1 port of upstream `src/rules/no-pass-data-to-parent.js`, narrowed to
// DIRECT parent-callback call sites. The verification run showed the
// eventual-call chain walk (`isPropCall`) misidentifying local utilities as
// parent callbacks: `setValue` destructured from `useForm(...)`, wrapper
// functions that mention a prop somewhere in their body, and useState
// setters seeded from a prop. The rule now requires the callee itself to
// resolve to a prop — or to a plain re-binding of one — before reporting.

// Local mirror of upstream's inline `isUseState`/`isUseRef` checks
// that work on the *identifier* of an upstream ref (not on a ref).
const isUseStateIdentifier = (identifier: EsTreeNode): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  if (identifier.name === "useState") return true;
  const parent = (identifier as unknown as { parent?: EsTreeNode | null }).parent;
  if (
    parent &&
    isNodeOfType(parent, "MemberExpression") &&
    isNodeOfType(parent.object, "Identifier") &&
    parent.object.name === "React" &&
    isNodeOfType(parent.property, "Identifier") &&
    parent.property.name === "useState"
  ) {
    return true;
  }
  return false;
};

const isUseRefIdentifier = (identifier: EsTreeNode): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  if (identifier.name === "useRef") return true;
  const parent = (identifier as unknown as { parent?: EsTreeNode | null }).parent;
  if (
    parent &&
    isNodeOfType(parent, "MemberExpression") &&
    isNodeOfType(parent.object, "Identifier") &&
    parent.object.name === "React" &&
    isNodeOfType(parent.property, "Identifier") &&
    parent.property.name === "useRef"
  ) {
    return true;
  }
  return false;
};

// `fetchAllServiceMetrics(...)` / `loadMore()` / `dispatchAction(...)` props
// are commands ASKING the parent to do work, and `registerAccessors(...)` /
// `renderTile(ctx, ...)` props hand the parent an imperative API or draw
// into a context the child owns — none of them mirror data up (the redux
// `mapDispatchToProps` shape in particular is standard fetch-on-change
// dispatching; jaeger VirtualizedTraceView and freecut tiled-canvas were
// confirmed registration/draw false positives in the delta audit).
const COMMAND_PROP_NAME_PATTERN = /^(fetch|load|refetch|dispatch|register|render)([A-Z_]|$)/;

const SETTER_NAMED_PROP_PATTERN = /^set[A-Z]/;

const unwrapChainExpression = (node: EsTreeNode): EsTreeNode =>
  isNodeOfType(node, "ChainExpression") ? (node.expression as EsTreeNode) : node;

// Memoizing hooks that return the function they wrap: a binding like
// `const onToggle = useStableCallback((detail) => fireEvent(onChange, detail))`
// is a parent callback in a stable-identity coat, not a local utility.
const FUNCTION_WRAPPER_HOOK_NAMES: ReadonlySet<string> = new Set([
  "useCallback",
  "useMemo",
  "useEvent",
  "useEventCallback",
  "useEffectEvent",
  "useMemoizedFn",
  "useStableCallback",
  "useCallbackRef",
]);

const getWrapperHookWrappedFunction = (initializer: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(initializer, "CallExpression")) return null;
  const callee = initializer.callee;
  const calleeName = isNodeOfType(callee, "Identifier")
    ? callee.name
    : isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")
      ? callee.property.name
      : null;
  if (!calleeName || !FUNCTION_WRAPPER_HOOK_NAMES.has(calleeName)) return null;
  const wrapped = initializer.arguments?.[0] as EsTreeNode | undefined;
  if (!wrapped || !isFunctionLike(wrapped)) return null;
  return wrapped;
};

// A def whose node is the enclosing function (a Parameter) must not count
// as "resolves to a function": the BINDING holds a value, not a callable.
const hasParameterDef = (ref: Reference): boolean =>
  Boolean(ref.resolved?.defs.some((def) => def.type === "Parameter"));

const resolvesToFunctionBinding = (ref: Reference): boolean =>
  !hasParameterDef(ref) && Boolean(resolveToFunction(ref));

const HANDLER_NAMED_PROP_PATTERN = /^(on|handle)[A-Z]/;

// A wrapped body forwards to the parent only when it touches a
// handler-NAMED prop (`fire(onNavigationChange, detail)`) or invokes a prop
// outright. Merely READING data props (jaeger getAccessors builds an
// accessor object from props/refs) does not make the wrapper a parent
// callback.
const wrappedFunctionNotifiesParent = (
  analysis: ProgramAnalysis,
  wrappedFunction: EsTreeNode,
): boolean =>
  getDownstreamRefs(analysis, wrappedFunction).some((innerRef) => {
    if (!isProp(analysis, innerRef)) return false;
    const innerIdentifier = innerRef.identifier as unknown as EsTreeNode;
    if (
      isNodeOfType(innerIdentifier, "Identifier") &&
      HANDLER_NAMED_PROP_PATTERN.test(innerIdentifier.name)
    ) {
      return true;
    }
    const innerParent = (innerIdentifier as unknown as { parent?: EsTreeNode | null }).parent;
    return Boolean(
      innerParent &&
      isNodeOfType(innerParent, "CallExpression") &&
      innerParent.callee === (innerIdentifier as unknown as typeof innerParent.callee),
    );
  });

// A parent callback is the prop itself (`onChange(...)`), a plain
// re-binding of one (`const { onChange } = props`, `const cb =
// props.onChange`), or a SYNC function-wrapper-hook binding whose wrapped
// callback notifies a prop (`useStableCallback(() => fire(onChange, x))` —
// the cloudscape classic.tsx shape the delta audit flagged as lost recall).
// A binding produced by CALLING anything else (`const { setValue } =
// useForm({ defaultValues: props.initial })`) is a local utility, no
// matter how many props appear in the call.
const isDirectParentCallbackRef = (analysis: ProgramAnalysis, ref: Reference): boolean => {
  if (isProp(analysis, ref)) return true;
  return Boolean(
    ref.resolved?.defs.some((def) => {
      const node = def.node as unknown as EsTreeNode;
      if (!isNodeOfType(node, "VariableDeclarator") || !node.init) return false;
      const initializer = unwrapChainExpression(node.init as EsTreeNode);
      const wrappedFunction = getWrapperHookWrappedFunction(initializer);
      if (wrappedFunction) {
        if ((wrappedFunction as { async?: boolean }).async) return false;
        return wrappedFunctionNotifiesParent(analysis, wrappedFunction);
      }
      if (
        !isNodeOfType(initializer, "Identifier") &&
        !isNodeOfType(initializer, "MemberExpression")
      ) {
        return false;
      }
      return getDownstreamRefs(analysis, initializer).some((initializerRef) =>
        getUpstreamRefs(analysis, initializerRef).some((upstreamRef) =>
          isProp(analysis, upstreamRef),
        ),
      );
    }),
  );
};

// The wrapper hides the data hand-off inside the wrapped body
// (`fireNonCancelableEvent(onNavigationChange, { open: isOpen })`), so the
// direct call's arguments alone can be all-literal; scan the call-chain
// arguments the way the pre-narrowing rule did.
const isWrapperHookCallbackRef = (analysis: ProgramAnalysis, ref: Reference): boolean =>
  Boolean(
    ref.resolved?.defs.some((def) => {
      const node = def.node as unknown as EsTreeNode;
      if (!isNodeOfType(node, "VariableDeclarator") || !node.init) return false;
      return getWrapperHookWrappedFunction(unwrapChainExpression(node.init as EsTreeNode)) !== null;
    }),
  );

// `onZoomHandlersReady({ handleZoomIn, handleZoomOut })` — an object whose
// every property is a function hands the parent an imperative API bag
// (a useImperativeHandle equivalent), not data mirrored up (freecut
// timeline-content, confirmed in the delta audit).
const isHandlerBagArgument = (analysis: ProgramAnalysis, argument: EsTreeNode): boolean => {
  if (!isNodeOfType(argument, "ObjectExpression")) return false;
  const properties = argument.properties ?? [];
  if (properties.length === 0) return false;
  return properties.every((property) => {
    if (!isNodeOfType(property, "Property")) return false;
    const value = property.value as EsTreeNode;
    if (isFunctionLike(value)) return true;
    if (isNodeOfType(value, "Identifier")) {
      const valueRef = getRef(analysis, value);
      return Boolean(valueRef && resolveToFunction(valueRef));
    }
    return false;
  });
};

// A functional updater handed to a setter-named prop (`setConfig((prev) =>
// ({ ...prev, secret: generate() }))`) is a payload PRODUCER, not a callback
// registered for later — its body must be scanned for child-generated data
// (bulwarkmail SecurityStep, a delta-audit recall regression). The updater's
// own parameters carry the parent's existing value back in, so they are not
// data the child produced.
const getFunctionalUpdaterDataRefs = (
  analysis: ProgramAnalysis,
  updater: EsTreeNode,
): Reference[] =>
  getDownstreamRefs(analysis, updater).filter(
    (updaterRef) =>
      !updaterRef.resolved?.defs.some(
        (def) => def.type === "Parameter" && (def.node as unknown) === (updater as unknown),
      ),
  );

const HOOK_NAME_PATTERN = /^use[A-Z0-9]/;

// A value produced by a custom hook that is itself WIRED TO the component's
// props (`useMarqueeSelection({ containerRef, onSelectionChange, ... })`)
// is hook-owned interaction state the component merely bridges up — the
// parent already participates through the callbacks it passed down, so the
// effect is the only bridge left (freecut TimelineMarqueeLayer, delta
// audit). A bare hook call (`useSomeAPI()`) stays data: the parent could
// call the hook itself.
const isParentWiredHookResultRef = (analysis: ProgramAnalysis, ref: Reference): boolean =>
  Boolean(
    ref.resolved?.defs.some((def) => {
      const node = def.node as unknown as EsTreeNode;
      if (!isNodeOfType(node, "VariableDeclarator") || !node.init) return false;
      const init = unwrapChainExpression(node.init as EsTreeNode);
      if (!isNodeOfType(init, "CallExpression")) return false;
      const callee = init.callee;
      if (!isNodeOfType(callee, "Identifier") || !HOOK_NAME_PATTERN.test(callee.name)) {
        return false;
      }
      return (init.arguments ?? []).some((hookArgument) =>
        getDownstreamRefs(analysis, hookArgument as EsTreeNode).some((downstreamRef) =>
          isProp(analysis, downstreamRef),
        ),
      );
    }),
  );

const isParentWiredHookResultArgument = (
  analysis: ProgramAnalysis,
  argument: EsTreeNode,
): boolean => {
  if (!isNodeOfType(argument, "Identifier")) return false;
  const argumentRef = getRef(analysis, argument);
  if (!argumentRef) return false;
  return isParentWiredHookResultRef(analysis, argumentRef);
};

// The upstream chase through a derived local (`const effectiveFilename =
// hasStaticFallback ? fallbackFilename : filename`) bottoms out at the hook
// CALLEE identifier itself (`useMediaJobProgress`), which must not read as
// component-produced data when the hook is wired to props.
const isParentWiredHookCalleeRef = (analysis: ProgramAnalysis, ref: Reference): boolean => {
  const identifier = ref.identifier as unknown as EsTreeNode;
  if (!isNodeOfType(identifier, "Identifier") || !HOOK_NAME_PATTERN.test(identifier.name)) {
    return false;
  }
  const parent = (identifier as unknown as { parent?: EsTreeNode | null }).parent;
  if (
    !parent ||
    !isNodeOfType(parent, "CallExpression") ||
    parent.callee !== (identifier as unknown as typeof parent.callee)
  ) {
    return false;
  }
  return (parent.arguments ?? []).some((hookArgument) =>
    getDownstreamRefs(analysis, hookArgument as EsTreeNode).some((downstreamRef) =>
      isProp(analysis, downstreamRef),
    ),
  );
};

const isImportBindingRef = (ref: Reference): boolean =>
  Boolean(ref.resolved?.defs.some((def) => def.type === "ImportBinding"));

const isCalleePosition = (identifier: EsTreeNode): boolean => {
  const parent = (identifier as unknown as { parent?: EsTreeNode | null }).parent;
  return Boolean(
    parent &&
    (isNodeOfType(parent, "CallExpression") || isNodeOfType(parent, "NewExpression")) &&
    parent.callee === (identifier as unknown as typeof parent.callee),
  );
};

export const noPassDataToParent = defineRule({
  id: "no-pass-data-to-parent",
  title: "Data passed to parent via effect",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Fetch the data in the parent and pass it down as a prop (or return it from the hook), instead of handing it back up through a prop callback in a useEffect. See https://react.dev/learn/you-might-not-need-an-effect#passing-data-to-the-parent",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isUseEffect(node)) return;
      const analysis = getProgramAnalysis(node);
      if (!analysis) return;
      if (hasCleanup(analysis, node)) return;
      const effectFnRefs = getEffectFnRefs(analysis, node);
      if (!effectFnRefs) return;
      const effectFn = getEffectFn(analysis, node);
      if (!effectFn) return;

      for (const ref of effectFnRefs) {
        const callExpr = getCallExpr(ref);
        if (!callExpr || !isNodeOfType(callExpr, "CallExpression")) continue;
        if (isRefCall(analysis, ref)) continue;
        if (!isSynchronous(ref.identifier as unknown as EsTreeNode, effectFn)) continue;

        const calleeNode = unwrapChainExpression(callExpr.callee as EsTreeNode);
        const identifier = ref.identifier as unknown as EsTreeNode;

        if (calleeNode === identifier) {
          // Bare form: `onChange(data)` — callee must BE a prop (or a
          // plain alias of one), not a local function that eventually
          // mentions a prop.
          if (!isDirectParentCallbackRef(analysis, ref)) continue;
          if (
            isNodeOfType(identifier, "Identifier") &&
            COMMAND_PROP_NAME_PATTERN.test(identifier.name)
          ) {
            continue;
          }
        } else if (
          isNodeOfType(calleeNode, "MemberExpression") &&
          unwrapChainExpression(calleeNode.object as EsTreeNode) === identifier
        ) {
          // Member form: `props.onLoaded(data)` — only the whole props
          // object of a COMPONENT qualifies. A positional custom-hook
          // parameter (`cy.batch(...)`) is an external instance.
          if (!isWholePropsObjectReference(analysis, ref)) continue;
          if (isCustomHookParameter(ref)) continue;
        } else {
          continue;
        }

        // Skip well-known prototype/observer/promise methods —
        // `props.items.forEach(fn)`, `props.store.subscribe(fn)`,
        // `props.fetcher.then(fn)` are NOT "passing data to a parent
        // via a callback", they're iteration / subscription /
        // chaining patterns that happen to receive a callback. The
        // rule's intent is `props.onDataLoaded(data)` style hand-back,
        // which never uses these method names.
        const methodName = getCallMethodName(calleeNode);
        // ...except when a string-read name is called directly ON the
        // props object: `props.search(results)` is a parent callback
        // that happens to be named like `String.prototype.search`.
        const isPropCallbackNamedLikeStringRead = Boolean(
          methodName &&
          STRING_READ_METHOD_NAMES.has(methodName) &&
          isNodeOfType(calleeNode, "MemberExpression") &&
          calleeNode.object === (ref.identifier as unknown as typeof calleeNode.object) &&
          isWholePropsObjectReference(analysis, ref),
        );
        if (
          methodName &&
          DATA_SINK_METHOD_NAMES.has(methodName) &&
          !isPropCallbackNamedLikeStringRead
        ) {
          continue;
        }
        if (methodName && COMMAND_PROP_NAME_PATTERN.test(methodName)) continue;
        // `editor.commands.setSelection(...)`, `props.store.dispatch(...)`,
        // `props.queryClient.invalidate(...)` etc. — calling a method
        // on a namespaced API object, not handing data back to a parent.
        if (isNamespacedApiCallee(calleeNode)) continue;

        const calleeName = isNodeOfType(identifier, "Identifier") ? identifier.name : methodName;
        const isSetterNamedCallee = Boolean(
          calleeName && SETTER_NAMED_PROP_PATTERN.test(calleeName),
        );
        const isLeafRef = (argRef: Reference): boolean =>
          getUpstreamRefs(analysis, argRef).length === 1;
        const argsUpstreamRefs = (callExpr.arguments ?? [])
          .flatMap((argument) => {
            // A function-valued argument is a callback handed up for
            // REGISTRATION — the parent calls the child later, so data
            // flows down, not up. The exception is a functional updater
            // handed to a setter-named callee: its body produces the
            // payload, so it is scanned (minus its own parameters).
            if (isFunctionLike(argument as EsTreeNode)) {
              if (!isSetterNamedCallee) return [];
              return getFunctionalUpdaterDataRefs(analysis, argument as EsTreeNode);
            }
            if (isHandlerBagArgument(analysis, argument as EsTreeNode)) return [];
            if (isParentWiredHookResultArgument(analysis, argument as EsTreeNode)) return [];
            if (isNodeOfType(argument, "Identifier")) {
              const argumentRef = getRef(analysis, argument as EsTreeNode);
              if (argumentRef && resolveToFunction(argumentRef)) return [];
            }
            return getDownstreamRefs(analysis, argument as EsTreeNode);
          })
          .flatMap((argumentRef) => getUpstreamRefs(analysis, argumentRef))
          .filter(isLeafRef);
        // A wrapper-hook callee hides the hand-off in its wrapped body, so
        // its data refs live on the eventual call chain, not the direct
        // call's arguments.
        if (calleeNode === identifier && isWrapperHookCallbackRef(analysis, ref)) {
          argsUpstreamRefs.push(...getArgsUpstreamRefs(analysis, ref).filter(isLeafRef));
        }

        const isSomeArgsData = argsUpstreamRefs.some((argRef) => {
          if (isUseStateIdentifier(argRef.identifier as unknown as EsTreeNode)) return false;
          if (isProp(analysis, argRef)) return false;
          if (isUseRefIdentifier(argRef.identifier as unknown as EsTreeNode)) return false;
          if (isRefCurrent(argRef)) return false;
          if (isConstant(argRef)) return false;
          // A leaf sourced from a parent-wired hook stays hook-owned even
          // when it reaches the callback through a derived local
          // (`const effectiveFilename = hasStaticFallback ? fallbackFilename
          // : filename` — PortOS MediaJobThumb, docs-validation round 2).
          if (isParentWiredHookResultRef(analysis, argRef)) return false;
          if (isParentWiredHookCalleeRef(analysis, argRef)) return false;
          // Only real function BINDINGS are registration callbacks; a
          // parameter reference resolves to its enclosing function via
          // defs[0].node, which must not be mistaken for one — parameters
          // carry the data being handed up (cloudscape custom-forms,
          // a delta-audit recall regression).
          if (resolvesToFunctionBinding(argRef)) return false;
          // An imported binding in argument (not callee) position is
          // static module config (`subscribe(EVENT_NAME, handler)`),
          // not component-derived data.
          const argIdentifier = argRef.identifier as unknown as EsTreeNode;
          if (isImportBindingRef(argRef) && !isCalleePosition(argIdentifier)) return false;
          // `props.onReset(undefined)` is an imperative clear, not data
          // lifted to a parent. `undefined` is a global identifier with no
          // resolved def, so `isConstant` (which only inspects an init
          // expression) misses it — recognize it explicitly.
          if (isNodeOfType(argIdentifier, "Identifier") && argIdentifier.name === "undefined") {
            return false;
          }
          return true;
        });
        if (!isSomeArgsData) continue;

        context.report({
          node: callExpr,
          message:
            "Handing data back to a parent from a useEffect costs your users an extra render.",
        });
      }
    },
  }),
});
