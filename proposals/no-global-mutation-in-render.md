# Proposal: `react-doctor/no-global-mutation-in-render`

> **Status**: 🟡 Auto-discovered draft proposal. **Not yet implemented.** Maintainer review wanted before any code lands.

|                             |                                     |
| --------------------------- | ----------------------------------- |
| Category                    | `correctness`                       |
| Severity                    | `error`                             |
| Source clusters             | `NEW::no-global-mutation-in-render` |
| Independent draft proposals | 1                                   |
| Backing evidence units      | 1                                   |

## Sources

Discovered by the [react-doctor-evals discovery flywheel](https://github.com/millionco/react-doctor-evals/pull/11) mining bug-fix evidence across React OSS repos. The pipeline below produced this proposal:

```
OSS repo → Vercel Sandbox miner → EvidenceUnit → RuleDrafter (LLM) → RuleDedupe → THIS PR
```

### Backing evidence

- [`facebook/react` — `fixtures/eslint-v10/index.js` (DisableChurnMeta)](https://github.com/facebook/react/commit/e8c6362678c8bc86a02b8444d2c3f597b3dc4e22)

## Validation prompt

FP-aware guidance for the [react-review agent](https://github.com/millionco/react-review) when triaging this rule:

> Confirm the write happens in a React component or custom Hook render path, not inside `useEffect`, an event handler, or module setup code. Typical false positives are local scratch objects, ref bookkeeping, and imperative code that already lives behind a callback boundary. Ignore plain reads like `window.location` and any mutation that is clearly outside React render.

## Fix prompt

Actionable fix suggestion surfaced to the user when the rule fires:

> Move the mutation out of render. If it is a side effect, do it in `useEffect` or in the event handler that caused it; if it is UI state, store it in React state or a ref instead of a shared global.

```js
function Component() {
  useEffect(() => {
    window.myGlobal = 42;
  }, []);

  return <div />;
}
```

## Positive fixture (SHOULD trigger)

```tsx
function Component() {
  window.myGlobal = 42;
  return <div />;
}
```

## Negative fixture (should NOT trigger)

```tsx
function Component() {
  useEffect(() => {
    window.myGlobal = 42;
  }, []);
  return <div />;
}
```

## Proposed AST detector

Would land at `packages/oxlint-plugin-react-doctor/src/plugin/rules/correctness/no-global-mutation-in-render.ts`:

```ts
import { MUTABLE_GLOBAL_ROOTS } from "../../constants/dom.js";
import { defineRule } from "../../utils/define-rule.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactComponentOrHookName } from "../../utils/is-react-component-or-hook-name.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";

const MUTABLE_GLOBAL_ROOTS_WITH_GLOBAL_THIS = new Set([
  ...MUTABLE_GLOBAL_ROOTS,
  "globalThis",
]);

const isFunctionLikeNode = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "FunctionDeclaration") ||
  isNodeOfType(node, "FunctionExpression") ||
  isNodeOfType(node, "ArrowFunctionExpression");

const reportGlobalMutation = (
  context: RuleContext,
  mutationNode: EsTreeNode,
  globalRootName: string
): void => {
  context.report({
    node: mutationNode,
    message: `Mutation of global "${globalRootName}.*" inside a React component or Hook — move the write into useEffect or an event handler`,
  });
};

const checkMutableGlobalWrite = (
  context: RuleContext,
  expression: EsTreeNode
): void => {
  if (isNodeOfType(expression, "AssignmentExpression")) {
    if (!isNodeOfType(expression.left, "MemberExpression")) return;
    const rootName = getRootIdentifierName(expression.left);
    if (!rootName || !MUTABLE_GLOBAL_ROOTS_WITH_GLOBAL_THIS.has(rootName))
      return;
    reportGlobalMutation(context, expression, rootName);
    return;
  }

  if (isNodeOfType(expression, "UpdateExpression")) {
    const rootName = getRootIdentifierName(expression.argument);
    if (!rootName || !MUTABLE_GLOBAL_ROOTS_WITH_GLOBAL_THIS.has(rootName))
      return;
    reportGlobalMutation(context, expression, rootName);
    return;
  }

  if (
    isNodeOfType(expression, "UnaryExpression") &&
    expression.operator === "delete"
  ) {
    if (!isNodeOfType(expression.argument, "MemberExpression")) return;
    const rootName = getRootIdentifierName(expression.argument);
    if (!rootName || !MUTABLE_GLOBAL_ROOTS_WITH_GLOBAL_THIS.has(rootName))
      return;
    reportGlobalMutation(context, expression, rootName);
  }
};

const checkComponentBody = (
  componentBody: EsTreeNode | null | undefined,
  context: RuleContext
): void => {
  if (!componentBody) return;

  walkAst(componentBody, (child: EsTreeNode) => {
    if (isFunctionLikeNode(child) && child !== componentBody) return false;

    if (
      isNodeOfType(child, "AssignmentExpression") ||
      isNodeOfType(child, "UpdateExpression") ||
      (isNodeOfType(child, "UnaryExpression") && child.operator === "delete")
    ) {
      checkMutableGlobalWrite(context, child);
    }
  });
};

const isReactFunctionLikeDeclaration = (
  node: EsTreeNodeOfType<"FunctionDeclaration">
): boolean =>
  Boolean(node.id?.name) && isReactComponentOrHookName(node.id.name);

const isReactFunctionLikeAssignment = (
  node: EsTreeNodeOfType<"VariableDeclarator">
): boolean =>
  isNodeOfType(node.id, "Identifier") &&
  isReactComponentOrHookName(node.id.name) &&
  (isNodeOfType(node.init, "ArrowFunctionExpression") ||
    isNodeOfType(node.init, "FunctionExpression"));

export const noGlobalMutationInRender = defineRule<Rule>({
  id: "no-global-mutation-in-render",
  severity: "error",
  category: "Correctness",
  recommendation:
    "Move the write into useEffect or an event handler, or keep the value in React state/ref instead of mutating a shared global during render.",
  create: (context: RuleContext) => ({
    FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
      if (!isReactFunctionLikeDeclaration(node)) return;
      checkComponentBody(node.body, context);
    },
    VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
      if (!isReactFunctionLikeAssignment(node)) return;
      if (!node.init) return;
      checkComponentBody(node.init.body, context);
    },
  }),
});
```

---

<sub>
Generated by `rde discover` (see [millionco/react-doctor-evals#11](https://github.com/millionco/react-doctor-evals/pull/11) for the pipeline). Implementation, test fixtures, and rule registration are deliberately deferred — this PR exists for maintainer triage of the proposal only. Reject, edit-and-approve, or merge after wiring as you see fit.
</sub>
