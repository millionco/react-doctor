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
  isCustomHook,
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
// are commands ASKING the parent to do work, not data handed back up — the
// redux `mapDispatchToProps` shape in particular is standard
// fetch-on-change dispatching.
const COMMAND_PROP_NAME_PATTERN = /^(fetch|load|refetch|dispatch)([A-Z_]|$)/;

const unwrapChainExpression = (node: EsTreeNode): EsTreeNode =>
  isNodeOfType(node, "ChainExpression") ? (node.expression as EsTreeNode) : node;

// A parent callback is the prop itself (`onChange(...)`) or a plain
// re-binding of one (`const { onChange } = props`, `const cb =
// props.onChange`). A binding produced by CALLING something (`const {
// setValue } = useForm({ defaultValues: props.initial })`) is a local
// utility, no matter how many props appear in the call.
const isDirectParentCallbackRef = (analysis: ProgramAnalysis, ref: Reference): boolean => {
  if (isProp(analysis, ref)) return true;
  return Boolean(
    ref.resolved?.defs.some((def) => {
      const node = def.node as unknown as EsTreeNode;
      if (!isNodeOfType(node, "VariableDeclarator") || !node.init) return false;
      const initializer = unwrapChainExpression(node.init as EsTreeNode);
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

// A bare (non-destructured) parameter of a CUSTOM HOOK is a positional
// argument (`useRunLayout(cy)`), not a component's props object —
// method calls on it (`cy.batch(...)`) drive an external instance.
const isCustomHookParameter = (ref: Reference): boolean =>
  Boolean(
    ref.resolved?.defs.some((def) => {
      if (def.type !== "Parameter") return false;
      const functionNode = def.node as unknown as EsTreeNode;
      if (isCustomHook(functionNode)) return true;
      const parent = (functionNode as unknown as { parent?: EsTreeNode | null }).parent;
      return Boolean(parent && isCustomHook(parent));
    }),
  );

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

        const argsUpstreamRefs = (callExpr.arguments ?? [])
          .flatMap((argument) => {
            // A function-valued argument is a callback handed up for
            // REGISTRATION — the parent calls the child later, so data
            // flows down, not up.
            if (isFunctionLike(argument as EsTreeNode)) return [];
            if (isNodeOfType(argument, "Identifier")) {
              const argumentRef = getRef(analysis, argument as EsTreeNode);
              if (argumentRef && resolveToFunction(argumentRef)) return [];
            }
            return getDownstreamRefs(analysis, argument as EsTreeNode);
          })
          .flatMap((argumentRef) => getUpstreamRefs(analysis, argumentRef))
          .filter((argRef) => getUpstreamRefs(analysis, argRef).length === 1);

        const isSomeArgsData = argsUpstreamRefs.some((argRef) => {
          if (isUseStateIdentifier(argRef.identifier as unknown as EsTreeNode)) return false;
          if (isProp(analysis, argRef)) return false;
          if (isUseRefIdentifier(argRef.identifier as unknown as EsTreeNode)) return false;
          if (isRefCurrent(argRef)) return false;
          if (isConstant(argRef)) return false;
          if (resolveToFunction(argRef)) return false;
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
