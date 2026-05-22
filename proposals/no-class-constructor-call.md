# Proposal: `react-doctor/no-class-constructor-call`

> **Status**: 🟡 Auto-discovered draft proposal. **Not yet implemented.** Maintainer review wanted before any code lands.

|                             |                                  |
| --------------------------- | -------------------------------- |
| Category                    | `correctness`                    |
| Severity                    | `error`                          |
| Source clusters             | `NEW::no-class-constructor-call` |
| Independent draft proposals | 1                                |
| Backing evidence units      | 1                                |

## Sources

Discovered by the [react-doctor-evals discovery flywheel](https://github.com/millionco/react-doctor-evals/pull/11) mining bug-fix evidence across React OSS repos. The pipeline below produced this proposal:

```
OSS repo → Vercel Sandbox miner → EvidenceUnit → RuleDrafter (LLM) → RuleDedupe → THIS PR
```

### Backing evidence

- [`facebook/react` — `packages/react-devtools-shared/src/backend/shared/DevToolsComponentStackFrame.js` (DisableChurnMeta)](https://github.com/facebook/react/commit/8fc5763b8acb3fe8ca8c350cff7675a5bce2b332)

## Validation prompt

FP-aware guidance for the [react-review agent](https://github.com/millionco/react-review) when triaging this rule:

> Confirm the callee resolves to a real class binding, not a plain helper function that just happens to use PascalCase. Do not flag `new` expressions, `Reflect.construct(...)`, or code paths where the class intentionally defines a static `call` or `apply` method and that method is the actual target. Typical false positives are imported component factories, utility functions with uppercase names, and intentional test harnesses that never execute in production.

## Fix prompt

Actionable fix suggestion surfaced to the user when the rule fires:

> Call the class with `new` so JavaScript runs its constructor correctly. If you need an instance, keep the instance instead of invoking the class like a normal function.

```tsx
class Store {}

function App() {
  const store = new Store();
  return null;
}
```

## Positive fixture (SHOULD trigger)

```tsx
class Store {}

export function App() {
  Store();
  return null;
}
```

## Negative fixture (should NOT trigger)

```tsx
class Store {}

export function App() {
  new Store();
  return null;
}
```

## Proposed AST detector

Would land at `packages/oxlint-plugin-react-doctor/src/plugin/rules/correctness/no-class-constructor-call.ts`:

```ts
import type {
  ScopeAnalysis,
  SymbolDescriptor,
} from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const CONSTRUCTOR_CALL_METHODS = new Set(["call", "apply"]);

const isClassNode = (node: EsTreeNode | null | undefined): boolean =>
  Boolean(node) &&
  (isNodeOfType(node, "ClassDeclaration") ||
    isNodeOfType(node, "ClassExpression"));

const getClassNode = (symbol: SymbolDescriptor): EsTreeNode | null => {
  if (isClassNode(symbol.declarationNode)) return symbol.declarationNode;
  if (isClassNode(symbol.initializer)) return symbol.initializer;
  return null;
};

const symbolIsClassLike = (symbol: SymbolDescriptor): boolean =>
  Boolean(getClassNode(symbol));

const classNodeHasStaticMethod = (
  classNode: EsTreeNode,
  methodName: string
): boolean => {
  if (!isClassNode(classNode)) return false;

  for (const element of classNode.body.body ?? []) {
    if (!isNodeOfType(element, "MethodDefinition")) continue;
    if (!element.static || element.computed) continue;
    if (!isNodeOfType(element.key, "Identifier")) continue;
    if (element.key.name === methodName) return true;
  }

  return false;
};

const buildDirectCallMessage = (name: string): string =>
  `Class constructor \`${name}\` is being called like a function — use \`new ${name}()\` instead.`;

const buildMemberCallMessage = (name: string, methodName: string): string =>
  `Class constructor \`${name}\` is being invoked via \`${methodName}()\` — use \`new ${name}()\` instead.`;

const resolveClassSymbol = (
  scopes: ScopeAnalysis,
  identifier: EsTreeNode
): SymbolDescriptor | null => {
  if (!isNodeOfType(identifier, "Identifier")) return null;
  const symbol = scopes.symbolFor(identifier);
  if (!symbol || !symbolIsClassLike(symbol)) return null;
  return symbol;
};

export const noClassConstructorCall = defineRule<Rule>({
  id: "no-class-constructor-call",
  category: "Correctness",
  severity: "error",
  recommendation:
    "Instantiate the class with `new` instead of calling it like a plain function.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const callee = node.callee;

      if (isNodeOfType(callee, "Identifier")) {
        const symbol = resolveClassSymbol(context.scopes, callee);
        if (!symbol) return;

        context.report({
          node: callee,
          message: buildDirectCallMessage(callee.name),
        });
        return;
      }

      if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return;
      if (!isNodeOfType(callee.object, "Identifier")) return;
      if (!isNodeOfType(callee.property, "Identifier")) return;
      if (!CONSTRUCTOR_CALL_METHODS.has(callee.property.name)) return;

      const symbol = resolveClassSymbol(context.scopes, callee.object);
      if (!symbol) return;

      const classNode = getClassNode(symbol);
      if (
        classNode &&
        classNodeHasStaticMethod(classNode, callee.property.name)
      )
        return;

      context.report({
        node: callee,
        message: buildMemberCallMessage(
          callee.object.name,
          callee.property.name
        ),
      });
    },
  }),
});
```

---

<sub>
Generated by `rde discover` (see [millionco/react-doctor-evals#11](https://github.com/millionco/react-doctor-evals/pull/11) for the pipeline). Implementation, test fixtures, and rule registration are deliberately deferred — this PR exists for maintainer triage of the proposal only. Reject, edit-and-approve, or merge after wiring as you see fit.
</sub>
