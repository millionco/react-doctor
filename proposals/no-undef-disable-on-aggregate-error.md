# Proposal: `react-doctor/no-undef-disable-on-aggregate-error`

> **Status**: 🟡 Auto-discovered draft proposal. **Not yet implemented.** Maintainer review wanted before any code lands.

|                             |                                            |
| --------------------------- | ------------------------------------------ |
| Category                    | `correctness`                              |
| Severity                    | `warn`                                     |
| Source clusters             | `NEW::no-undef-disable-on-aggregate-error` |
| Independent draft proposals | 1                                          |
| Backing evidence units      | 1                                          |

## Sources

Discovered by the [react-doctor-evals discovery flywheel](https://github.com/millionco/react-doctor-evals/pull/11) mining bug-fix evidence across React OSS repos. The pipeline below produced this proposal:

```
OSS repo → Vercel Sandbox miner → EvidenceUnit → RuleDrafter (LLM) → RuleDedupe → THIS PR
```

### Backing evidence

- [`facebook/react` — `packages/internal-test-utils/ReactInternalTestUtils.js` (DisableChurnMeta)](https://github.com/facebook/react/commit/74568e8627aa43469b74f2972f427a209639d0b6)

## Validation prompt

FP-aware guidance for the [react-review agent](https://github.com/millionco/react-review) when triaging this rule:

> Check whether the finding is really a redundant `no-undef` suppression on a feature-detected global constructor. Common false positives are local bindings named `AggregateError`, code that genuinely targets runtimes without the constructor and needs a different fallback, or a disable comment that applies to another undeclared symbol on the same line. If the file is test-only or generated, treat the warning as lower priority unless it ships to users.

## Fix prompt

Actionable fix suggestion surfaced to the user when the rule fires:

> Remove the `eslint-disable-next-line no-undef` comment and keep the runtime feature check. The guard is enough to avoid calling `AggregateError` when it is unavailable.

```ts
if (errors.length > 1 && typeof AggregateError === "function") {
  return new AggregateError(errors);
}
```

## Positive fixture (SHOULD trigger)

```tsx
function aggregateErrors(errors) {
  if (errors.length > 1 && typeof AggregateError === "function") {
    // eslint-disable-next-line no-undef
    return new AggregateError(errors);
  }

  return errors[0];
}
```

## Negative fixture (should NOT trigger)

```tsx
function aggregateErrors(errors) {
  if (errors.length > 1 && typeof AggregateError === "function") {
    return new AggregateError(errors);
  }

  return errors[0];
}
```

## Proposed AST detector

Would land at `packages/oxlint-plugin-react-doctor/src/plugin/rules/correctness/no-undef-disable-on-aggregate-error.ts`:

```ts
import fs from "node:fs";
import { defineRule } from "../../utils/define-rule.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const AGGREGATE_ERROR_NAME = "AggregateError";
const NO_UNDEF_DISABLE_PATTERN = /eslint-disable-next-line\s+no-undef\b/;

const isAggregateErrorTypeofCheck = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "BinaryExpression")) return false;
  if (node.operator !== "===" && node.operator !== "==") return false;

  const isAggregateErrorTypeofExpression = (expression: EsTreeNode): boolean =>
    isNodeOfType(expression, "UnaryExpression") &&
    expression.operator === "typeof" &&
    isNodeOfType(expression.argument, "Identifier") &&
    expression.argument.name === AGGREGATE_ERROR_NAME &&
    findVariableInitializer(expression, AGGREGATE_ERROR_NAME) === null;

  const isFunctionLiteral = (expression: EsTreeNode): boolean =>
    isNodeOfType(expression, "Literal") && expression.value === "function";

  return (
    (isAggregateErrorTypeofExpression(node.left) &&
      isFunctionLiteral(node.right)) ||
    (isAggregateErrorTypeofExpression(node.right) &&
      isFunctionLiteral(node.left))
  );
};

const containsAggregateErrorGuard = (node: EsTreeNode): boolean => {
  let didFindGuard = false;
  walkAst(node, (child: EsTreeNode) => {
    if (didFindGuard) return false;
    if (isAggregateErrorTypeofCheck(child)) didFindGuard = true;
  });
  return didFindGuard;
};

const isInsideGuardedIfStatement = (node: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = node.parent ?? null;
  while (current) {
    if (
      isNodeOfType(current, "IfStatement") &&
      containsAggregateErrorGuard(current.test)
    ) {
      let cursor: EsTreeNode | null | undefined = node;
      while (cursor && cursor !== current) {
        if (cursor === current.consequent) return true;
        cursor = cursor.parent ?? null;
      }
    }
    current = current.parent ?? null;
  }
  return false;
};

const hasNoUndefDisableImmediatelyAbove = (
  sourceLines: ReadonlyArray<string>,
  lineNumber: number
): boolean => {
  const previousLine = sourceLines[lineNumber - 2];
  if (!previousLine) return false;
  return NO_UNDEF_DISABLE_PATTERN.test(previousLine.trim());
};

export const noUndefDisableOnAggregateError = defineRule<Rule>({
  id: "no-undef-disable-on-aggregate-error",
  severity: "warn",
  recommendation:
    "Remove the `eslint-disable-next-line no-undef` comment and keep the `typeof AggregateError === 'function'` guard. If you still need legacy runtime support, handle it with a fallback or polyfill instead of suppressing the check.",
  create: (context: RuleContext) => {
    const filename = context.getFilename?.();
    if (!filename) return {};

    let sourceLines: ReadonlyArray<string> = [];
    try {
      sourceLines = fs.readFileSync(filename, "utf8").split(/\r?\n/);
    } catch {
      return {};
    }

    return {
      ReturnStatement(node: EsTreeNodeOfType<"ReturnStatement">) {
        if (!node.argument || !isNodeOfType(node.argument, "NewExpression"))
          return;
        if (!isNodeOfType(node.argument.callee, "Identifier")) return;
        if (node.argument.callee.name !== AGGREGATE_ERROR_NAME) return;
        if (findVariableInitializer(node, AGGREGATE_ERROR_NAME)) return;
        if (!isInsideGuardedIfStatement(node)) return;

        const lineNumber = node.loc?.start.line;
        if (!lineNumber) return;
        if (!hasNoUndefDisableImmediatelyAbove(sourceLines, lineNumber)) return;

        context.report({
          node: node.argument,
          message:
            "Unnecessary `eslint-disable-next-line no-undef` before `new AggregateError(...)` — the `typeof AggregateError === 'function'` guard already makes this safe.",
        });
      },
    };
  },
});
```

---

<sub>
Generated by `rde discover` (see [millionco/react-doctor-evals#11](https://github.com/millionco/react-doctor-evals/pull/11) for the pipeline). Implementation, test fixtures, and rule registration are deliberately deferred — this PR exists for maintainer triage of the proposal only. Reject, edit-and-approve, or merge after wiring as you see fit.
</sub>
