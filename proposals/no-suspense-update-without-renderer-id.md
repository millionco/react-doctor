# Proposal: `react-doctor/no-suspense-update-without-renderer-id`

> **Status**: 🟡 Auto-discovered draft proposal. **Not yet implemented.** Maintainer review wanted before any code lands.

|                             |                                               |
| --------------------------- | --------------------------------------------- |
| Category                    | `correctness`                                 |
| Severity                    | `warn`                                        |
| Source clusters             | `NEW::no-suspense-update-without-renderer-id` |
| Independent draft proposals | 1                                             |
| Backing evidence units      | 1                                             |

## Sources

Discovered by the [react-doctor-evals discovery flywheel](https://github.com/millionco/react-doctor-evals/pull/11) mining bug-fix evidence across React OSS repos. The pipeline below produced this proposal:

```
OSS repo → Vercel Sandbox miner → EvidenceUnit → RuleDrafter (LLM) → RuleDedupe → THIS PR
```

### Backing evidence

- [`facebook/react` — `packages/react-devtools-shared/src/devtools/views/SuspenseTab/SuspenseTimeline.js` (DisableChurnMeta)](https://github.com/facebook/react/commit/93a3935d0292d66e0bf426a7e28bb1433bbeea30)

## Validation prompt

FP-aware guidance for the [react-review agent](https://github.com/millionco/react-review) when triaging this rule:

> Flag this only when a Suspense milestone update is sent without any renderer-scoping field. Typical false positives are test doubles, mocks, or legacy compatibility code that intentionally broadcasts to all renderers, and calls to other send events that are unrelated to Suspense. If the payload is built through spreads or helper functions, verify whether `rendererID` is added upstream before treating it as a violation.

## Fix prompt

Actionable fix suggestion surfaced to the user when the rule fires:

> Add the renderer identifier to the payload and scope the update to that renderer. If you are computing suspended items from a list, partition them by renderer first and send one keyed update per renderer.

```ts
bridge.send("overrideSuspenseMilestone", {
  rendererID,
  suspendedSet,
});
```

## Positive fixture (SHOULD trigger)

```tsx
import * as React from "react";

function Example() {
  const bridge = { send() {} };
  bridge.send("overrideSuspenseMilestone", { suspendedSet: [] });
  return null;
}
```

## Negative fixture (should NOT trigger)

```tsx
import * as React from "react";

function Example() {
  const bridge = { send() {} };
  bridge.send("overrideSuspenseMilestone", { rendererID: 1, suspendedSet: [] });
  return null;
}
```

## Proposed AST detector

Would land at `packages/oxlint-plugin-react-doctor/src/plugin/rules/correctness/no-suspense-update-without-renderer-id.ts`:

```ts
import { defineRule } from "../../utils/define-rule.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const SUSPENSE_UPDATE_EVENT_NAMES = new Set(["overrideSuspenseMilestone"]);

const objectExpressionHasProperty = (
  node: EsTreeNode,
  propertyName: string
): boolean => {
  if (!isNodeOfType(node, "ObjectExpression")) return false;

  for (const property of node.properties ?? []) {
    if (!isNodeOfType(property, "Property")) continue;
    if (property.computed) continue;

    const key = property.key;
    if (isNodeOfType(key, "Identifier") && key.name === propertyName)
      return true;
    if (isNodeOfType(key, "Literal") && key.value === propertyName) return true;
  }

  return false;
};

export const noSuspenseUpdateWithoutRendererId = defineRule<Rule>({
  id: "no-suspense-update-without-renderer-id",
  category: "correctness",
  severity: "warn",
  recommendation:
    "Include the renderer identifier in the payload and scope the update to that renderer instead of broadcasting a renderer-agnostic Suspense milestone.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (getCalleeName(node) !== "send") return;

      const eventName = node.arguments?.[0];
      if (
        !isNodeOfType(eventName, "Literal") ||
        typeof eventName.value !== "string"
      )
        return;
      if (!SUSPENSE_UPDATE_EVENT_NAMES.has(eventName.value)) return;

      const payload = node.arguments?.[1];
      if (!payload || !isNodeOfType(payload, "ObjectExpression")) return;
      if (objectExpressionHasProperty(payload, "rendererID")) return;

      context.report({
        node: payload,
        message:
          "overrideSuspenseMilestone payload is missing rendererID, so the update is broadcast to every renderer instead of the one that changed.",
      });
    },
  }),
});
```

---

<sub>
Generated by `rde discover` (see [millionco/react-doctor-evals#11](https://github.com/millionco/react-doctor-evals/pull/11) for the pipeline). Implementation, test fixtures, and rule registration are deliberately deferred — this PR exists for maintainer triage of the proposal only. Reject, edit-and-approve, or merge after wiring as you see fit.
</sub>
