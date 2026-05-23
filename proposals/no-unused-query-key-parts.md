# Proposal: `react-doctor/no-unused-query-key-parts`

> **Status**: 🟡 Auto-discovered draft proposal. **Not yet implemented.** Maintainer review wanted before any code lands.

|                        |                                  |
| ---------------------- | -------------------------------- |
| Category               | `tanstack-query`                 |
| Severity               | `warn`                           |
| Source cluster         | `NEW::no-unused-query-key-parts` |
| Backing evidence units | 1                                |

## Why the bug exists

> The developer assumed that adding local input to the query key would make the query data vary with that input. In TanStack Query, the key controls caching and refetching only; the query function must still read or send the value for the fetched result to change.

## Generality check

> Query key/function drift is common in React apps that add form state, filters, or route state to a query key while the request is maintained separately. The same pattern causes unnecessary refetches and cache fragmentation in any app using query-keyed data fetching.

## Sources

Discovered by the [react-doctor-evals discovery flywheel](https://github.com/millionco/react-doctor-evals/pull/11) mining bug-fix evidence across React OSS repos. This proposal was sourced from the **accepted-review** signal (a reviewer commented + the author edited the file in response + the thread was marked resolved). Pipeline:

```
OSS repo -> GitHub GraphQL (PR review threads) -> acceptance filter (file changed between comment SHA and merge SHA) -> EvidenceUnit -> DraftAgent (gpt-5.5, xhigh reasoning) -> RuleDedupe -> THIS PR
```

### Backing evidence

- [`umami-software/umami` - `src/app/(main)/websites/[websiteId]/(reports)/funnels/FunnelEditForm.tsx` (AcceptedReviewFixMeta)](https://github.com/umami-software/umami/pull/4090#discussion_r2942939783) — reviewer: bot @greptile-apps · PR #4090 · signal: resolved-and-changed
  > **`searchValue` in queryKey but not in API call**

## Validation prompt

FP-aware guidance for the [react-review agent](https://github.com/millionco/react-review) when triaging this rule:

> Verify that the reported key part does not affect the data returned by the query function. False positives include query functions that consume `queryKey` indirectly through the TanStack Query context or a helper, and keys that intentionally scope cache entries because a hidden interceptor/global header changes the request. If the identifier only drives client-side filtering or UI state, the finding is likely valid.

## Fix prompt

> Either remove the unused value from `queryKey`, or pass it into `queryFn` so the fetched data actually depends on it. Example: `useQuery({ queryKey: ['items', { value }], queryFn: () => fetch('/api/items?value=' + encodeURIComponent(value)).then(response => response.json()) })`; if the server response is independent of `value`, use `queryKey: ['items']` and filter the cached data client-side.

## Positive fixture (SHOULD trigger)

```tsx
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

function Component() {
  const [value, setValue] = useState("");
  const result = useQuery({
    queryKey: ["items", { value }],
    queryFn: () => fetch("/api/items").then((response) => response.json()),
  });

  return <input value={value} onChange={(event) => setValue(event.currentTarget.value)} />;
}
```

## Negative fixture (should NOT trigger)

```tsx
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

function Component() {
  const [value, setValue] = useState("");
  const result = useQuery({
    queryKey: ["items", { value }],
    queryFn: () =>
      fetch("/api/items?value=" + encodeURIComponent(value)).then((response) => response.json()),
  });

  return <input value={value} onChange={(event) => setValue(event.currentTarget.value)} />;
}
```

## Proposed AST detector

Would land at `packages/oxlint-plugin-react-doctor/src/plugin/rules/tanstack-query/no-unused-query-key-parts.ts`:

```ts
import { TANSTACK_QUERY_HOOKS } from "../../constants/tanstack.js";
import { collectReferenceIdentifierNames } from "../../utils/collect-reference-identifier-names.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";

const getStaticPropertyName = (key: EsTreeNode | null | undefined): string | null => {
  if (isNodeOfType(key, "Identifier")) return key.name;
  if (isNodeOfType(key, "Literal") && typeof key.value === "string") return key.value;
  return null;
};

const findObjectPropertyValue = (
  objectExpression: EsTreeNodeOfType<"ObjectExpression">,
  propertyName: string,
): EsTreeNode | null => {
  for (const property of objectExpression.properties ?? []) {
    if (!isNodeOfType(property, "Property")) continue;
    if (property.computed) continue;
    if (getStaticPropertyName(property.key) !== propertyName) continue;
    return property.value;
  }
  return null;
};

const isQueryFunction = (
  node: EsTreeNode | null | undefined,
): node is EsTreeNodeOfType<"ArrowFunctionExpression"> | EsTreeNodeOfType<"FunctionExpression"> =>
  isNodeOfType(node, "ArrowFunctionExpression") || isNodeOfType(node, "FunctionExpression");

const collectQueryKeyIdentifierNames = (
  node: EsTreeNode | null | undefined,
  into: Set<string>,
): void => {
  if (!node) return;
  if (isNodeOfType(node, "Identifier")) {
    into.add(node.name);
    return;
  }
  if (isNodeOfType(node, "MemberExpression")) {
    collectQueryKeyIdentifierNames(node.object, into);
    if (node.computed) collectQueryKeyIdentifierNames(node.property, into);
    return;
  }
  if (isNodeOfType(node, "Property")) {
    if (node.computed) collectQueryKeyIdentifierNames(node.key, into);
    collectQueryKeyIdentifierNames(node.value, into);
    return;
  }
  if (isNodeOfType(node, "SpreadElement")) {
    collectQueryKeyIdentifierNames(node.argument, into);
    return;
  }
  if (isNodeOfType(node, "CallExpression")) {
    if (isNodeOfType(node.callee, "MemberExpression")) {
      collectQueryKeyIdentifierNames(node.callee.object, into);
      if (node.callee.computed) collectQueryKeyIdentifierNames(node.callee.property, into);
    }
    for (const argument of node.arguments ?? []) {
      collectQueryKeyIdentifierNames(argument, into);
    }
    return;
  }
  if (isNodeOfType(node, "NewExpression")) {
    for (const argument of node.arguments ?? []) {
      collectQueryKeyIdentifierNames(argument, into);
    }
    return;
  }
  if (
    isNodeOfType(node, "FunctionExpression") ||
    isNodeOfType(node, "ArrowFunctionExpression") ||
    isNodeOfType(node, "FunctionDeclaration")
  ) {
    return;
  }
  if (
    isNodeOfType(node, "TSAsExpression") ||
    isNodeOfType(node, "TSSatisfiesExpression") ||
    isNodeOfType(node, "TSTypeAssertion") ||
    isNodeOfType(node, "TSNonNullExpression") ||
    isNodeOfType(node, "TSInstantiationExpression")
  ) {
    collectQueryKeyIdentifierNames(node.expression, into);
    return;
  }
  if (typeof node.type === "string" && node.type.startsWith("TS")) return;
  for (const [key, child] of Object.entries(node)) {
    if (key === "parent") continue;
    if (Array.isArray(child)) {
      for (const item of child) {
        if (isAstNode(item)) collectQueryKeyIdentifierNames(item, into);
      }
    } else if (isAstNode(child)) {
      collectQueryKeyIdentifierNames(child, into);
    }
  }
};

const patternContainsQueryKey = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return false;
  if (isNodeOfType(node, "Identifier")) return node.name === "queryKey";
  if (isNodeOfType(node, "Property")) {
    if (!node.computed && getStaticPropertyName(node.key) === "queryKey") return true;
    return Boolean(
      (node.computed && patternContainsQueryKey(node.key)) || patternContainsQueryKey(node.value),
    );
  }
  if (isNodeOfType(node, "RestElement")) return patternContainsQueryKey(node.argument);
  if (isNodeOfType(node, "AssignmentPattern")) return patternContainsQueryKey(node.left);
  if (isNodeOfType(node, "ArrayPattern")) {
    return (node.elements ?? []).some((element) => patternContainsQueryKey(element));
  }
  if (isNodeOfType(node, "ObjectPattern")) {
    return (node.properties ?? []).some((property) => patternContainsQueryKey(property));
  }
  return false;
};

const queryFunctionReadsQueryKeyParameter = (
  queryFunction:
    | EsTreeNodeOfType<"ArrowFunctionExpression">
    | EsTreeNodeOfType<"FunctionExpression">,
): boolean => {
  for (const parameter of queryFunction.params ?? []) {
    if (patternContainsQueryKey(parameter)) return true;
  }

  const firstParameter = queryFunction.params?.[0];
  if (!isNodeOfType(firstParameter, "Identifier")) return false;

  let didReadQueryKey = false;
  walkAst(queryFunction.body, (child: EsTreeNode) => {
    if (didReadQueryKey) return false;
    if (
      isNodeOfType(child, "MemberExpression") &&
      isNodeOfType(child.object, "Identifier") &&
      child.object.name === firstParameter.name
    ) {
      if (isNodeOfType(child.property, "Identifier") && child.property.name === "queryKey") {
        didReadQueryKey = true;
        return false;
      }
      if (
        child.computed &&
        isNodeOfType(child.property, "Literal") &&
        child.property.value === "queryKey"
      ) {
        didReadQueryKey = true;
        return false;
      }
    }
    if (
      isNodeOfType(child, "VariableDeclarator") &&
      isNodeOfType(child.init, "Identifier") &&
      child.init.name === firstParameter.name &&
      patternContainsQueryKey(child.id)
    ) {
      didReadQueryKey = true;
      return false;
    }
  });
  return didReadQueryKey;
};

const formatIdentifierNames = (identifierNames: string[]): string => {
  const quotedNames = identifierNames.slice(0, 3).map((identifierName) => `\`${identifierName}\``);
  if (identifierNames.length > 3) quotedNames.push("...");
  return quotedNames.join(", ");
};

export const noUnusedQueryKeyParts = defineRule<Rule>({
  id: "no-unused-query-key-parts",
  tags: ["test-noise"],
  requires: ["tanstack-query"],
  severity: "warn",
  recommendation:
    "Remove values from queryKey that queryFn does not read, or pass those values into the request so the cache key matches the fetched data",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const calleeName = isNodeOfType(node.callee, "Identifier") ? node.callee.name : null;
      if (!calleeName || !TANSTACK_QUERY_HOOKS.has(calleeName)) return;

      const optionsArgument = node.arguments?.[0];
      if (!isNodeOfType(optionsArgument, "ObjectExpression")) return;

      const queryKeyValue = findObjectPropertyValue(optionsArgument, "queryKey");
      if (!isNodeOfType(queryKeyValue, "ArrayExpression")) return;

      const queryFnValue = findObjectPropertyValue(optionsArgument, "queryFn");
      if (!isQueryFunction(queryFnValue)) return;
      if (queryFunctionReadsQueryKeyParameter(queryFnValue)) return;

      const queryKeyIdentifierNames = new Set<string>();
      collectQueryKeyIdentifierNames(queryKeyValue, queryKeyIdentifierNames);
      if (queryKeyIdentifierNames.size === 0) return;

      const queryFnIdentifierNames = new Set<string>();
      collectReferenceIdentifierNames(queryFnValue, queryFnIdentifierNames);

      const missingIdentifierNames = [...queryKeyIdentifierNames].filter(
        (identifierName) => !queryFnIdentifierNames.has(identifierName),
      );
      if (missingIdentifierNames.length === 0) return;

      context.report({
        node: queryKeyValue,
        message: `queryKey includes ${formatIdentifierNames(
          missingIdentifierNames,
        )}, but queryFn never reads ${formatIdentifierNames(
          missingIdentifierNames,
        )} — remove the unused key part or use it in the query function so refetching matches the fetched data`,
      });
    },
  }),
});
```

---

<sub>
Generated by `rde discover` (v3: accepted-review evidence + WHY-reasoning + generality check + explicit abstain). See [millionco/react-doctor-evals#11](https://github.com/millionco/react-doctor-evals/pull/11) for the pipeline. Implementation, test fixtures, and rule registration are deliberately deferred — this PR exists for maintainer triage of the proposal only.
</sub>
