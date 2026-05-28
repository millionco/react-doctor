# How to Write a React Doctor Rule

Reference PR: [#491 implement no-mutating-reducer-state rule](https://github.com/millionco/react-doctor/pull/491)

## Table of Contents

1. [Rule Quality Bar](#rule-quality-bar)
2. [End-to-End Workflow](#end-to-end-workflow)
3. [Define the Rule](#define-the-rule)
4. [Research the Problem](#research-the-problem)
5. [Validate an Idea Against OSS](#validate-an-idea-against-oss)
6. [Decide Scope and Detector Precision](#decide-scope-and-detector-precision)
7. [Design the Test Suite](#design-the-test-suite)
8. [Implement the Detector](#implement-the-detector)
9. [AST Vocabulary](#ast-vocabulary)
10. [Naming, Utilities, and Comments](#naming-utilities-and-comments)
11. [Verify Locally](#verify-locally)
12. [Test a New Rule Using Evals](#test-a-new-rule-using-evals)
13. [Write the PR Description](#write-the-pr-description)
14. [Review Triage](#review-triage)
15. [Checklists](#checklists)
16. [Common Failure Modes](#common-failure-modes)
17. [Standard Output](#standard-output)
18. [One-Time Study Resources](#one-time-study-resources)

## Rule Quality Bar

A good rule is:

- **Specific:** It catches one clearly named problem.
- **Grounded:** The problem is validated against docs, real code, issues, PRs, or evals.
- **Precise:** The detector matches the behavior described by the diagnostic.
- **Low-noise:** False positives are treated as correctness bugs.
- **Tested adversarially:** Tests cover valid edge cases, not just obvious invalid examples.
- **Scoped:** v1 does not try to solve adjacent rule ideas.
- **Readable:** Helper names describe exact semantics.

## End-to-End Workflow

1. Define the bug in one sentence.
2. Explain the runtime behavior that makes it a bug.
3. Inspect existing rule files and utilities.
4. Use RDE and OSS code to validate the idea.
5. Decide v1 scope and detector precision.
6. Write adversarial tests.
7. Implement the detector.
8. Add or reuse utilities only when needed.
9. Run targeted tests and typecheck.
10. Run RDE against many OSS repos.
11. Filter eval output to the target rule.
12. Inspect diagnostics manually.
13. Write a clear PR description with before/after examples.
14. Triage bot and human review comments.
15. Fix real findings with regression tests.
16. Format, commit, push, and resolve addressed review threads.

## Define the Rule

Use this format:

```md
This rule catches <code pattern> that causes <specific problem>.
```

Example from PR #491:

```md
This rule catches React `useReducer` reducers that mutate the current state object and return that same object.
```

Avoid vague definitions:

```md
This rule catches bad reducer state updates.
```

Every rule also needs the runtime reason:

```md
React compares reducer state by reference. If a reducer mutates the old state object and returns it, React can treat the update as unchanged.
```

Required questions:

- What framework/library behavior makes this a bug?
- What code shape triggers the bug?
- What code shape fixes it?
- What similar-looking code is valid?
- What should v1 intentionally skip?

## Research the Problem

Inspect existing React Doctor rule patterns before implementation.

For oxlint plugin rules, inspect:

- `packages/oxlint-plugin-react-doctor/src/plugin/rules/<category>/`
- `packages/oxlint-plugin-react-doctor/src/plugin/utils/`
- `packages/oxlint-plugin-react-doctor/src/plugin/rule-registry.ts`
- Existing co-located `*.test.ts` files.

Use existing helpers before adding new ones:

- `defineRule`
- `runRule`
- `walkAst`
- `isNodeOfType`
- `findVariableInitializer`
- `stripParenExpression`

Collect real-world evidence:

- Official docs showing the problem.
- Real app examples.
- Accepted debugging answers.
- Existing rule implementations in similar ecosystems.
- OSS code that looks suspicious but should not be reported.

PR #491 evidence:

- React docs: direct mutation plus `return state`.
- React internals discussion: reducer bailout depends on identity.
- StackOverflow examples: alias mutation such as `const next = state`.
- RocketChat: nested mutation but new top-level object.
- Sentry: `Map` mutation inside state but new top-level object.
- PostHog: clone-first `new Map(state)` mutation.
- Grafana: valid no-op `return state`.
- ToolJet: imported reducer passed to `useReducer`.

## Validate an Idea Against OSS

Use RDE before implementation to test whether a rule idea matches real open source code.

Goal:

- Validate a theory against many open source repos.
- Find real examples of the target bug.
- Find false-positive traps.
- Learn common library idioms.
- Decide whether the rule should exist.
- Decide how narrow v1 should be.

Inputs:

- Rule idea.
- One-sentence bug definition.
- Positive examples.
- Known valid examples.
- RDE repo cache or manifest.

Outputs:

- Exact positive candidates.
- Pattern-adjacent candidates.
- False-positive examples.
- Recommended detector shape.
- Recommended v1 non-goals.
- Test fixture list.

Use this workflow when:

- The rule is still a proposal.
- The expected bug shape is unclear.
- The library or framework idioms are unfamiliar.
- There is risk of catching valid patterns.
- You need examples for adversarial tests.

Useful prompt shape:

```md
Find real-world evidence for a React Doctor rule:

Rule: `<rule-name>`

Goal:
Find examples where <exact bug definition>.

Return:

- Strong positive examples
- Pattern-adjacent examples
- False-positive traps
- Detector implications
- Suggested adversarial tests

Prefer examples tied to real framework/library usage.
Do not treat similar-looking valid code as a positive.
```

PR #491 workflow-one result:

- The exact reducer bug is real and documented by React.
- Exact app-level positives were sparse in the scanned corpus.
- False-positive traps were common.
- The detector should require a real React `useReducer` call.
- The detector should not report no-op `return state` branches.
- Nested mutation followed by top-level clone should be a separate rule idea.

## Decide Scope and Detector Precision

Classify the rule before implementation.

### Syntax-Only

Use when the bug is local and does not require binding or path analysis.

Example:

```ts
dangerouslySetInnerHTML={{ __html: value }}
```

### Scope-Aware

Use when names must resolve to specific imports, variables, or bindings.

Example from PR #491:

```tsx
import { useReducer } from "react";

useReducer(reducer, initialState);
```

The identifier `useReducer` must be the React import, not a local function.

### Path-Aware

Use when order and branches matter.

Example from PR #491:

```tsx
function reducer(state, action) {
  if (action.type === "add") {
    state.items.push(action.item);
    return { ...state };
  }

  return state;
}
```

Do not report this. The mutation path returns a new object. The `return state` path is a no-op.

### V1 Scope

Do not mix adjacent rule ideas into v1.

PR #491 scoped v1 to:

- Real React `useReducer` calls.
- Same-file reducer functions.
- Mutations of the original state or aliases.
- Same-path return of the original top-level state reference.

PR #491 skipped or documented:

- Imported reducer bodies.
- Helper calls such as `mutate(state)`.
- Destructured aliases such as `const { items } = state`.
- Complex loop and try/catch control flow.
- Nested-reference mutation followed by shallow clone.
- Immer and Redux Toolkit draft reducers.

Separate rule idea:

```tsx
state.user.name = "Ada";
return { ...state };
```

This mutates nested state, but returns a new top-level object. Do not include this in `no-mutating-reducer-state`. It needs separate wording and separate false-positive handling.

## Design the Test Suite

The test suite should include:

- Direct invalid cases.
- Alias invalid cases.
- Import alias cases.
- Namespace import cases.
- Same-looking valid cases.
- Scope-shadowing cases.
- Imported/unresolved cases.
- Framework/library escape hatches.
- Regression tests for review comments.

Tests should be varied. Do not copy the same shape repeatedly.

### Invalid Test Examples

Direct mutation plus same-reference return:

```tsx
import { useReducer } from "react";

function reducer(state, action) {
  state.count++;
  return state;
}

useReducer(reducer, { count: 0 });
```

Alias mutation plus alias return:

```tsx
import { useReducer } from "react";

function reducer(state, action) {
  const next = state;
  next.name = action.name;
  return next;
}

useReducer(reducer, { name: "" });
```

In-place array method return:

```tsx
import { useReducer } from "react";

useReducer((state, action) => {
  return state.sort((left, right) => left.id - right.id);
}, []);
```

Switch fallthrough:

```tsx
import { useReducer } from "react";

function reducer(state, action) {
  switch (action.type) {
    case "mutate":
      state.count++;
    case "done":
      return state;
    default:
      return { ...state };
  }
}

useReducer(reducer, { count: 0 });
```

Transparent wrappers:

```tsx
import { useReducer } from "react";

function reducer(state: State, action) {
  state.items!.push(action.item);
  return state as State;
}

useReducer(reducer, { items: [] });
```

### Valid Test Examples

No-op return:

```tsx
import { useReducer } from "react";

function reducer(state, action) {
  if (action.type === "noop") {
    return state;
  }

  return { ...state, count: state.count + 1 };
}

useReducer(reducer, { count: 0 });
```

Clone-first update:

```tsx
import { useReducer } from "react";

function reducer(state, action) {
  const next = { ...state };
  next.count++;
  return next;
}

useReducer(reducer, { count: 0 });
```

Mutation path returns a fresh object:

```tsx
import { useReducer } from "react";

function reducer(state, action) {
  if (action.type === "add") {
    state.items.push(action.item);
    return { ...state, changed: true };
  }

  return state;
}

useReducer(reducer, { items: [] });
```

Non-React `Array.prototype.reduce`:

```tsx
items.reduce((state, item) => {
  state.push(item);
  return state;
}, []);
```

Locally shadowed `useReducer`:

```tsx
function useReducer(reducer, initialState) {
  return [initialState, reducer];
}

function reducer(state, action) {
  state.count++;
  return state;
}

useReducer(reducer, { count: 0 });
```

Imported reducer skipped by v1:

```tsx
import { useReducer } from "react";
import { reducer } from "./reducer";

useReducer(reducer, {});
```

Dynamic computed property should not be treated as static:

```tsx
import { useReducer } from "react";

function reducer(state, action) {
  const push = action.method;
  state.items[push](action.item);
  return state;
}

useReducer(reducer, { items: [] });
```

## Implement the Detector

Use pseudocode before implementation.

Example from PR #491:

```ts
for each file:
  collect React useReducer imports
  collect React namespace/default imports

  for each CallExpression:
    if callee is not React useReducer:
      continue

    reducerFunction = resolve first argument
    if reducerFunction is not same-file:
      continue

    stateName = first reducer parameter
    analyze reducer body by path

path analysis:
  track original state reference names
  track mutable state source names
  track mutations seen on current path

  when statement mutates original state source:
    remember mutation

  when statement returns original state reference:
    report remembered mutations
```

Implementation requirements:

- Match the detector to the one-sentence rule definition.
- Resolve imports before trusting identifier names.
- Treat shadowed bindings as different names.
- Avoid walking nested functions as if they execute immediately.
- Model only the control flow needed for the rule claim.
- Skip unknown or imported code unless the rule explicitly supports it.
- Add TODOs for known v2 gaps.

Resource-informed implementation rules:

- From ESTree: inspect node fields instead of guessing from source text.
- From Babel: distinguish raw nodes from paths; path-like wrappers carry parent, container, scope, and traversal state.
- From Babel: use bindings for identity questions; do not trust identifier text when imports or shadowing matter.
- From Babel: avoid unnecessary traversals; use direct child lookup for shallow structures.
- From Babel: nested structures are common; explicitly prune or model nested functions, classes, and blocks.
- From OXC/Babex: expect Babel-compatible vocabulary, but verify parser-specific node shapes for TypeScript, JSX, optional chaining, and computed members.
- From React Compiler: document unsupported JavaScript/control-flow cases instead of pretending every pattern is modeled soundly.
- From Deslop: think in confidence tiers; strong diagnostics should be high-confidence findings.

## AST Vocabulary

Common ESTree/Babel vocabulary:

| Vocabulary                | Description                                                      | Example                                              |
| ------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------- |
| `Program`                 | File-level statement list.                                       | `import React from "react";`                         |
| `ImportDeclaration`       | ES module import statement.                                      | `import { useReducer } from "react";`                |
| `ImportSpecifier`         | Named import binding.                                            | `useReducer` in `import { useReducer } from "react"` |
| `Identifier`              | A named binding or reference.                                    | `state`                                              |
| `VariableDeclarator`      | One variable binding inside a declaration.                       | `next = state` in `const next = state`               |
| `MemberExpression`        | Property access on an object.                                    | `state.items`                                        |
| `CallExpression`          | A function or method call.                                       | `state.items.push(item)`                             |
| `AssignmentExpression`    | Assignment to a target.                                          | `state.count = 1`                                    |
| `UpdateExpression`        | Increment or decrement expression.                               | `state.count++`                                      |
| `UnaryExpression`         | Unary operator expression.                                       | `delete state.count`                                 |
| `ReturnStatement`         | Function return statement.                                       | `return state`                                       |
| `IfStatement`             | Conditional branch with consequent and optional alternate paths. | `if (action.type === "add") { ... }`                 |
| `ConditionalExpression`   | Ternary expression with consequent and alternate values.         | `condition ? next : state`                           |
| `LogicalExpression`       | Short-circuiting boolean/logical expression.                     | `value \|\| state`                                   |
| `SwitchStatement`         | Case-based branch with possible fallthrough.                     | `switch (action.type) { ... }`                       |
| `SwitchCase`              | One switch case and its consequent statements.                   | `case "add": state.count++;`                         |
| `BlockStatement`          | Scoped statement list.                                           | `{ const next = state; }`                            |
| `FunctionDeclaration`     | Hoisted function declaration.                                    | `function reducer() {}`                              |
| `FunctionExpression`      | Function expression value.                                       | `const reducer = function () {};`                    |
| `ArrowFunctionExpression` | Arrow function expression value.                                 | `const reducer = () => {};`                          |
| `ParenthesizedExpression` | Transparent expression wrapper.                                  | `(state)`                                            |
| `TSAsExpression`          | TypeScript `as` wrapper.                                         | `state as State`                                     |
| `ChainExpression`         | Optional chaining wrapper in ESTree-style ASTs.                  | `state.items?.push(item)`                            |

Computed member handling:

```tsx
state.items.push(item); // static property: push
state.items["push"](item); // static string property: push
state.items[push](item); // dynamic property: unknown
```

Only static property names should match known mutating methods.

## Naming, Utilities, and Comments

### Naming

Names should describe exact behavior.

Avoid:

```ts
const isStateReference = ...
const getName = ...
const checkMutation = ...
```

Prefer:

```ts
const isOriginalReducerStateReference = ...
const getStaticMemberPropertyName = ...
const collectReducerStateMutationsInExpressionOrStatement = ...
const canExpressionReturnOriginalReducerStateReference = ...
```

Use matching suffixes for related helpers:

```ts
isOriginalReducerStateReference;
isMutableReducerStateSource;
isReactUseReducerCall;
```

### Utilities

Create a utility when:

- Two or more call sites need the same behavior.
- The behavior has subtle AST semantics.
- A review comment identifies duplicated logic.

Do not create a utility when:

- It hides one simple line.
- It makes names less clear.
- It exists only because the implementation feels long.

PR #491 utility example:

```ts
getStaticMemberPropertyName(node);
```

Required behavior:

- Return `"push"` for `state.items.push`.
- Return `"push"` for `state.items["push"]`.
- Return `null` for `state.items[push]`.

### Comments

Use comments only for non-obvious control-flow or AST tradeoffs.

Good comment:

```ts
// An if statement cannot use the generic statement path: the consequent and
// alternate are separate possible paths. Therefore, each branch is evaluated
// from the state after the condition runs.
```

Bad comment:

```ts
// Check if this is an if statement.
```

Comment requirements:

- Explain why the branch exists.
- Explain lossy behavior or v1 boundaries.
- Avoid narrating obvious code.

## Verify Locally

Use repo scripts through `@antfu/ni` commands when possible:

```sh
nr test
nr lint
nr typecheck
nr format
nr smoke:json-report
```

Package-specific commands used in PR #491:

```sh
pnpm exec vp test run packages/oxlint-plugin-react-doctor/src/plugin/rules/state-and-effects/no-mutating-reducer-state.test.ts
pnpm --filter oxlint-plugin-react-doctor typecheck
pnpm lint
```

If a broad command fails for unrelated repo state, record:

- Command run.
- Failure location.
- Why it is unrelated.
- Focused command that passed.

## Test a New Rule Using Evals

Use RDE after implementation to see how a new React Doctor rule behaves against many open source repos.

Goal:

- Avoid false positives.
- Inspect real diagnostics.
- Measure how noisy the rule is.
- Catch implementation assumptions missed by unit tests.
- Understand what running the rule feels like in production.

Inputs:

- React Doctor checkout containing the new rule.
- RDE eval harness checkout.
- Repo manifest.
- Repo cache.
- Target rule name.

Outputs:

- JSONL scan output.
- Filtered target-rule output.
- Summary by repo/rootDir.
- Manually inspected hits.
- Follow-up fixes or tests.

Use this workflow when:

- The rule implementation exists.
- Targeted tests pass.
- The detector may be noisy.
- The rule uses scope, path, or heuristic logic.
- The rule affects common React patterns.

Required handling:

- Scan distinct repos, not just manifest entries.
- Record rootDir scan count separately from repo count.
- Filter output to the target rule before judging results.
- Inspect every hit manually when counts are low.
- Sample hits manually when counts are high.
- Add regression tests for false positives found by evals.

PR #491 workflow-two facts:

- Target rule: `no-mutating-reducer-state`
- Scope: 100 distinct repos from `repos.json`
- Scan rows: 671 rootDir entries
- Filtered result: 1 diagnostic across 100 unique repos
- Outcome: low noise; one hit inspected manually

Do not confuse manifest entries with distinct repos.

Record:

- React Doctor checkout path.
- Eval harness path.
- Repo manifest path.
- Number of distinct repos.
- Number of manifest entries/rootDirs.
- Target rule name.
- Filtered output path.
- Total diagnostics.
- Manually inspected hits.

## Write the PR Description

Use this structure:

- `Why`
  - Catches `<specific issue>`.
  - Explain the runtime reason in 1-3 sentences.
  - Include a bad before example.
  - Include a good after example.
- `What changed`
  - Added `<rule-name>`.
  - Detects `<main detection surface>`.
  - Reports `<exact condition>`.
  - Allows `<important valid patterns>`.
  - Adds tests for `<edge cases>`.
- `Eval results`
  - Include a table when RDE was run.
  - Show enough numbers to prove the rule works and is not noisy.
  - Link or name the filtered output artifact when useful.
- `Test plan`
  - Focused test command.
  - Typecheck command.
  - Lint command.

Description requirements:

- Start with "Catches X".
- Include before and after examples.
- Include an eval-results table for rules tested against OSS.
- Mention important non-goals only if they clarify behavior.
- Do not lead with implementation internals.

Eval table template:

| Check                 | Result                                    |
| --------------------- | ----------------------------------------- |
| Repos scanned         | `<number of distinct repos>`              |
| RootDir scans         | `<number of manifest/rootDir entries>`    |
| Target rule           | `<rule-name>`                             |
| Diagnostics           | `<total target-rule diagnostics>`         |
| False positives found | `<count after manual inspection>`         |
| Output artifact       | `<filtered JSONL / summary path or link>` |

## Review Triage

Classify each review comment.

Fix now:

- Real false positive.
- Real false negative for claimed behavior.
- Incorrect AST semantics.
- Scope resolution bug.
- Control-flow bug with a reasonable test case.

Usually fix:

- Duplicated helper.
- Misleading name.
- Unnecessary abstraction.
- Confusing comment.

Document or defer:

- False-negative coverage outside v1 scope.
- Path explosion in pathological code.
- Complex loops/try/catch modeling when current behavior is conservative.
- Imported file analysis.

Reject:

- Comment that broadens the rule beyond its message.
- Suggestion that increases false positives.
- Style preference that conflicts with repo conventions.

Add a regression test for every real bug fixed from review.

Resolve PR threads only after the fix or explanation has landed.

## Checklists

### Pre-Implementation Checklist

- Bug is defined in one sentence.
- Runtime reason is documented.
- Existing rule patterns were inspected.
- OSS examples were reviewed.
- RDE workflow one was used when the idea needed validation.
- False-positive traps are listed.
- Detector precision is chosen.
- v1 non-goals are explicit.

### Pre-PR Checklist

- Tests include invalid and valid adversarial cases.
- Helper names match exact semantics.
- Shared utilities are reused.
- Generated registry is updated if required.
- Focused tests pass.
- Typecheck passes for touched package.
- PR description includes before/after examples.

### Pre-Merge Checklist

- RDE workflow two is run, or skip reason is documented.
- Eval output is filtered to the target rule.
- Hits are manually inspected.
- Bot review comments are triaged.
- Human review comments are triaged.
- Real findings have regression tests.
- PR threads are resolved after fixes land.
- Formatting is applied.
- Unrelated files are excluded from commits.

## Common Failure Modes

- Using string/name heuristics when import resolution is required.
- Reporting `return state` without proving prior same-path mutation.
- Treating imported functions as local implementations.
- Walking nested functions as if they execute immediately.
- Missing alias reassignment.
- Missing branch-specific paths.
- Ignoring switch fallthrough.
- Treating dynamic computed properties as static names.
- Mixing a related v2 rule into v1.
- Writing tests that mirror implementation shape instead of real code.
- Writing PR copy that explains internals but not the user-facing bug.

## Standard Output

A finished rule PR should contain:

- Rule implementation.
- Co-located tests.
- Generated registry update.
- Any shared utility needed by multiple call sites.
- PR description with before/after examples.
- Test plan.
- Evals summary for broad or heuristic rules.
- Review fixes with regression tests.

## One-Time Study Resources

This is onboarding material for learning AST rule authoring. Do this once when building taste for React Doctor rules, not for every PR.

Spend 1-2 hours asking an agent Q/A about these resources. Use them to build AST vocabulary, understand parser differences, and learn how production analyzers handle scope, confidence, and false positives.

| Resource              | Link                                                                                         | What to Extract                                                                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ESTree spec           | https://github.com/estree/estree                                                             | Node vocabulary, standard node shapes, and the philosophy that nodes are contextless and avoid duplicated information.                                         |
| Babel handbook        | https://github.com/jamiebuilds/babel-handbook                                                | ASTs, visitors, paths, scopes, bindings, traversal state, nested structures, and plugin testing patterns.                                                      |
| Babel plugin handbook | https://github.com/jamiebuilds/babel-handbook/blob/master/translations/en/plugin-handbook.md | Practical plugin authoring guidance: visitors, path APIs, scope/binding lookups, traversal performance, and unit testing.                                      |
| OXC                   | https://github.com/oxc-project/oxc                                                           | Oxlint/parser context, high-performance AST tooling, and rule implementation patterns to compare against React Doctor rules.                                   |
| Deslop                | https://github.com/millionco/deslop-js/                                                      | Confidence tiers, syntactic vs semantic findings, structured analysis errors, and CI-gating strategy for high-signal findings.                                 |
| React Compiler        | https://github.com/facebook/react/tree/main/compiler                                         | React rule semantics, conservative modeling, control-flow needs, React rules validation, and why unsupported JavaScript features should be explicit non-goals. |
| React Doctor          | https://github.com/millionco/react-doctor                                                    | Product context: deterministic React scans across state/effects, performance, architecture, security, and accessibility.                                       |
| Babex                 | https://github.com/millionco/babex                                                           | Babel-compatible APIs backed by OXC; useful for understanding parser/traverse compatibility and the shape of fast AST tooling.                                 |

Ask targeted questions:

- What AST nodes are involved in this rule?
- Which names must be resolved through bindings?
- Which syntax creates a new scope?
- Which syntax should stop traversal?
- Which nested structures can create false positives?
- Which parser differences matter for TypeScript, JSX, optional chaining, and computed properties?
- Which cases should be high-confidence diagnostics versus review prompts?

Resource takeaways:

- ESTree nodes are contextless. Do not assume a node knows its parent unless the local tooling attaches parent pointers.
- Babel paths add parent, scope, container, and traversal metadata around raw nodes. React Doctor utilities may expose different wrappers, so check local APIs.
- Scope and binding resolution matter whenever a rule depends on imports, aliases, or shadowed variables.
- Traversal is expensive. Prefer a single visitor or direct child lookup when that is enough.
- Nested structures are easy to mishandle. Explicitly skip nested functions unless the rule intends to inspect them.
- React Compiler is conservative about unsupported or hard-to-model JavaScript. React Doctor rules should also document v1 unsupported cases.
- Deslop-style confidence tiers are a useful mental model: only high-confidence findings should block or produce strong diagnostics.
- Babex shows the compatibility target: Babel-style parse/traverse APIs can sit on top of OXC, so rule authors should understand both Babel vocabulary and OXC-powered parsing.
