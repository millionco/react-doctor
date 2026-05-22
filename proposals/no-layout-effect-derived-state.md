# Proposal: `react-doctor/no-layout-effect-derived-state`

> **Status**: 🟡 Auto-discovered draft proposal. **Not yet implemented.** Maintainer review wanted before any code lands.

|                             |                                       |
| --------------------------- | ------------------------------------- |
| Category                    | `state-and-effects`                   |
| Severity                    | `warn`                                |
| Source clusters             | `NEW::no-layout-effect-derived-state` |
| Independent draft proposals | 1                                     |
| Backing evidence units      | 1                                     |

## Sources

Discovered by the [react-doctor-evals discovery flywheel](https://github.com/millionco/react-doctor-evals/pull/11) mining bug-fix evidence across React OSS repos. The pipeline below produced this proposal:

```
OSS repo → Vercel Sandbox miner → EvidenceUnit → RuleDrafter (LLM) → RuleDedupe → THIS PR
```

### Backing evidence

- [`facebook/react` — `packages/react-dom/src/__tests__/ReactUpdates-test.js` (FixCommitMeta)](https://github.com/facebook/react/commit/fef12a01c826ce5b8458e82240c659bf51108a46)

## Validation prompt

FP-aware guidance for the [react-review agent](https://github.com/millionco/react-review) when triaging this rule:

> Only flag direct `useLayoutEffect` writes whose argument is driven by the same component’s reactive inputs. Do not flag one-time mount measurements, initialization with `[]`, subscription/cleanup effects, or guarded fixed-point updates that stop once the state matches. If the effect is synchronizing an external resource rather than deriving local state, it is probably a false positive.

## Fix prompt

Actionable fix suggestion surfaced to the user when the rule fires:

> Move the derivation into render or `useMemo` so the component reads the value instead of synchronously writing it during commit. If you truly need local state, add a guard so the setter only runs when the next value differs from the current one.

```tsx
const draft = useMemo(() => derive(value), [value]);

useLayoutEffect(() => {
  if (draft !== value) setDraft(value);
}, [draft, value]);
```

## Positive fixture (SHOULD trigger)

```tsx
import { useLayoutEffect, useState } from "react";

function App({ value }) {
  const [draft, setDraft] = useState("");

  useLayoutEffect(() => {
    setDraft(value);
  }, [value]);

  return <div>{draft}</div>;
}
```

## Negative fixture (should NOT trigger)

```tsx
import { useLayoutEffect, useState } from "react";

function App() {
  const [count, setCount] = useState(0);

  useLayoutEffect(() => {
    setCount(1);
  }, []);

  return <div>{count}</div>;
}
```

## Proposed AST detector

Would land at `packages/oxlint-plugin-react-doctor/src/plugin/rules/state-and-effects/no-layout-effect-derived-state.ts`:

```ts
import { defineRule } from "../../utils/define-rule.js";
import { getCallbackStatements } from "../../utils/get-callback-statements.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isSetterCall } from "../../utils/is-setter-call.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  getArgsUpstreamRefs,
  getCallExpr,
  getUpstreamRefs,
  isSynchronous,
} from "./utils/effect/ast.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import {
  getEffectDepsRefs,
  getEffectFnRefs,
  isProp,
  isState,
  isStateSetterCall,
} from "./utils/effect/react.js";

const isNonNullable = <T>(value: T | null | undefined): value is T =>
  value != null;

export const noLayoutEffectDerivedState = defineRule<Rule>({
  id: "no-layout-effect-derived-state",
  severity: "warn",
  recommendation:
    "Move the derivation into render (or useMemo if it is expensive) instead of writing it from useLayoutEffect. Synchronous commit-phase state writes can retrigger rendering and form an update loop.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (
        !isHookCall(node, "useLayoutEffect") ||
        (node.arguments?.length ?? 0) < 2
      )
        return;

      const analysis = getProgramAnalysis(node);
      if (!analysis) return;

      const effectCallback = getEffectCallback(node);
      if (!effectCallback) return;

      const dependencyRefs = getEffectDepsRefs(analysis, node);
      if (!dependencyRefs?.length) return;

      const callbackStatements = getCallbackStatements(effectCallback);
      if (!callbackStatements.length) return;

      const containsOnlySetStateCalls = callbackStatements.every(
        (statement) =>
          isNodeOfType(statement, "ExpressionStatement") &&
          isNodeOfType(statement.expression, "CallExpression") &&
          isSetterCall(statement.expression)
      );
      if (!containsOnlySetStateCalls) return;

      const effectFnRefs = getEffectFnRefs(analysis, node);
      if (!effectFnRefs) return;

      const dependencyResolved = dependencyRefs
        .map((dependencyRef) => dependencyRef.resolved)
        .filter(isNonNullable);

      for (const reference of effectFnRefs) {
        if (!isStateSetterCall(analysis, reference)) continue;
        if (
          !isSynchronous(
            reference.identifier as unknown as EsTreeNode,
            effectCallback
          )
        )
          continue;

        const callExpr = getCallExpr(reference);
        if (!callExpr) continue;

        const argumentRefs = getArgsUpstreamRefs(analysis, reference);
        const isReactiveArgument = argumentRefs.some(
          (argumentRef) =>
            isState(analysis, argumentRef) || isProp(analysis, argumentRef)
        );
        if (!isReactiveArgument) continue;

        const isDependencyDriven = argumentRefs.some((argumentRef) =>
          dependencyResolved.some(
            (dependency) => argumentRef.resolved === dependency
          )
        );
        if (!isDependencyDriven) continue;

        context.report({
          node: callExpr,
          message:
            "Derived state in useLayoutEffect — compute it during render instead, or guard the setter so the write reaches a fixed point.",
        });
      }
    },
  }),
});
```

---

<sub>
Generated by `rde discover` (see [millionco/react-doctor-evals#11](https://github.com/millionco/react-doctor-evals/pull/11) for the pipeline). Implementation, test fixtures, and rule registration are deliberately deferred — this PR exists for maintainer triage of the proposal only. Reject, edit-and-approve, or merge after wiring as you see fit.
</sub>
