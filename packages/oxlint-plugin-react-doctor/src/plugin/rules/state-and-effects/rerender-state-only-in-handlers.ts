import { BUILTIN_HOOK_NAMES, EFFECT_HOOK_NAMES } from "../../constants/react.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isReactHookCall } from "../../utils/is-react-hook-call.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { collectUseStateBindings } from "./utils/collect-use-state-bindings.js";
import { collectRenderReachableExpressions } from "./utils/collect-render-reachable-expressions.js";
import { buildLocalDependencyGraph } from "./utils/build-local-dependency-graph.js";
import { collectRenderReachableNames } from "./utils/collect-render-reachable-names.js";
import { expandTransitiveDependencies } from "./utils/expand-transitive-dependencies.js";
import { collectFunctionLikeLocalNames } from "./utils/collect-function-like-local-names.js";
import { isSetterCalledDuringRender } from "./utils/is-setter-called-during-render.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

interface EffectDependencyInfo {
  dependencyNames: Set<string>;
  synchronouslyCalledFunctionNames: Set<string>;
  payloadReadNames: Set<string>;
  nestedCallbackCalledFunctionNames: Set<string>;
}

// A read whose enclosing expression is the TEST of a conditional — the
// `currentPage < visibleRange.start` in `if (currentPage < visibleRange.start)`
// — feeds control flow, not a value that leaves the effect. Member reads
// inside a guard are still guard reads (lumina PDFThumbnails, delta audit).
const isInsideConditionTest = (identifier: EsTreeNode, stopAt: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = identifier;
  let parent = current.parent;
  while (parent && current !== stopAt) {
    if (
      (isNodeOfType(parent, "IfStatement") ||
        isNodeOfType(parent, "ConditionalExpression") ||
        isNodeOfType(parent, "WhileStatement") ||
        isNodeOfType(parent, "DoWhileStatement")) &&
      (parent as { test?: EsTreeNode }).test === current
    ) {
      return true;
    }
    current = parent;
    parent = current.parent;
  }
  return false;
};

