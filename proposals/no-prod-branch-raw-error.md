# Proposal: `react-doctor/no-prod-branch-raw-error`

> **Status**: 🟡 Auto-discovered draft proposal. **Not yet implemented.** Maintainer review wanted before any code lands.

|                             |                                 |
| --------------------------- | ------------------------------- |
| Category                    | `correctness`                   |
| Severity                    | `warn`                          |
| Source clusters             | `NEW::no-prod-branch-raw-error` |
| Independent draft proposals | 1                               |
| Backing evidence units      | 1                               |

## Sources

Discovered by the [react-doctor-evals discovery flywheel](https://github.com/millionco/react-doctor-evals/pull/11) mining bug-fix evidence across React OSS repos. The pipeline below produced this proposal:

```
OSS repo → Vercel Sandbox miner → EvidenceUnit → RuleDrafter (LLM) → RuleDedupe → THIS PR
```

### Backing evidence

- [`facebook/react` — `packages/react-client/src/ReactClientDebugConfigNode.js` (DisableChurnMeta)](https://github.com/facebook/react/commit/ed4bd540ca67f1c4db65f009ad726a5ae1a0af01)

## Validation prompt

FP-aware guidance for the [react-review agent](https://github.com/millionco/react-review) when triaging this rule:

> Flag only branches that are clearly production-only, such as `if (!__DEV__)`, `if (__DEV__) else`, or `process.env.NODE_ENV === 'production'`, and only when they throw a built-in `Error` type directly. Do not flag dev-only assertions, test fixtures, or branches that mention production in a string but are not runtime guards. If the branch throws through a custom helper or a framework-specific invariant wrapper, treat it as a likely false positive unless the raw built-in error is visible in the AST.

## Fix prompt

Actionable fix suggestion surfaced to the user when the rule fires:

> If the failure is only meant for debugging, move it behind `__DEV__` so production never sees the throw. If it must execute in production, route it through the shared error-code helper instead of a raw `Error`.

```ts
if (__DEV__) {
  throw new Error("eval() is not supported in this environment.");
}

// or, for real production failures:
invariant(false, ERR_EVAL_DISABLED);
```

## Positive fixture (SHOULD trigger)

```tsx
export function Example() {
  if (!__DEV__) {
    throw new Error("This should never happen.");
  }

  return null;
}
```

## Negative fixture (should NOT trigger)

```tsx
export function Example() {
  if (__DEV__) {
    throw new Error("Dev-only assertion.");
  }

  return null;
}
```

## Proposed AST detector

Would land at `packages/oxlint-plugin-react-doctor/src/plugin/rules/correctness/no-prod-branch-raw-error.ts`:

```ts
import { defineRule } from "../../utils/define-rule.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const BUILTIN_ERROR_CONSTRUCTOR_NAMES = new Set([
  "Error",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
  "AggregateError",
]);

const isDevIdentifier = (node: EsTreeNode | null | undefined): boolean =>
  isNodeOfType(node, "Identifier") && node.name === "__DEV__";

const isProcessEnvNodeEnvAccess = (
  node: EsTreeNode | null | undefined
): boolean => {
  if (!isNodeOfType(node, "MemberExpression") || node.computed) return false;
  if (
    !isNodeOfType(node.property, "Identifier") ||
    node.property.name !== "NODE_ENV"
  ) {
    return false;
  }
  if (!isNodeOfType(node.object, "MemberExpression") || node.object.computed)
    return false;
  if (
    !isNodeOfType(node.object.property, "Identifier") ||
    node.object.property.name !== "env"
  ) {
    return false;
  }
  return (
    isNodeOfType(node.object.object, "Identifier") &&
    node.object.object.name === "process"
  );
};

const isProductionLiteral = (node: EsTreeNode | null | undefined): boolean =>
  isNodeOfType(node, "Literal") && node.value === "production";

const getProductionBranch = (
  node: EsTreeNodeOfType<"IfStatement">
): EsTreeNode | null => {
  const test = stripParenExpression(node.test);

  if (isDevIdentifier(test)) return node.alternate ?? null;
  if (
    isNodeOfType(test, "UnaryExpression") &&
    test.operator === "!" &&
    isDevIdentifier(test.argument)
  ) {
    return node.consequent;
  }
  if (!isNodeOfType(test, "BinaryExpression")) return null;
  if (test.operator !== "===" && test.operator !== "!==") return null;

  const left = stripParenExpression(test.left);
  const right = stripParenExpression(test.right);
  const isEnvComparison =
    (isProcessEnvNodeEnvAccess(left) && isProductionLiteral(right)) ||
    (isProcessEnvNodeEnvAccess(right) && isProductionLiteral(left));
  if (!isEnvComparison) return null;

  return test.operator === "===" ? node.consequent : node.alternate ?? null;
};

const isBuiltinErrorConstructor = (
  node: EsTreeNode | null | undefined
): boolean => {
  if (!isNodeOfType(node, "NewExpression")) return false;
  if (!isNodeOfType(node.callee, "Identifier")) return false;
  return BUILTIN_ERROR_CONSTRUCTOR_NAMES.has(node.callee.name);
};

const findRawErrorThrow = (node: EsTreeNode): EsTreeNode | null => {
  let foundThrow: EsTreeNode | null = null;

  walkAst(node, (child: EsTreeNode) => {
    if (foundThrow) return false;
    if (
      isNodeOfType(child, "FunctionDeclaration") ||
      isNodeOfType(child, "FunctionExpression") ||
      isNodeOfType(child, "ArrowFunctionExpression") ||
      isNodeOfType(child, "ClassDeclaration") ||
      isNodeOfType(child, "ClassExpression")
    ) {
      return false;
    }
    if (!isNodeOfType(child, "ThrowStatement")) return;
    if (!isBuiltinErrorConstructor(child.argument)) return;
    foundThrow = child;
    return false;
  });

  return foundThrow;
};

export const noProdBranchRawError = defineRule<Rule>({
  id: "no-prod-branch-raw-error",
  severity: "warn",
  recommendation:
    "Move debug-only failures behind `__DEV__`, or use the shared production error helper / error-code machinery for failures that must run in production",
  create: (context: RuleContext) => ({
    IfStatement(node: EsTreeNodeOfType<"IfStatement">) {
      const productionBranch = getProductionBranch(node);
      if (!productionBranch) return;

      const rawErrorThrow = findRawErrorThrow(productionBranch);
      if (!rawErrorThrow) return;

      context.report({
        node: rawErrorThrow,
        message:
          "Raw `Error` throw in a production-only branch — keep this path dev-only or route it through the shared production error helper instead of suppressing prod-error-codes",
      });
    },
  }),
});
```

---

<sub>
Generated by `rde discover` (see [millionco/react-doctor-evals#11](https://github.com/millionco/react-doctor-evals/pull/11) for the pipeline). Implementation, test fixtures, and rule registration are deliberately deferred — this PR exists for maintainer triage of the proposal only. Reject, edit-and-approve, or merge after wiring as you see fit.
</sub>
