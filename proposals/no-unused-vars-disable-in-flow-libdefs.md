# Proposal: `react-doctor/no-unused-vars-disable-in-flow-libdefs`

> **Status**: 🟡 Auto-discovered draft proposal. **Not yet implemented.** Maintainer review wanted before any code lands.

|                             |                                               |
| --------------------------- | --------------------------------------------- |
| Category                    | `correctness`                                 |
| Severity                    | `warn`                                        |
| Source clusters             | `NEW::no-unused-vars-disable-in-flow-libdefs` |
| Independent draft proposals | 1                                             |
| Backing evidence units      | 1                                             |

## Sources

Discovered by the [react-doctor-evals discovery flywheel](https://github.com/millionco/react-doctor-evals/pull/11) mining bug-fix evidence across React OSS repos. The pipeline below produced this proposal:

```
OSS repo → Vercel Sandbox miner → EvidenceUnit → RuleDrafter (LLM) → RuleDedupe → THIS PR
```

### Backing evidence

- [`facebook/react` — `scripts/flow/react-native-host-hooks.js` (DisableChurnMeta)](https://github.com/facebook/react/commit/568244232e29a0d4524544344aa280917580e8f7)

## Validation prompt

FP-aware guidance for the [react-review agent](https://github.com/millionco/react-review) when triaging this rule:

> Check that this is a handwritten Flow libdef or host-hook file, not generated typings or an ambient stub that intentionally declares globals. Common false positives are `scripts/flow/*` outputs, `*.d.ts`/`*.flow.js` files owned by codegen, and feature-flag declarations that are only meant to exist for native consumers. If the symbol is already consumed by runtime code, the warning is likely valid; if it is purely generated, suppressing `no-unused-vars` may be acceptable.

## Fix prompt

Actionable fix suggestion surfaced to the user when the rule fires:

> Remove the `eslint-disable-next-line no-unused-vars` and either let the declaration live in generated typings or wire the symbol into the code that actually consumes it. If the flag is meant to control behavior, read it where the branch happens:

```js
if (RN$isNativeEventTargetEventDispatchingEnabled) {
  dispatchTrustedEvent(target, event);
}
```

If it is only a type-level ambient declaration, keep it in generated libdefs instead of hand-suppressing the lint rule.

## Positive fixture (SHOULD trigger)

```tsx
// @flow
// eslint-disable-next-line no-unused-vars
declare const RN$isNativeEventTargetEventDispatchingEnabled: boolean;

export function App() {
  return null;
}
```

## Negative fixture (should NOT trigger)

```tsx
// @flow
declare const RN$isNativeEventTargetEventDispatchingEnabled: boolean;

export function App() {
  return null;
}
```

## Proposed AST detector

Would land at `packages/oxlint-plugin-react-doctor/src/plugin/rules/correctness/no-unused-vars-disable-in-flow-libdefs.ts`:

```ts
import fs from "node:fs";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const UNUSED_VARS_DISABLE_LINE = "eslint-disable-next-line no-unused-vars";
const DECLARE_BINDING_PREFIXES = [
  "declare const",
  "declare let",
  "declare var",
  "declare export const",
  "declare export let",
  "declare export var",
];

const findTopLevelNodeOnLine = (
  programNode: EsTreeNodeOfType<"Program">,
  lineNumber: number
): EsTreeNode | null => {
  for (const statement of programNode.body) {
    if (statement.loc?.start.line === lineNumber) return statement;
  }
  return null;
};

const isDeclareBindingLine = (lineText: string): boolean => {
  const trimmedLineText = lineText.trimStart();
  for (const prefix of DECLARE_BINDING_PREFIXES) {
    if (trimmedLineText.startsWith(prefix)) return true;
  }
  return false;
};

export const noUnusedVarsDisableInFlowLibdefs = defineRule<Rule>({
  id: "no-unused-vars-disable-in-flow-libdefs",
  severity: "warn",
  recommendation:
    "Keep Flow libdefs honest by removing the `no-unused-vars` suppression. If the symbol is meant to drive runtime behavior, use it from the code that owns the feature gate; otherwise move the declaration into generated typings instead of hand-suppressing it.",
  create: (context: RuleContext) => {
    const filename = context.getFilename?.() ?? "";

    return {
      Program(programNode: EsTreeNodeOfType<"Program">) {
        if (!filename) return;

        let sourceText = "";
        try {
          sourceText = fs.readFileSync(filename, "utf8");
        } catch {
          return;
        }

        if (!sourceText.includes("@flow")) return;

        const sourceLines = sourceText.split("\n");
        for (
          let lineIndex = 0;
          lineIndex < sourceLines.length - 1;
          lineIndex += 1
        ) {
          const lineText = sourceLines[lineIndex] ?? "";
          if (!lineText.includes(UNUSED_VARS_DISABLE_LINE)) continue;

          const nextLineText = sourceLines[lineIndex + 1] ?? "";
          if (!isDeclareBindingLine(nextLineText)) continue;

          const declarationLine = lineIndex + 2;
          const reportNode =
            findTopLevelNodeOnLine(programNode, declarationLine) ?? programNode;

          context.report({
            node: reportNode,
            message:
              "Inline `no-unused-vars` suppression before a Flow `declare` binding hides a handwritten ambient API change — remove the disable or move the declaration into generated typings.",
          });
        }
      },
    };
  },
});
```

---

<sub>
Generated by `rde discover` (see [millionco/react-doctor-evals#11](https://github.com/millionco/react-doctor-evals/pull/11) for the pipeline). Implementation, test fixtures, and rule registration are deliberately deferred — this PR exists for maintainer triage of the proposal only. Reject, edit-and-approve, or merge after wiring as you see fit.
</sub>