// One entry per effect hook call: the root names listed in its dependency
// array, the functions its callback invokes SYNCHRONOUSLY (nested
// callbacks like `.then(...)` or timers are excluded — a setter called there
// is an async trigger for the next re-run, not a same-pass echo), the
// names whose VALUE the callback actually consumes (member access or a call
// argument outside guard tests), and the functions invoked from NESTED
// callbacks (promise continuations, timers) — a setter called there
// re-triggers the effect later, so the state drives an async loop.
// A guard-only read (`if (closing && ...)`) is not a payload read.
const collectEffectDependencyInfos = (
  componentBody: EsTreeNode,
  setterNames: ReadonlySet<string>,
  scopes: ScopeAnalysis,
): EffectDependencyInfo[] => {
  const effectInfos: EffectDependencyInfo[] = [];
  walkAst(componentBody, (child: EsTreeNode) => {
    if (!isNodeOfType(child, "CallExpression")) return;
    if (!isReactHookCall(child, EFFECT_HOOK_NAMES, scopes)) return;
    const dependencyNames = new Set<string>();
    for (const argument of child.arguments ?? []) {
      if (!isNodeOfType(argument, "ArrayExpression")) continue;
      for (const element of argument.elements ?? []) {
        if (!element) continue;
        const rootName = getRootIdentifierName(element);
        if (rootName) dependencyNames.add(rootName);
      }
    }
    const synchronouslyCalledFunctionNames = new Set<string>();
    const payloadReadNames = new Set<string>();
    const nestedCallbackCalledFunctionNames = new Set<string>();
    const effectCallback = child.arguments?.[0];
    if (
      isNodeOfType(effectCallback, "ArrowFunctionExpression") ||
      isNodeOfType(effectCallback, "FunctionExpression")
    ) {
      walkAst(effectCallback.body, (bodyNode: EsTreeNode): boolean | void => {
        if (bodyNode !== effectCallback.body && isFunctionLike(bodyNode)) return false;
        if (
          isNodeOfType(bodyNode, "CallExpression") &&
          isNodeOfType(bodyNode.callee, "Identifier")
        ) {
          synchronouslyCalledFunctionNames.add(bodyNode.callee.name);
        }
      });
      walkAst(effectCallback.body, (bodyNode: EsTreeNode): void => {
        if (!isNodeOfType(bodyNode, "CallExpression")) return;
        if (!isNodeOfType(bodyNode.callee, "Identifier")) return;
        let ancestor: EsTreeNode | null | undefined = bodyNode.parent;
        while (ancestor && ancestor !== effectCallback.body) {
          if (isFunctionLike(ancestor)) {
            nestedCallbackCalledFunctionNames.add(bodyNode.callee.name);
            return;
          }
          ancestor = ancestor.parent;
        }
      });
      walkAst(effectCallback.body, (bodyNode: EsTreeNode): void => {
        if (!isNodeOfType(bodyNode, "Identifier")) return;
        const parent = bodyNode.parent;
        if (!parent) return;
        if (isNodeOfType(parent, "MemberExpression") && parent.object === bodyNode) {
          if (isInsideConditionTest(bodyNode, effectCallback.body as EsTreeNode)) return;
          payloadReadNames.add(bodyNode.name);
          return;
        }
        if (
          isNodeOfType(parent, "CallExpression") &&
          (parent.arguments ?? []).some((argument) => argument === bodyNode)
        ) {
          // An argument of the state's own setter (`setX(x + 1)`) writes,
          // it doesn't consume.
          const calleeName = isNodeOfType(parent.callee, "Identifier") ? parent.callee.name : null;
          if (calleeName !== null && setterNames.has(calleeName)) return;
          payloadReadNames.add(bodyNode.name);
        }
      });
    }
    effectInfos.push({
      dependencyNames,
      synchronouslyCalledFunctionNames,
      payloadReadNames,
      nestedCallbackCalledFunctionNames,
    });
  });
  return effectInfos;
};

// State handed to a CUSTOM hook call (`useKeyboardNav({ pendingFocus })`)
// escapes into foreign reactive logic — the hook re-runs on every render
// and reads the fresh value, so the state is consumed beyond handlers.
// Builtin hooks are excluded: a `useState(other)` initializer reads once,
// and memo/callback deps only matter if their result is render-reachable
// (the dependency graph already models that).
const collectCustomHookArgumentNames = (
  componentBody: EsTreeNode,
  scopes: ScopeAnalysis,
): Set<string> => {
  const argumentNames = new Set<string>();
  walkAst(componentBody, (child: EsTreeNode) => {
    if (!isNodeOfType(child, "CallExpression")) return;
    if (!isNodeOfType(child.callee, "Identifier")) return;
    const calleeName = child.callee.name;
    if (!isReactHookName(calleeName)) return;
    if (isReactHookCall(child, BUILTIN_HOOK_NAMES, scopes)) return;
    if (BUILTIN_HOOK_NAMES.has(calleeName)) return;
    if (EFFECT_HOOK_NAMES.has(calleeName)) return;
    for (const argument of child.arguments ?? []) {
      walkAst(argument as EsTreeNode, (argumentNode: EsTreeNode) => {
        if (isNodeOfType(argumentNode, "Identifier")) argumentNames.add(argumentNode.name);
      });
    }
  });
  return argumentNames;
};

const collectTopLevelVoidMarkedNames = (
  componentBody: EsTreeNodeOfType<"BlockStatement">,
): Set<string> => {
  const voidMarkedNames = new Set<string>();
  for (const statement of componentBody.body ?? []) {
    if (!isNodeOfType(statement, "ExpressionStatement")) continue;
    const expression = statement.expression;
    if (!isNodeOfType(expression, "UnaryExpression") || expression.operator !== "void") continue;
    if (isNodeOfType(expression.argument, "Identifier")) {
      voidMarkedNames.add(expression.argument.name);
    }
  }
  return voidMarkedNames;
};

