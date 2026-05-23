# Proposal: `react-doctor/no-mutating-reducer-state`

> **Status**: 🟡 Auto-discovered draft proposal. **Not yet implemented.** Maintainer review wanted before any code lands.

|                        |                                  |
| ---------------------- | -------------------------------- |
| Category               | `state-and-effects`              |
| Severity               | `error`                          |
| Source cluster         | `NEW::no-mutating-reducer-state` |
| Backing evidence units | 1                                |

## Why the bug exists

> The author assumed that mutating an object held in reducer state and returning it was enough to update consumers. In React-style state management, returning the same reference means change detection, memoized selectors, and subscribers may treat the state as unchanged.

## Generality check

> Reducers across React applications rely on immutable updates and new references, whether they are used with `useReducer` or a store. Deleting or assigning properties on the current state object before returning it is a common bug pattern independent of this repository's data model.

## Sources

Discovered by the [react-doctor-evals discovery flywheel](https://github.com/millionco/react-doctor-evals/pull/11) mining bug-fix evidence across React OSS repos. This proposal was sourced from the **accepted-review** signal (a reviewer commented + the author edited the file in response + the thread was marked resolved). Pipeline:

```
OSS repo -> GitHub GraphQL (PR review threads) -> acceptance filter (file changed between comment SHA and merge SHA) -> EvidenceUnit -> DraftAgent (gpt-5.5, xhigh reasoning) -> RuleDedupe -> THIS PR
```

### Backing evidence

- [`metabase/metabase` - `frontend/src/metabase/entities/tables-reducer.ts` (AcceptedReviewFixMeta)](https://github.com/metabase/metabase/pull/74575#discussion_r3280417814) — reviewer: bot @copilot-pull-request-reviewer · PR #74575 · signal: resolved-and-changed
  > The tables entity reducer logic was moved to `tablesReducer`, but the dedicated unit tests for this behavior were removed (`entities/tables.unit.spec.js`) without replacement. Please add equivalent un

## Validation prompt

FP-aware guidance for the [react-review agent](https://github.com/millionco/react-review) when triaging this rule:

> Confirm the function is actually a reducer whose first argument represents immutable state and that the mutation happens before returning that same reference. Typical false positives are draft-based reducers where mutation is intentionally translated into immutable updates, and non-React accumulator functions named `reducer` that intentionally mutate a local accumulator. Also allow code that first rebinds the state variable to a fresh clone before mutating and returning it.

## Fix prompt

> Do not delete, assign to, or push into the reducer's current state object. Create a new object or array and return that new reference instead.

```tsx
function reducer(state, action) {
  if (action.type === "remove") {
    const nextState = { ...state };
    delete nextState[action.key];
    return nextState;
  }
  return state;
}
```

## Positive fixture (SHOULD trigger)

```tsx
import { useReducer } from "react";

function reducer(state, action) {
  if (action.type === "remove") {
    delete state[action.key];
    return state;
  }
  return state;
}

export function Component() {
  const [value, dispatch] = useReducer(reducer, { item: true });
  return (
    <button onClick={() => dispatch({ type: "remove", key: "item" })}>{String(value.item)}</button>
  );
}
```

## Negative fixture (should NOT trigger)

```tsx
import { useReducer } from "react";

function reducer(state, action) {
  if (action.type === "remove") {
    const nextState = { ...state };
    delete nextState[action.key];
    return nextState;
  }
  return state;
}

export function Component() {
  const [value, dispatch] = useReducer(reducer, { item: true });
  return (
    <button onClick={() => dispatch({ type: "remove", key: "item" })}>{String(value.item)}</button>
  );
}
```

## Proposed AST detector

Would land at `packages/oxlint-plugin-react-doctor/src/plugin/rules/state-and-effects/no-mutating-reducer-state.ts`:

```ts
import { MUTATING_ARRAY_METHODS } from "../../constants/js.js";
import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { defineRule } from "../../utils/define-rule.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const isFunctionLikeNode = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "FunctionDeclaration") ||
  isNodeOfType(node, "FunctionExpression") ||
  isNodeOfType(node, "ArrowFunctionExpression");

const isReducerName = (name: string): boolean => name.toLowerCase().endsWith("reducer");

const getReducerStateParamName = (functionNode: EsTreeNode): string | null => {
  if (!isFunctionLikeNode(functionNode)) return null;
  const firstParam = functionNode.params?.[0];
  if (isNodeOfType(firstParam, "Identifier")) return firstParam.name;
  if (
    isNodeOfType(firstParam, "AssignmentPattern") &&
    isNodeOfType(firstParam.left, "Identifier")
  ) {
    return firstParam.left.name;
  }
  return null;
};

const collectFunctionLocalBindings = (functionNode: EsTreeNode): Set<string> => {
  const localBindings = new Set<string>();
  if (!isFunctionLikeNode(functionNode)) return localBindings;
  for (const param of functionNode.params ?? []) {
    collectPatternNames(param, localBindings);
  }
  if (!isNodeOfType(functionNode.body, "BlockStatement")) return localBindings;
  for (const statement of functionNode.body.body ?? []) {
    if (!isNodeOfType(statement, "VariableDeclaration")) continue;
    for (const declarator of statement.declarations ?? []) {
      collectPatternNames(declarator.id, localBindings);
    }
  }
  return localBindings;
};

const walkReducerBodyRespectingShadows = (
  node: EsTreeNode,
  shadowedNames: ReadonlySet<string>,
  nestedFunctionDepth: number,
  visit: (child: EsTreeNode, currentlyShadowed: ReadonlySet<string>, functionDepth: number) => void,
): void => {
  if (!node || typeof node !== "object") return;

  let nextShadowedNames = shadowedNames;
  let nextFunctionDepth = nestedFunctionDepth;
  if (isFunctionLikeNode(node)) {
    const localBindings = collectFunctionLocalBindings(node);
    if (localBindings.size > 0) {
      const merged = new Set(shadowedNames);
      for (const localName of localBindings) merged.add(localName);
      nextShadowedNames = merged;
    }
    nextFunctionDepth = nestedFunctionDepth + 1;
  }

  visit(node, shadowedNames, nestedFunctionDepth);

  const nodeRecord = node as unknown as Record<string, unknown>;
  for (const key of Object.keys(nodeRecord)) {
    if (key === "parent") continue;
    const child = nodeRecord[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === "object" && "type" in item) {
          walkReducerBodyRespectingShadows(
            item as EsTreeNode,
            nextShadowedNames,
            nextFunctionDepth,
            visit,
          );
        }
      }
    } else if (child && typeof child === "object" && "type" in child) {
      walkReducerBodyRespectingShadows(
        child as EsTreeNode,
        nextShadowedNames,
        nextFunctionDepth,
        visit,
      );
    }
  }
};

const getReducerStateMutationKind = (node: EsTreeNode, stateName: string): string | null => {
  if (isNodeOfType(node, "AssignmentExpression")) {
    if (!isNodeOfType(node.left, "MemberExpression")) return null;
    return getRootIdentifierName(node.left) === stateName ? "property assignment" : null;
  }

  if (isNodeOfType(node, "UpdateExpression")) {
    if (!isNodeOfType(node.argument, "MemberExpression")) return null;
    return getRootIdentifierName(node.argument) === stateName ? "property update" : null;
  }

  if (isNodeOfType(node, "UnaryExpression") && node.operator === "delete") {
    if (!isNodeOfType(node.argument, "MemberExpression")) return null;
    return getRootIdentifierName(node.argument) === stateName ? "delete" : null;
  }

  if (!isNodeOfType(node, "CallExpression")) return null;

  if (isNodeOfType(node.callee, "MemberExpression")) {
    if (!isNodeOfType(node.callee.property, "Identifier")) return null;
    const methodName = node.callee.property.name;
    if (!MUTATING_ARRAY_METHODS.has(methodName)) return null;
    return getRootIdentifierName(node.callee.object) === stateName ? `.${methodName}()` : null;
  }

  if (!isNodeOfType(node.callee, "MemberExpression")) return null;
  return null;
};

const isFunctionPassedToUseReducer = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  return Boolean(
    parent &&
    isNodeOfType(parent, "CallExpression") &&
    parent.arguments?.[0] === node &&
    isHookCall(parent, "useReducer"),
  );
};

export const noMutatingReducerState = defineRule<Rule>({
  id: "no-mutating-reducer-state",
  severity: "error",
  recommendation:
    "Return a new reducer state object instead of mutating the current state and returning the same reference. React and selector memoization rely on reference changes to observe reducer updates.",
  create: (context: RuleContext) => {
    const checkReducer = (functionNode: EsTreeNode, requireStateParamName: boolean): void => {
      const stateName = getReducerStateParamName(functionNode);
      if (!stateName) return;
      if (requireStateParamName && stateName !== "state") return;
      if (!isFunctionLikeNode(functionNode) || !isNodeOfType(functionNode.body, "BlockStatement"))
        return;

      const mutationNodes: Array<{ node: EsTreeNode; kind: string }> = [];
      let returnsSameStateReference = false;

      walkReducerBodyRespectingShadows(
        functionNode.body,
        new Set(),
        0,
        (child: EsTreeNode, currentlyShadowed: ReadonlySet<string>, functionDepth: number) => {
          if (currentlyShadowed.has(stateName)) return;

          if (
            functionDepth === 0 &&
            isNodeOfType(child, "ReturnStatement") &&
            isNodeOfType(child.argument, "Identifier") &&
            child.argument.name === stateName
          ) {
            returnsSameStateReference = true;
            return;
          }

          const mutationKind = getReducerStateMutationKind(child, stateName);
          if (!mutationKind) return;
          mutationNodes.push({ node: child, kind: mutationKind });
        },
      );

      if (!returnsSameStateReference) return;
      for (const mutation of mutationNodes) {
        context.report({
          node: mutation.node,
          message: `Reducer mutates its ${stateName} parameter with ${mutation.kind} and returns the same reference. Return a copied object or array so React can observe the update`,
        });
      }
    };

    return {
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (!node.id?.name || !isReducerName(node.id.name)) return;
        checkReducer(node, true);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isNodeOfType(node.id, "Identifier")) return;
        if (!isReducerName(node.id.name)) return;
        if (!node.init || !isFunctionLikeNode(node.init)) return;
        checkReducer(node.init, true);
      },
      ArrowFunctionExpression(node: EsTreeNodeOfType<"ArrowFunctionExpression">) {
        if (!isFunctionPassedToUseReducer(node)) return;
        checkReducer(node, false);
      },
      FunctionExpression(node: EsTreeNodeOfType<"FunctionExpression">) {
        if (!isFunctionPassedToUseReducer(node)) return;
        checkReducer(node, false);
      },
    };
  },
});
```

---

<sub>
Generated by `rde discover` (v3: accepted-review evidence + WHY-reasoning + generality check + explicit abstain). See [millionco/react-doctor-evals#11](https://github.com/millionco/react-doctor-evals/pull/11) for the pipeline. Implementation, test fixtures, and rule registration are deliberately deferred — this PR exists for maintainer triage of the proposal only.
</sub>
