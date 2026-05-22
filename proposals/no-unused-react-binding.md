# Proposal: `react-doctor/no-unused-react-binding`

> **Status**: 🟡 Auto-discovered draft proposal. **Not yet implemented.** Maintainer review wanted before any code lands.

|                             |                                |
| --------------------------- | ------------------------------ |
| Category                    | `architecture`                 |
| Severity                    | `warn`                         |
| Source clusters             | `NEW::no-unused-react-binding` |
| Independent draft proposals | 1                              |
| Backing evidence units      | 1                              |

## Sources

Discovered by the [react-doctor-evals discovery flywheel](https://github.com/millionco/react-doctor-evals/pull/11) mining bug-fix evidence across React OSS repos. The pipeline below produced this proposal:

```
OSS repo → Vercel Sandbox miner → EvidenceUnit → RuleDrafter (LLM) → RuleDedupe → THIS PR
```

### Backing evidence

- [`facebook/react` — `packages/react-native-renderer/src/__tests__/ReactFabric-test.internal.js` (FixCommitMeta)](https://github.com/facebook/react/commit/b4a8d298450fd1fd274445fe8554e5fc18c5e12c)

## Validation prompt

FP-aware guidance for the [react-review agent](https://github.com/millionco/react-review) when triaging this rule:

> Confirm the binding is truly unread across the whole React file, not just inside the current component body. Typical false positives are underscore-prefixed placeholders, intentionally retained test fixtures, and type-only declarations or imports that are already ignored by the detector. Only treat it as a finding when scope analysis shows no runtime reads.

## Fix prompt

Actionable fix suggestion surfaced to the user when the rule fires:

> Remove the dead binding or inline the value so only the names you actually use remain. For example:

```ts
const [count, setCount] = useState(0);
// if `setCount` is never used:
const [count] = useState(0);
```

If a binding is intentionally unused, rename it with a leading underscore to make that intent explicit.

## Positive fixture (SHOULD trigger)

```tsx
import { useState } from "react";
export function Example() {
  const [count, setCount] = useState(0);
  const unused = 1;
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
```

## Negative fixture (should NOT trigger)

```tsx
import { useState } from "react";
export function Example() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
```

## Proposed AST detector

Would land at `packages/oxlint-plugin-react-doctor/src/plugin/rules/architecture/no-unused-react-binding.ts`:

```ts
import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type {
  ScopeDescriptor,
  SymbolDescriptor,
} from "../../semantic/scope-analysis.js";

const isReactImportSource = (source: string): boolean =>
  source === "react" ||
  source === "react-dom" ||
  source === "react/jsx-runtime" ||
  source === "react/jsx-dev-runtime" ||
  source.startsWith("react/") ||
  source.startsWith("react-dom/") ||
  source.startsWith("react-native");

const fileLooksReactLike = (program: EsTreeNode): boolean => {
  let didFindReactSignal = false;
  walkAst(program, (node) => {
    if (didFindReactSignal) return false;
    if (isNodeOfType(node, "JSXElement") || isNodeOfType(node, "JSXFragment")) {
      didFindReactSignal = true;
      return false;
    }
    if (
      isNodeOfType(node, "ImportDeclaration") &&
      typeof node.source.value === "string" &&
      isReactImportSource(node.source.value)
    ) {
      didFindReactSignal = true;
      return false;
    }
  });
  return didFindReactSignal;
};

const collectScopes = (
  scope: ScopeDescriptor,
  into: Array<ScopeDescriptor>
): void => {
  into.push(scope);
  for (const childScope of scope.children) collectScopes(childScope, into);
};

const isReportableSymbol = (symbol: SymbolDescriptor): boolean => {
  if (symbol.name.startsWith("_")) return false;
  if (symbol.kind === "import") return false;
  if (symbol.kind === "parameter") return false;
  if (symbol.kind === "catch-clause-parameter") return false;
  if (symbol.kind.startsWith("ts-")) return false;
  return symbol.references.length === 0;
};

export const noUnusedReactBinding = defineRule<Rule>({
  id: "no-unused-react-binding",
  severity: "warn",
  tags: ["react-jsx-only"],
  category: "Architecture",
  recommendation:
    "Remove unused React bindings or inline the value directly. If a binding is intentionally ignored, use a leading underscore so the intent is clear.",
  create: (context: RuleContext) => ({
    Program(node: EsTreeNodeOfType<"Program">) {
      if (!fileLooksReactLike(node)) return;
      const scopes: Array<ScopeDescriptor> = [];
      collectScopes(context.scopes.rootScope, scopes);
      for (const scope of scopes) {
        for (const symbol of scope.symbols) {
          if (!isReportableSymbol(symbol)) continue;
          context.report({
            node: symbol.bindingIdentifier,
            message: `Unused React binding \`${symbol.name}\` is declared but never read. Remove it or use it.`,
          });
        }
      }
    },
  }),
});
```

---

<sub>
Generated by `rde discover` (see [millionco/react-doctor-evals#11](https://github.com/millionco/react-doctor-evals/pull/11) for the pipeline). Implementation, test fixtures, and rule registration are deliberately deferred — this PR exists for maintainer triage of the proposal only. Reject, edit-and-approve, or merge after wiring as you see fit.
</sub>
