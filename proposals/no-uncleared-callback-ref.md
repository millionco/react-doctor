# Proposal: `react-doctor/no-uncleared-callback-ref`

> **Status**: 🟡 Auto-discovered draft proposal. **Not yet implemented.** Maintainer review wanted before any code lands.

|                        |                                  |
| ---------------------- | -------------------------------- |
| Category               | `state-and-effects`              |
| Severity               | `warn`                           |
| Source cluster         | `NEW::no-uncleared-callback-ref` |
| Backing evidence units | 1                                |

## Why the bug exists

> The developer assumed the callback ref only runs with an attached element. React also invokes callback refs with null when the element detaches, so state that points at node-bound resources can remain stale and keep those resources reachable.

## Generality check

> This applies to any React component or hook that stores a DOM-node-derived value from a callback ref. The same leak or stale-resource bug can occur regardless of the product domain whenever the null ref call is ignored.

## Sources

Discovered by the [react-doctor-evals discovery flywheel](https://github.com/millionco/react-doctor-evals/pull/11) mining bug-fix evidence across React OSS repos. This proposal was sourced from the **accepted-review** signal (a reviewer commented + the author edited the file in response + the thread was marked resolved). Pipeline:

```
OSS repo -> GitHub GraphQL (PR review threads) -> acceptance filter (file changed between comment SHA and merge SHA) -> EvidenceUnit -> DraftAgent (gpt-5.5, xhigh reasoning) -> RuleDedupe -> THIS PR
```

### Backing evidence

- [`formkit/auto-animate` - `src/react/index.ts` (AcceptedReviewFixMeta)](https://github.com/formkit/auto-animate/pull/84#discussion_r1064016834) — reviewer: human @sventschui · PR #84 · signal: resolved-and-changed
  > ```suggestion
  >
  > ```

## Validation prompt

FP-aware guidance for the [react-review agent](https://github.com/millionco/react-review) when triaging this rule:

> Confirm that the callback is actually a React callback ref, not just a returned handler with one nullable argument. Typical false positives are custom hooks returning a non-ref callback typed loosely enough to look ref-like, and ref callbacks that delegate the null cleanup to a helper the detector cannot see. Also allow cases where another guaranteed detach path clears the same state before the node-bound resource can be reused.

## Fix prompt

> Handle the detach case because React calls callback refs with null when the node is removed or the ref changes. Clear the same state or resource in an else branch or early null branch. Example:

```tsx
const ref = useCallback((node: HTMLDivElement | null) => {
  if (node) {
    setValue(node);
  } else {
    setValue(null);
  }
}, []);
```

## Positive fixture (SHOULD trigger)

```tsx
import { useCallback, useState } from "react";

function Component() {
  const [value, setValue] = useState<HTMLElement | null>(null);
  const ref = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      setValue(node);
    }
  }, []);

  return <div ref={ref} />;
}
```

## Negative fixture (should NOT trigger)

```tsx
import { useCallback, useState } from "react";

function Component() {
  const [value, setValue] = useState<HTMLElement | null>(null);
  const ref = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      setValue(node);
    } else {
      setValue(null);
    }
  }, []);

  return <div ref={ref} />;
}
```

## Proposed AST detector

Would land at `packages/oxlint-plugin-react-doctor/src/plugin/rules/state-and-effects/no-uncleared-callback-ref.ts`:

```ts
import { defineRule } from "../../utils/define-rule.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { collectUseStateBindings } from "./utils/collect-use-state-bindings.js";

interface CallbackRefCandidate {
  name: string;
  callback: EsTreeNodeOfType<"ArrowFunctionExpression"> | EsTreeNodeOfType<"FunctionExpression">;
}

const CUSTOM_HOOK_NAME_PATTERN = /^use[A-Z0-9]/;
const REF_CALLBACK_TYPE_NAMES = new Set(["RefCallback"]);

const isCustomHookName = (name: string): boolean => CUSTOM_HOOK_NAME_PATTERN.test(name);

const isReactFunctionName = (name: string): boolean =>
  isUppercaseName(name) || isCustomHookName(name);

const isFunctionLikeNode = (
  node: unknown,
): node is
  | EsTreeNodeOfType<"FunctionDeclaration">
  | EsTreeNodeOfType<"FunctionExpression">
  | EsTreeNodeOfType<"ArrowFunctionExpression"> =>
  isNodeOfType(node, "FunctionDeclaration") ||
  isNodeOfType(node, "FunctionExpression") ||
  isNodeOfType(node, "ArrowFunctionExpression");

const walkIgnoringNestedFunctions = (
  node: EsTreeNode,
  visit: (child: EsTreeNode) => void,
): void => {
  walkAst(node, (child) => {
    if (child !== node && isFunctionLikeNode(child)) return false;
    visit(child);
  });
};

const isIdentifierNamed = (node: unknown, name: string): boolean =>
  isNodeOfType(node, "Identifier") && node.name === name;

const isUndefinedIdentifier = (node: unknown): boolean => isIdentifierNamed(node, "undefined");

const isNullishExpression = (node: unknown): boolean => {
  if (!node) return false;
  if (isUndefinedIdentifier(node)) return true;
  if (isNodeOfType(node, "Literal") && node.value === null) return true;
  return isNodeOfType(node, "UnaryExpression") && node.operator === "void";
};

const isClearStateArgument = (argument: unknown): boolean =>
  !argument || isNullishExpression(argument);

const getCallbackParameterName = (callback: EsTreeNode): string | null => {
  if (!isFunctionLikeNode(callback)) return null;
  const firstParameter = callback.params?.[0];
  if (isNodeOfType(firstParameter, "Identifier")) return firstParameter.name;
  if (
    isNodeOfType(firstParameter, "AssignmentPattern") &&
    isNodeOfType(firstParameter.left, "Identifier")
  ) {
    return firstParameter.left.name;
  }
  return null;
};

const getSetterCallName = (node: EsTreeNode, setterNames: ReadonlySet<string>): string | null => {
  if (!isNodeOfType(node, "CallExpression")) return null;
  if (!isNodeOfType(node.callee, "Identifier")) return null;
  return setterNames.has(node.callee.name) ? node.callee.name : null;
};

const isClearSetterCall = (node: EsTreeNode, setterName: string): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (!isNodeOfType(node.callee, "Identifier")) return false;
  if (node.callee.name !== setterName) return false;
  return isClearStateArgument(node.arguments?.[0]);
};

const collectNonClearSetterCalls = (
  node: EsTreeNode,
  setterNames: ReadonlySet<string>,
): Map<string, EsTreeNode> => {
  const calls = new Map<string, EsTreeNode>();
  walkIgnoringNestedFunctions(node, (child) => {
    const setterName = getSetterCallName(child, setterNames);
    if (!setterName) return;
    if (!isNodeOfType(child, "CallExpression")) return;
    if (isClearStateArgument(child.arguments?.[0])) return;
    if (!calls.has(setterName)) calls.set(setterName, child);
  });
  return calls;
};

const mergeFirstSetterCalls = (
  target: Map<string, EsTreeNode>,
  source: ReadonlyMap<string, EsTreeNode>,
): void => {
  for (const [setterName, setterCall] of source) {
    if (!target.has(setterName)) target.set(setterName, setterCall);
  }
};

const isNonNullRefGuardExpression = (node: EsTreeNode, parameterName: string): boolean => {
  if (isIdentifierNamed(node, parameterName)) return true;
  if (isNodeOfType(node, "BinaryExpression")) {
    if (node.operator === "instanceof") return isIdentifierNamed(node.left, parameterName);
    if (node.operator !== "!=" && node.operator !== "!==") return false;
    return (
      (isIdentifierNamed(node.left, parameterName) && isNullishExpression(node.right)) ||
      (isIdentifierNamed(node.right, parameterName) && isNullishExpression(node.left))
    );
  }
  if (isNodeOfType(node, "LogicalExpression") && node.operator === "&&") {
    return (
      isNonNullRefGuardExpression(node.left, parameterName) ||
      isNonNullRefGuardExpression(node.right, parameterName)
    );
  }
  return false;
};

const isNullRefGuardExpression = (node: EsTreeNode, parameterName: string): boolean => {
  if (isNodeOfType(node, "UnaryExpression") && node.operator === "!") {
    return isIdentifierNamed(node.argument, parameterName);
  }
  if (isNodeOfType(node, "BinaryExpression")) {
    if (node.operator !== "==" && node.operator !== "===") return false;
    return (
      (isIdentifierNamed(node.left, parameterName) && isNullishExpression(node.right)) ||
      (isIdentifierNamed(node.right, parameterName) && isNullishExpression(node.left))
    );
  }
  if (isNodeOfType(node, "LogicalExpression") && node.operator === "||") {
    return (
      isNullRefGuardExpression(node.left, parameterName) ||
      isNullRefGuardExpression(node.right, parameterName)
    );
  }
  return false;
};

const branchExits = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "ReturnStatement") || isNodeOfType(node, "ThrowStatement")) return true;
  if (!isNodeOfType(node, "BlockStatement")) return false;
  const statements = node.body ?? [];
  const lastStatement = statements[statements.length - 1];
  return Boolean(lastStatement && branchExits(lastStatement));
};

const isNullReturningGuardStatement = (node: EsTreeNode, parameterName: string): boolean =>
  isNodeOfType(node, "IfStatement") &&
  isNullRefGuardExpression(node.test, parameterName) &&
  branchExits(node.consequent);

const findGuardedSetterCalls = (
  callback: EsTreeNode,
  parameterName: string,
  setterNames: ReadonlySet<string>,
): Map<string, EsTreeNode> => {
  const guardedCalls = new Map<string, EsTreeNode>();
  walkIgnoringNestedFunctions(callback, (child) => {
    if (!isNodeOfType(child, "IfStatement")) return;
    if (!isNonNullRefGuardExpression(child.test, parameterName)) return;
    mergeFirstSetterCalls(guardedCalls, collectNonClearSetterCalls(child.consequent, setterNames));
  });

  if (!isFunctionLikeNode(callback) || !isNodeOfType(callback.body, "BlockStatement")) {
    return guardedCalls;
  }

  let didPassNullReturnGuard = false;
  for (const statement of callback.body.body ?? []) {
    if (!didPassNullReturnGuard) {
      if (isNullReturningGuardStatement(statement, parameterName)) didPassNullReturnGuard = true;
      continue;
    }
    mergeFirstSetterCalls(guardedCalls, collectNonClearSetterCalls(statement, setterNames));
  }

  return guardedCalls;
};

const callbackHasClearCall = (callback: EsTreeNode, setterName: string): boolean => {
  let didFindClearCall = false;
  walkIgnoringNestedFunctions(callback, (child) => {
    if (didFindClearCall) return;
    if (isClearSetterCall(child, setterName)) didFindClearCall = true;
  });
  return didFindClearCall;
};

const collectUseCallbackCandidates = (functionBody: EsTreeNode): CallbackRefCandidate[] => {
  const candidates: CallbackRefCandidate[] = [];
  if (!isNodeOfType(functionBody, "BlockStatement")) return candidates;

  for (const statement of functionBody.body ?? []) {
    if (!isNodeOfType(statement, "VariableDeclaration")) continue;
    for (const declarator of statement.declarations ?? []) {
      if (!isNodeOfType(declarator.id, "Identifier")) continue;
      if (!isNodeOfType(declarator.init, "CallExpression")) continue;
      if (!isHookCall(declarator.init, "useCallback")) continue;
      const firstArgument = declarator.init.arguments?.[0];
      if (
        !isNodeOfType(firstArgument, "ArrowFunctionExpression") &&
        !isNodeOfType(firstArgument, "FunctionExpression")
      ) {
        continue;
      }
      if (!getCallbackParameterName(firstArgument)) continue;
      candidates.push({ name: declarator.id.name, callback: firstArgument });
    }
  }

  return candidates;
};

const expressionContainsIdentifier = (
  node: EsTreeNode | null | undefined,
  name: string,
): boolean => {
  if (!node) return false;
  let didFindIdentifier = false;
  walkAst(node, (child) => {
    if (didFindIdentifier) return;
    if (isIdentifierNamed(child, name)) didFindIdentifier = true;
  });
  return didFindIdentifier;
};

const functionBodyReturnsIdentifier = (functionBody: EsTreeNode, name: string): boolean => {
  if (!isNodeOfType(functionBody, "BlockStatement")) return false;
  for (const statement of functionBody.body ?? []) {
    if (!isNodeOfType(statement, "ReturnStatement")) continue;
    if (expressionContainsIdentifier(statement.argument, name)) return true;
  }
  return false;
};

const isUsedAsJsxRef = (functionBody: EsTreeNode, name: string): boolean => {
  let didFindRefUsage = false;
  walkIgnoringNestedFunctions(functionBody, (child) => {
    if (didFindRefUsage) return;
    if (!isNodeOfType(child, "JSXAttribute")) return;
    if (!isNodeOfType(child.name, "JSXIdentifier") || child.name.name !== "ref") return;
    if (!isNodeOfType(child.value, "JSXExpressionContainer")) return;
    if (isIdentifierNamed(child.value.expression, name)) didFindRefUsage = true;
  });
  return didFindRefUsage;
};

const getTypeReferenceName = (node: EsTreeNode): string | null => {
  if (!isNodeOfType(node, "TSTypeReference")) return null;
  if (isNodeOfType(node.typeName, "Identifier")) return node.typeName.name;
  if (
    isNodeOfType(node.typeName, "TSQualifiedName") &&
    isNodeOfType(node.typeName.right, "Identifier")
  ) {
    return node.typeName.right.name;
  }
  return null;
};

const functionHasRefCallbackReturnType = (functionNode: EsTreeNode): boolean => {
  if (!isFunctionLikeNode(functionNode) || !functionNode.returnType) return false;
  let didFindRefCallback = false;
  walkAst(functionNode.returnType, (child) => {
    const typeName = getTypeReferenceName(child);
    if (typeName && REF_CALLBACK_TYPE_NAMES.has(typeName)) didFindRefCallback = true;
  });
  return didFindRefCallback;
};

export const noUnclearedCallbackRef = defineRule<Rule>({
  id: "no-uncleared-callback-ref",
  severity: "warn",
  recommendation:
    "When a callback ref stores node-bound state, clear the same state when React calls the ref with null on detach. Add an else branch, an early null branch, or a ref cleanup that releases and clears the stored value.",
  create: (context: RuleContext) => {
    const checkReactFunction = (
      functionName: string,
      functionNode: EsTreeNode,
      functionBody: EsTreeNode | null | undefined,
    ): void => {
      if (!functionBody || !isNodeOfType(functionBody, "BlockStatement")) return;
      const stateBindings = collectUseStateBindings(functionBody);
      if (stateBindings.length === 0) return;
      const setterNames = new Set(stateBindings.map((binding) => binding.setterName));
      const candidates = collectUseCallbackCandidates(functionBody);

      for (const candidate of candidates) {
        const isRefLike =
          isUsedAsJsxRef(functionBody, candidate.name) ||
          (isCustomHookName(functionName) &&
            functionHasRefCallbackReturnType(functionNode) &&
            functionBodyReturnsIdentifier(functionBody, candidate.name));
        if (!isRefLike) continue;

        const parameterName = getCallbackParameterName(candidate.callback);
        if (!parameterName) continue;
        const guardedSetterCalls = findGuardedSetterCalls(
          candidate.callback,
          parameterName,
          setterNames,
        );

        for (const [setterName, setterCall] of guardedSetterCalls) {
          if (callbackHasClearCall(candidate.callback, setterName)) continue;
          context.report({
            node: setterCall,
            message: `Callback ref stores state with ${setterName}() when the node is present, but never clears that state when React passes null on detach. Add a null branch that calls ${setterName}(null) or ${setterName}(undefined).`,
          });
        }
      }
    };

    return {
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        const functionName = node.id?.name;
        if (!functionName || !isReactFunctionName(functionName)) return;
        checkReactFunction(functionName, node, node.body);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isNodeOfType(node.id, "Identifier")) return;
        if (!isReactFunctionName(node.id.name)) return;
        if (!isFunctionLikeNode(node.init)) return;
        checkReactFunction(node.id.name, node.init, node.init.body);
      },
    };
  },
});
```

---

<sub>
Generated by `rde discover` (v3: accepted-review evidence + WHY-reasoning + generality check + explicit abstain). See [millionco/react-doctor-evals#11](https://github.com/millionco/react-doctor-evals/pull/11) for the pipeline. Implementation, test fixtures, and rule registration are deliberately deferred — this PR exists for maintainer triage of the proposal only.
</sub>