// A render-phase call to anything but a hook (`buildSegments(now())`,
// `computeAnchoredPanelStyle(anchorEl)`) can produce different output on
// every render, so a forced re-render actually refreshes the screen.
const hasRenderPhaseNonHookCall = (componentBody: EsTreeNode): boolean => {
  let didFindRenderPhaseCall = false;
  walkAst(componentBody, (child: EsTreeNode): boolean | void => {
    if (didFindRenderPhaseCall) return false;
    if (child !== componentBody && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    const calleeName = isNodeOfType(child.callee, "Identifier")
      ? child.callee.name
      : isNodeOfType(child.callee, "MemberExpression") &&
          isNodeOfType(child.callee.property, "Identifier")
        ? child.callee.property.name
        : null;
    if (calleeName !== null && isReactHookName(calleeName)) return;
    didFindRenderPhaseCall = true;
  });
  return didFindRenderPhaseCall;
};

export const rerenderStateOnlyInHandlers = defineRule({
  id: "rerender-state-only-in-handlers",
  title: "State only used in handlers",
  severity: "warn",
  tags: ["test-noise"],
  category: "Performance",
  recommendation:
    "Use useRef instead of useState when the value is only set and never shown on screen. `ref.current = ...` updates it without redrawing the component.",
  create: (context: RuleContext) => {
    const checkComponent = (componentBody: EsTreeNode | null | undefined): void => {
      if (!componentBody || !isNodeOfType(componentBody, "BlockStatement")) return;
      const bindings = collectUseStateBindings(componentBody, context.scopes);
      if (bindings.length === 0) return;

      const renderReachableExpressions = collectRenderReachableExpressions(componentBody);
      if (renderReachableExpressions.length === 0) return;

      const eventHandlerReferenceNames = collectFunctionLikeLocalNames(
        componentBody,
        context.scopes,
      );
      const dependencyGraph = buildLocalDependencyGraph(componentBody, eventHandlerReferenceNames);
      const directRenderNames = collectRenderReachableNames(
        componentBody,
        context.scopes,
        eventHandlerReferenceNames,
      );
      // A top-level `void someState;` is the deliberate "re-render to
      // refresh render output" marker (WaterfallHUD's `void now` next to
      // `buildSegments(performance.now())`) — but only when the render
      // body computes something call-based that can change between
      // renders. With static-only output the statement is just
      // unused-variable hygiene and the state-triggered re-render really
      // is wasted, so the marker must not suppress the diagnostic.
      if (hasRenderPhaseNonHookCall(componentBody)) {
        for (const voidMarkedName of collectTopLevelVoidMarkedNames(componentBody)) {
          directRenderNames.add(voidMarkedName);
        }
      }
      const renderReachableNames = expandTransitiveDependencies(directRenderNames, dependencyGraph);
      const setterNames = new Set(bindings.map((binding) => binding.setterName));
      // A state name in an effect's dependency array marks the state as
      // reactively consumed: the effect must re-run when it changes, and a
      // `useRef` swap would silently stop those re-runs, so the re-render is
      // load-bearing rather than wasted. The one shape that stays flagged is
      // the self-echo loop — a dep-listing effect that reads the state only
      // as a guard and calls its setter synchronously
      // (`useEffect(() => { if (x) { fire(); setX(false); } }, [x])`): the
      // state never leaves the effect as a value, so a ref (or no state at
      // all) would work. An effect that consumes the PAYLOAD (member reads,
      // call arguments) before clearing is a handoff, not an echo.
      const effectInfos = collectEffectDependencyInfos(componentBody, setterNames, context.scopes);
      const selfEchoValueNames = new Set<string>();
      for (const binding of bindings) {
        // A setter also invoked from a NESTED callback of the same effect
        // (`.finally(() => setRunningQueueId(null))`, a retry timer) clears
        // the slot later and re-triggers the effect — the state drives an
        // async dequeue loop, so the re-render is load-bearing, not an echo
        // (portos VideoGen, delta audit).
        const hasGuardOnlySynchronousSelfWrite = effectInfos.some(
          (effectInfo) =>
            effectInfo.dependencyNames.has(binding.valueName) &&
            effectInfo.synchronouslyCalledFunctionNames.has(binding.setterName) &&
            !effectInfo.payloadReadNames.has(binding.valueName) &&
            !effectInfo.nestedCallbackCalledFunctionNames.has(binding.setterName),
        );
        if (hasGuardOnlySynchronousSelfWrite) selfEchoValueNames.add(binding.valueName);
      }
      const effectConsumedNames = new Set<string>();
      for (const effectInfo of effectInfos) {
        for (const dependencyName of effectInfo.dependencyNames) {
          if (!selfEchoValueNames.has(dependencyName)) effectConsumedNames.add(dependencyName);
        }
      }
      for (const hookArgumentName of collectCustomHookArgumentNames(
        componentBody,
        context.scopes,
      )) {
        effectConsumedNames.add(hookArgumentName);
      }
      for (const reachableName of expandTransitiveDependencies(
        effectConsumedNames,
        dependencyGraph,
      )) {
        renderReachableNames.add(reachableName);
      }
      const calledSetterNames = new Set<string>();
      walkAst(componentBody, (child: EsTreeNode) => {
        if (
          isNodeOfType(child, "CallExpression") &&
          isNodeOfType(child.callee, "Identifier") &&
          setterNames.has(child.callee.name)
        ) {
          calledSetterNames.add(child.callee.name);
        }
      });

      for (const binding of bindings) {
        if (renderReachableNames.has(binding.valueName)) continue;
        // Underscore-only or underscore-prefixed value names signal
        // the user is intentionally using useState to FORCE a re-
        // render and doesn't care about the value (`const [_, force]
        // = useState(0)`, `const [_force, setForce] = useState(false)`).
        // This is the canonical "trigger a re-render imperatively"
        // pattern — useRef wouldn't work because ref updates don't
        // re-render. Skip.
        if (binding.valueName === "_" || binding.valueName.startsWith("_")) continue;
        // Setter names that match force-rerender conventions
        // (`triggerRender`, `forceUpdate`, `rerender`, `forceRender`,
        // `tick`, `bump`, `bumpVersion`) — these names literally
        // declare the user's intent: re-render on demand. Skip.
        const setterSuffix = binding.setterName.slice(3); // 'set' + suffix
        if (
          /^(TriggerRender|ForceUpdate|Rerender|ForceRender|Tick|Bump|BumpVersion|InvalidateRender|Refresh|Repaint)$/i.test(
            setterSuffix,
          )
        ) {
          continue;
        }

        if (!calledSetterNames.has(binding.setterName)) continue;

        // The "store information from previous renders" pattern reads the
        // value in a render-phase guard (`if (value !== prevValue)`) and
        // re-syncs it by calling the setter during render. Such a value
        // shapes render-phase control flow, so it is NOT write-only and a
        // `useRef` swap would break the adjustment. Skip it.
        if (isSetterCalledDuringRender(componentBody, binding.setterName)) continue;

        context.report({
          node: binding.declarator,
          message: `Each update to "${binding.valueName}" redraws your component for nothing because this useState is set but never shown on screen.`,
        });
      }
    };

    return {
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        checkComponent(node.body);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isComponentAssignment(node)) return;
        if (
          !isNodeOfType(node.init, "ArrowFunctionExpression") &&
          !isNodeOfType(node.init, "FunctionExpression")
        )
          return;
        checkComponent(node.init.body);
      },
    };
  },
});
