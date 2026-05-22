# Proposal: `react-doctor/no-unnecessary-no-undef-disable`

> **Status**: 🟡 Auto-discovered draft proposal. **Not yet implemented.** Maintainer review wanted before any code lands.

|                             |                                        |
| --------------------------- | -------------------------------------- |
| Category                    | `correctness`                          |
| Severity                    | `warn`                                 |
| Source clusters             | `NEW::no-unnecessary-no-undef-disable` |
| Independent draft proposals | 1                                      |
| Backing evidence units      | 1                                      |

## Sources

Discovered by the [react-doctor-evals discovery flywheel](https://github.com/millionco/react-doctor-evals/pull/11) mining bug-fix evidence across React OSS repos. The pipeline below produced this proposal:

```
OSS repo → Vercel Sandbox miner → EvidenceUnit → RuleDrafter (LLM) → RuleDedupe → THIS PR
```

### Backing evidence

- [`facebook/react` — `packages/internal-test-utils/internalAct.js` (DisableChurnMeta)](https://github.com/facebook/react/commit/74568e8627aa43469b74f2972f427a209639d0b6)

## Validation prompt

FP-aware guidance for the [react-review agent](https://github.com/millionco/react-review) when triaging this rule:

> Check whether the finding is specifically an `eslint-disable-next-line no-undef` comment placed immediately before code that already guards the global with `typeof` or an equivalent existence check. Do not flag disables that protect truly unresolved names, platform-specific shims without a guard, or comments aimed at a different lint rule. Also ignore cases where the next line is not the guarded use or where the identifier is only mentioned in a type position.

## Fix prompt

Actionable fix suggestion surfaced to the user when the rule fires:

> Remove the unnecessary `no-undef` suppression and keep the guard. The runtime check already prevents dereferencing an undeclared global, so the linter comment just adds noise.

```js
if (typeof AggregateError === "function") {
  return new AggregateError(errors);
}
```

## Positive fixture (SHOULD trigger)

```tsx
function makeAggregateError(errors) {
  // eslint-disable-next-line no-undef
  if (typeof AggregateError === "function") {
    return new AggregateError(errors);
  }
  return errors[0];
}
```

## Negative fixture (should NOT trigger)

```tsx
function makeAggregateError(errors) {
  if (typeof AggregateError === "function") {
    return new AggregateError(errors);
  }
  return errors[0];
}
```

## Proposed AST detector

Would land at `packages/oxlint-plugin-react-doctor/src/plugin/rules/correctness/no-unnecessary-no-undef-disable.ts`:

````ts
import { defineRule } from "../../utils/define-rule.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

interface CommentLike {
  value?: string;
  loc?: {
    start?: {
      line?: number;
    };
    end?: {
      line?: number;
    };
  };
}

interface ProgramWithComments {
  comments?: ReadonlyArray<CommentLike>;
}

interface NodeWithLoc {
  loc?: {
    start?: {
      line?: number;
    };
  };
}

const isStatementLikeNode = (node: EsTreeNode): boolean =>
  node.type.endsWith("Statement") || node.type.endsWith("Declaration");

const hasNoUndefDisable = (comment: CommentLike): boolean => {
  const text = comment.value?.toLowerCase().trim() ?? "";
  return text.includes("eslint-disable-next-line") && text.includes("no-undef");
};

const collectTypeofGuardedNames = (root: EsTreeNode): ReadonlySet<string> => {
  const guardedNames = new Set<string>();
  walkAst(root, (child) => {
    if (!isNodeOfType(child, "UnaryExpression") || child.operator !== "typeof")
      return;
    const argument = stripParenExpression(child.argument);
    if (!isNodeOfType(argument, "Identifier")) return;
    guardedNames.add(argument.name);
  });
  return guardedNames;
};

const collectGuardedNamesFromPath = (node: EsTreeNode): ReadonlySet<string> => {
  const guardedNames = new Set<string>();
  let current: EsTreeNode | null | undefined = node;
  while (current) {
    for (const guardedName of collectTypeofGuardedNames(current)) {
      guardedNames.add(guardedName);
    }
    current = current.parent ?? null;
  }
  return guardedNames;
};

const collectReferencedNames = (root: EsTreeNode): ReadonlySet<string> => {
  const referencedNames = new Set<string>();
  walkAst(root, (child) => {
    if (!isNodeOfType(child, "Identifier")) return;
    const parent = child.parent;
    if (
      isNodeOfType(parent, "MemberExpression") &&
      parent.property === child &&
      !parent.computed
    )
      return;
    if (
      isNodeOfType(parent, "Property") &&
      parent.key === child &&
      !parent.computed
    )
      return;
    if (isNodeOfType(parent, "MethodDefinition") && parent.key === child)
      return;
    referencedNames.add(child.name);
  });
  return referencedNames;
};

const getNextStatementNode = (
  program: EsTreeNode,
  commentLine: number
): EsTreeNode | null => {
  let statementNode: EsTreeNode | null = null;
  walkAst(program, (child) => {
    if (!isStatementLikeNode(child)) return;
    const childLine = (child as NodeWithLoc).loc?.start?.line;
    if (childLine !== commentLine + 1) return;
    statementNode = child;
    return false;
  });
  return statementNode;
};

export const noUnnecessaryNoUndefDisable = defineRule<Rule>({
  id: "no-unnecessary-no-undef-disable",
  severity: "warn",
  recommendation:
    'Remove the `no-undef` disable and rely on the existing `typeof` guard, for example:\n\n```js\nif (typeof AggregateError === "function") {\n  return new AggregateError(errors);\n}\n```',
  create: (context: RuleContext) => ({
    Program(node: EsTreeNodeOfType<"Program">) {
      const program = node as ProgramWithComments;
      const comments = program.comments;
      if (!comments?.length) return;

      for (const comment of comments) {
        if (!hasNoUndefDisable(comment)) continue;

        const commentLine = comment.loc?.end?.line ?? comment.loc?.start?.line;
        if (typeof commentLine !== "number") continue;

        const statementNode = getNextStatementNode(node, commentLine);
        if (!statementNode) continue;

        const guardedNames = collectGuardedNamesFromPath(statementNode);
        if (guardedNames.size === 0) continue;

        const referencedNames = collectReferencedNames(statementNode);
        let shouldReport = false;
        for (const name of guardedNames) {
          if (referencedNames.has(name)) {
            shouldReport = true;
            break;
          }
        }
        if (!shouldReport) continue;

        context.report({
          node: statementNode,
          message:
            "`eslint-disable-next-line no-undef` is unnecessary here — the `typeof` guard already protects this global reference",
        });
      }
    },
  }),
});
````

---

<sub>
Generated by `rde discover` (see [millionco/react-doctor-evals#11](https://github.com/millionco/react-doctor-evals/pull/11) for the pipeline). Implementation, test fixtures, and rule registration are deliberately deferred — this PR exists for maintainer triage of the proposal only. Reject, edit-and-approve, or merge after wiring as you see fit.
</sub>
