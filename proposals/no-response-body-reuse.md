# Proposal: `react-doctor/no-response-body-reuse`

> **Status**: 🟡 Auto-discovered draft proposal. **Not yet implemented.** Maintainer review wanted before any code lands.

|                        |                               |
| ---------------------- | ----------------------------- |
| Category               | `client`                      |
| Severity               | `error`                       |
| Source cluster         | `NEW::no-response-body-reuse` |
| Backing evidence units | 1                             |

## Why the bug exists

> The developer assumed `response.json()` behaves like an idempotent parse of cached data. Fetch bodies are one-shot streams, so the first read consumes the body and a later read rejects or loses the more specific payload.

## Generality check

> Any React client code that uses fetch in effects, event handlers, or API helpers can make this mistake when status-specific parsing falls through to a generic handler. The pattern depends only on standard Fetch body semantics, not on this repository's endpoints or domain objects.

## Sources

Discovered by the [react-doctor-evals discovery flywheel](https://github.com/millionco/react-doctor-evals/pull/11) mining bug-fix evidence across React OSS repos. This proposal was sourced from the **accepted-review** signal (a reviewer commented + the author edited the file in response + the thread was marked resolved). Pipeline:

```
OSS repo -> GitHub GraphQL (PR review threads) -> acceptance filter (file changed between comment SHA and merge SHA) -> EvidenceUnit -> DraftAgent (gpt-5.5, xhigh reasoning) -> RuleDedupe -> THIS PR
```

### Backing evidence

- [`srbhr/Resume-Matcher` - `apps/frontend/lib/api/config.ts` (AcceptedReviewFixMeta)](https://github.com/srbhr/Resume-Matcher/pull/757#discussion_r3101761477) — reviewer: bot @cubic-dev-ai · PR #757 · signal: resolved-and-changed
  > <!-- metadata:{"confidence":9} -->

## Validation prompt

FP-aware guidance for the [react-review agent](https://github.com/millionco/react-review) when triaging this rule:

> Confirm that both calls read the same Fetch Response or Request body and that one control-flow path can execute both reads. Do not flag when the first read is from `response.clone()` or when the parsed body is cached and reused instead of reread. Typical false positives are branches that are mutually exclusive or always terminating in a way the detector missed, and identifiers that are reassigned or shadowed with a different object before the later read.

## Fix prompt

> Read a Fetch body only once, then reuse the parsed value. If you need to inspect an error body before a later generic handler, read from a clone for the first pass. Example: `const preview = await response.clone().json().catch(() => null); if (preview?.message) throw new Error(preview.message); const data = await response.json();`.

## Positive fixture (SHOULD trigger)

```tsx
import { useEffect } from "react";

function Component() {
  useEffect(() => {
    async function load() {
      const response = await fetch("/api/data");
      if (response.status === 400) {
        const data = await response.json().catch(() => ({}));
        if (data.message) return;
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message ?? "Request failed");
      }
    }

    load();
  }, []);

  return null;
}
```

## Negative fixture (should NOT trigger)

```tsx
import { useEffect } from "react";

function Component() {
  useEffect(() => {
    async function load() {
      const response = await fetch("/api/data");
      if (response.status === 400) {
        const data = await response
          .clone()
          .json()
          .catch(() => ({}));
        if (data.message) return;
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message ?? "Request failed");
      }
    }

    load();
  }, []);

  return null;
}
```

## Proposed AST detector

Would land at `packages/oxlint-plugin-react-doctor/src/plugin/rules/client/no-response-body-reuse.ts`:

```ts
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";

const BODY_READER_METHODS = new Set(["arrayBuffer", "blob", "bytes", "formData", "json", "text"]);

const EXECUTION_BOUNDARY_NODE_TYPES = new Set([
  "ArrowFunctionExpression",
  "ClassDeclaration",
  "ClassExpression",
  "FunctionDeclaration",
  "FunctionExpression",
]);

interface BodyRead {
  bodyOwnerName: string;
  methodName: string;
  node: EsTreeNodeOfType<"CallExpression">;
}

const isExecutionBoundary = (node: EsTreeNode): boolean =>
  EXECUTION_BOUNDARY_NODE_TYPES.has(node.type);

const getStaticPropertyName = (node: unknown): string | null => {
  if (isNodeOfType(node, "Identifier")) return node.name;
  if (isNodeOfType(node, "Literal") && typeof node.value === "string") return node.value;
  return null;
};

const getBodyRead = (node: EsTreeNode): BodyRead | null => {
  if (!isNodeOfType(node, "CallExpression")) return null;
  if (!isNodeOfType(node.callee, "MemberExpression")) return null;

  const methodName = getStaticPropertyName(node.callee.property);
  if (!methodName || !BODY_READER_METHODS.has(methodName)) return null;
  if (!isNodeOfType(node.callee.object, "Identifier")) return null;

  return {
    bodyOwnerName: node.callee.object.name,
    methodName,
    node,
  };
};

const collectBodyReads = (node: EsTreeNode): BodyRead[] => {
  const bodyReads: BodyRead[] = [];

  walkAst(node, (child) => {
    if (child !== node && isExecutionBoundary(child)) return false;

    const bodyRead = getBodyRead(child);
    if (bodyRead) bodyReads.push(bodyRead);
  });

  return bodyReads;
};

const statementAlwaysExits = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return false;
  if (isNodeOfType(node, "ReturnStatement") || isNodeOfType(node, "ThrowStatement")) return true;

  if (isNodeOfType(node, "BlockStatement")) {
    return node.body.some((statement) => statementAlwaysExits(statement));
  }

  if (isNodeOfType(node, "IfStatement")) {
    return Boolean(
      node.alternate &&
      statementAlwaysExits(node.consequent) &&
      statementAlwaysExits(node.alternate),
    );
  }

  if (isNodeOfType(node, "TryStatement")) {
    if (statementAlwaysExits(node.finalizer)) return true;
    return Boolean(
      statementAlwaysExits(node.block) && node.handler && statementAlwaysExits(node.handler.body),
    );
  }

  return false;
};

const collectContinuingBodyReads = (node: EsTreeNode): BodyRead[] => {
  if (statementAlwaysExits(node)) return [];

  if (isNodeOfType(node, "BlockStatement")) {
    const bodyReads: BodyRead[] = [];

    for (const statement of node.body) {
      bodyReads.push(...collectContinuingBodyReads(statement));
      if (statementAlwaysExits(statement)) break;
    }

    return bodyReads;
  }

  if (isNodeOfType(node, "IfStatement")) {
    const bodyReads = collectBodyReads(node.test);
    bodyReads.push(...collectContinuingBodyReads(node.consequent));
    if (node.alternate) bodyReads.push(...collectContinuingBodyReads(node.alternate));
    return bodyReads;
  }

  if (isNodeOfType(node, "TryStatement")) return [];

  return collectBodyReads(node);
};

const collectAssignedIdentifierNames = (node: EsTreeNode): Set<string> => {
  const assignedNames = new Set<string>();

  walkAst(node, (child) => {
    if (child !== node && isExecutionBoundary(child)) return false;

    if (isNodeOfType(child, "VariableDeclarator") && isNodeOfType(child.id, "Identifier")) {
      assignedNames.add(child.id.name);
    }

    if (isNodeOfType(child, "AssignmentExpression") && isNodeOfType(child.left, "Identifier")) {
      assignedNames.add(child.left.name);
    }
  });

  return assignedNames;
};

const reportRepeatedReads = (
  bodyReads: BodyRead[],
  consumedBodyByOwnerName: Map<string, BodyRead>,
  context: RuleContext,
): void => {
  for (const bodyRead of bodyReads) {
    const previousRead = consumedBodyByOwnerName.get(bodyRead.bodyOwnerName);
    if (!previousRead) continue;

    context.report({
      node: bodyRead.node,
      message: `${bodyRead.bodyOwnerName}.${bodyRead.methodName}() reads a Fetch body after it was already consumed by ${previousRead.methodName}(); cache the parsed body or read the first pass from ${bodyRead.bodyOwnerName}.clone()`,
    });
  }
};

export const noResponseBodyReuse = defineRule<Rule>({
  id: "no-response-body-reuse",
  severity: "error",
  category: "Correctness",
  recommendation:
    "A Fetch Response/Request body is a one-shot stream. Cache the parsed body, or use response.clone() for an inspection read before a later body read.",
  create: (context: RuleContext) => ({
    BlockStatement(node: EsTreeNodeOfType<"BlockStatement">) {
      const consumedBodyByOwnerName = new Map<string, BodyRead>();

      for (const statement of node.body) {
        const bodyReads = collectBodyReads(statement);
        reportRepeatedReads(bodyReads, consumedBodyByOwnerName, context);

        const assignedNames = collectAssignedIdentifierNames(statement);
        for (const assignedName of assignedNames) {
          consumedBodyByOwnerName.delete(assignedName);
        }

        for (const bodyRead of collectContinuingBodyReads(statement)) {
          if (!assignedNames.has(bodyRead.bodyOwnerName)) {
            consumedBodyByOwnerName.set(bodyRead.bodyOwnerName, bodyRead);
          }
        }
      }
    },
  }),
});
```

---

<sub>
Generated by `rde discover` (v3: accepted-review evidence + WHY-reasoning + generality check + explicit abstain). See [millionco/react-doctor-evals#11](https://github.com/millionco/react-doctor-evals/pull/11) for the pipeline. Implementation, test fixtures, and rule registration are deliberately deferred — this PR exists for maintainer triage of the proposal only.
</sub>
