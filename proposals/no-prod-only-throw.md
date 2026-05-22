# Proposal: `react-doctor/no-prod-only-throw`

> **Status**: 🟡 Auto-discovered draft proposal. **Not yet implemented.** Maintainer review wanted before any code lands.

|                             |                           |
| --------------------------- | ------------------------- |
| Category                    | `correctness`             |
| Severity                    | `warn`                    |
| Source clusters             | `NEW::no-prod-only-throw` |
| Independent draft proposals | 1                         |
| Backing evidence units      | 1                         |

## Sources

Discovered by the [react-doctor-evals discovery flywheel](https://github.com/millionco/react-doctor-evals/pull/11) mining bug-fix evidence across React OSS repos. The pipeline below produced this proposal:

```
OSS repo → Vercel Sandbox miner → EvidenceUnit → RuleDrafter (LLM) → RuleDedupe → THIS PR
```

### Backing evidence

- [`facebook/react` — `packages/react-client/src/ReactClientDebugConfigBrowser.js` (DisableChurnMeta)](https://github.com/facebook/react/commit/ed4bd540ca67f1c4db65f009ad726a5ae1a0af01)

## Validation prompt

FP-aware guidance for the [react-review agent](https://github.com/millionco/react-review) when triaging this rule:

> Treat this as a real issue when a `throw` only exists in the production branch of a `__DEV__` guard, because development and tests will never exercise that path. Typical false positives are intentional invariant crashes that are meant to kill production builds, generated framework code, or branches that only log or return a fallback instead of throwing. If the throw is on the dev side, or both branches can fail, this rule should not fire.

## Fix prompt

Actionable fix suggestion surfaced to the user when the rule fires:

> Move the invariant or error check so it runs in both environments, and keep `__DEV__` only for debug-only work. For example:

```ts
if (!isValid) {
  throw new Error("Invalid state");
}
if (__DEV__) {
  debugValidateExtraState();
}
```

## Positive fixture (SHOULD trigger)

```tsx
export function Example() {
  if (__DEV__) {
    return null;
  }

  throw new Error("This only fails in production");
}
```

## Negative fixture (should NOT trigger)

```tsx
export function Example() {
  if (__DEV__) {
    throw new Error("Dev-only debug failure");
  }

  return null;
}
```

## Proposed AST detector

Would land at `packages/oxlint-plugin-react-doctor/src/plugin/rules/correctness/no-prod-only-throw.ts`:

```ts
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const isFunctionLikeNode = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "FunctionDeclaration") ||
  isNodeOfType(node, "FunctionExpression") ||
  isNodeOfType(node, "ArrowFunctionExpression");

const isDevIdentifier = (node: EsTreeNode | null | undefined): boolean =>
  Boolean(isNodeOfType(node, "Identifier") && node.name === "__DEV__");

const getProductionBranch = (
  testNode: EsTreeNode,
  consequent: EsTreeNode,
  alternate: EsTreeNode | null | undefined
): EsTreeNode | null => {
  if (isDevIdentifier(testNode)) {
    return alternate ?? null;
  }

  if (
    isNodeOfType(testNode, "UnaryExpression") &&
    testNode.operator === "!" &&
    isDevIdentifier(testNode.argument)
  ) {
    return consequent;
  }

  return null;
};

const findThrowStatement = (node: EsTreeNode): EsTreeNode | null => {
  let throwNode: EsTreeNode | null = null;

  walkAst(node, (child: EsTreeNode) => {
    if (throwNode) return false;
    if (isFunctionLikeNode(child) && child !== node) return false;
    if (isNodeOfType(child, "ThrowStatement")) {
      throwNode = child;
      return false;
    }
  });

  return throwNode;
};

export const noProdOnlyThrow = defineRule<Rule>({
  id: "no-prod-only-throw",
  severity: "warn",
  recommendation:
    "Move the failure out of the production-only branch so development exercises the same invariant. If the condition is truly impossible, keep the assertion shared across both environments instead of hiding it behind `__DEV__`.",
  create: (context: RuleContext) => ({
    IfStatement(node: EsTreeNodeOfType<"IfStatement">) {
      if (!node.test || !node.consequent) return;
      const productionBranch = getProductionBranch(
        node.test,
        node.consequent,
        node.alternate
      );
      if (!productionBranch) return;

      const throwNode = findThrowStatement(productionBranch);
      if (!throwNode) return;

      context.report({
        node: throwNode,
        message:
          "Production-only throw behind a `__DEV__` guard — this failure never runs in development",
      });
    },
  }),
});
```

---

<sub>
Generated by `rde discover` (see [millionco/react-doctor-evals#11](https://github.com/millionco/react-doctor-evals/pull/11) for the pipeline). Implementation, test fixtures, and rule registration are deliberately deferred — this PR exists for maintainer triage of the proposal only. Reject, edit-and-approve, or merge after wiring as you see fit.
</sub>
