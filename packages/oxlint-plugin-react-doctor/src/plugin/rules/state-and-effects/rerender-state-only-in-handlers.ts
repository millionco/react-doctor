import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isHookCall } from "../../utils/is-hook-call.js";
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
import {
  collectScopedReferenceNames,
  createComponentBindingScope,
} from "./utils/scope-aware-reference-names.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// Names listed in an EFFECT hook's dependency array. Only effect hooks
// qualify — `useMemo`/`useCallback` deps merely control memoization/
// identity, and reading `ref.current` inside those callbacks stays
// correct, so they don't justify keeping the value in state.
const collectDependencyArrayNames = (componentBody: EsTreeNode): Set<string> => {
  const dependencyNames = new Set<string>();
  walkAst(componentBody, (child: EsTreeNode) => {
    if (!isNodeOfType(child, "CallExpression")) return;
    if (!isHookCall(child, EFFECT_HOOK_NAMES)) return;
    for (const argument of child.arguments ?? []) {
      if (!isNodeOfType(argument, "ArrayExpression")) continue;
      for (const element of argument.elements ?? []) {
        if (!element) continue;
        const rootName = getRootIdentifierName(element);
        if (rootName) dependencyNames.add(rootName);
      }
    }
  });
  return dependencyNames;
};

const isPureEarlyExitConsequent = (consequent: EsTreeNode): boolean => {
  if (isNodeOfType(consequent, "ContinueStatement")) return true;
  if (isNodeOfType(consequent, "ReturnStatement")) {
    return (
      !consequent.argument ||
      (isNodeOfType(consequent.argument, "Literal") && consequent.argument.value === null)
    );
  }
  if (isNodeOfType(consequent, "BlockStatement")) {
    const statements = consequent.body ?? [];
    return statements.length === 1 && isPureEarlyExitConsequent(statements[0] as EsTreeNode);
  }
  return false;
};

const collectEarlyExitGuardStatements = (
  effectCallback: EsTreeNode,
): EsTreeNodeOfType<"IfStatement">[] => {
  const guardStatements: EsTreeNodeOfType<"IfStatement">[] = [];
  walkAst(effectCallback, (child: EsTreeNode) => {
    if (
      isNodeOfType(child, "IfStatement") &&
      !child.alternate &&
      isPureEarlyExitConsequent(child.consequent as EsTreeNode)
    ) {
      guardStatements.push(child);
    }
  });
  return guardStatements;
};

// Names whose VALUE is consumed inside an EFFECT hook's callback body (its
// render-time arguments — the dependency array — are NOT included). Reads
// that only gate an early exit (`if (!dirty) return;`) do not count: the
// guard needs the re-run, not the content, so the dep stays a pure trigger
// (the debounced-save shape). A name read anywhere else in the callback
// (`getEmojiPickerData(emojiData, …)`) is a payload read. The guard tests
// are detached while the scope-aware collector runs so payload reads and
// guard reads resolve through the SAME binding scopes — a local that
// shadows a state name can neither hide nor fake a read of the outer value.
const collectEffectCallbackReadNames = (componentBody: EsTreeNode): Set<string> => {
  const readNames = new Set<string>();
  walkAst(componentBody, (child: EsTreeNode) => {
    if (!isNodeOfType(child, "CallExpression")) return;
    if (!isHookCall(child, EFFECT_HOOK_NAMES)) return;
    const effectCallback = child.arguments?.[0];
    if (
      !isNodeOfType(effectCallback, "ArrowFunctionExpression") &&
      !isNodeOfType(effectCallback, "FunctionExpression")
    ) {
      return;
    }
    const guardStatements = collectEarlyExitGuardStatements(effectCallback);
    const detachedGuardTests = guardStatements.map((statement) => statement.test);
    // HACK: the guard tests are detached in place (and reattached
    // synchronously below) so the collector never sees them — walking
    // them separately would need a second, drift-prone scope tracker.
    for (const statement of guardStatements) {
      (statement as unknown as { test: EsTreeNode | null }).test = null;
    }
    try {
      for (const referenceName of collectScopedReferenceNames(
        effectCallback,
        createComponentBindingScope(),
        new Set(),
      )) {
        readNames.add(referenceName);
      }
    } finally {
      guardStatements.forEach((statement, index) => {
        (statement as unknown as { test: EsTreeNode | null }).test =
          detachedGuardTests[index] ?? null;
      });
    }
  });
  return readNames;
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
      const bindings = collectUseStateBindings(componentBody);
      if (bindings.length === 0) return;

      const renderReachableExpressions = collectRenderReachableExpressions(componentBody);
      if (renderReachableExpressions.length === 0) return;

      const eventHandlerReferenceNames = collectFunctionLikeLocalNames(componentBody);
      const dependencyGraph = buildLocalDependencyGraph(componentBody, eventHandlerReferenceNames);
      const directRenderNames = collectRenderReachableNames(
        componentBody,
        eventHandlerReferenceNames,
      );
      const renderReachableNames = expandTransitiveDependencies(directRenderNames, dependencyGraph);
      // An effect dep counts as a reason to keep the value in state only
      // when it is a pure re-run TRIGGER: the effect never reads the value,
      // so the dep's identity change is the whole point and a `useRef` swap
      // would stop the re-run (`useEffect(() => scrollToHash(), [loaded])`).
      // When the effect body READS the state, the dep entry is just
      // exhaustive-deps hygiene for that read — it does not prove the value
      // ever reaches the screen, and suppressing on it masks the canonical
      // write-only-state-echoed-in-an-effect bug. Non-state dep names
      // (derived render-phase locals like `offset` from `page * 10`) still
      // suppress via the transitive expansion.
      const stateValueNames = new Set(bindings.map((binding) => binding.valueName));
      const effectCallbackReadNames = collectEffectCallbackReadNames(componentBody);
      const effectTriggerNames = new Set<string>();
      for (const dependencyName of collectDependencyArrayNames(componentBody)) {
        const isStateReadByAnEffect =
          stateValueNames.has(dependencyName) && effectCallbackReadNames.has(dependencyName);
        if (!isStateReadByAnEffect) effectTriggerNames.add(dependencyName);
      }
      for (const reachableName of expandTransitiveDependencies(
        effectTriggerNames,
        dependencyGraph,
      )) {
        renderReachableNames.add(reachableName);
      }

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

        let setterCalled = false;
        walkAst(componentBody, (child: EsTreeNode) => {
          if (setterCalled) return;
          if (
            isNodeOfType(child, "CallExpression") &&
            isNodeOfType(child.callee, "Identifier") &&
            child.callee.name === binding.setterName
          ) {
            setterCalled = true;
          }
        });
        if (!setterCalled) continue;

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
