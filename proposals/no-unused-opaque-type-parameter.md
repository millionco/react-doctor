# Proposal: `react-doctor/no-unused-opaque-type-parameter`

> **Status**: 🟡 Auto-discovered draft proposal. **Not yet implemented.** Maintainer review wanted before any code lands.

|                             |                                        |
| --------------------------- | -------------------------------------- |
| Category                    | `correctness`                          |
| Severity                    | `warn`                                 |
| Source clusters             | `NEW::no-unused-opaque-type-parameter` |
| Independent draft proposals | 1                                      |
| Backing evidence units      | 1                                      |

## Sources

Discovered by the [react-doctor-evals discovery flywheel](https://github.com/millionco/react-doctor-evals/pull/11) mining bug-fix evidence across React OSS repos. The pipeline below produced this proposal:

```
OSS repo → Vercel Sandbox miner → EvidenceUnit → RuleDrafter (LLM) → RuleDedupe → THIS PR
```

### Backing evidence

- [`facebook/react` — `packages/react-flight-server-fb/src/client/ReactFlightClientConfigBundlerFB.js` (DisableChurnMeta)](https://github.com/facebook/react/commit/ad5dfc82b7107728da1430dd142f75b97b684dac)

## Validation prompt

FP-aware guidance for the [react-review agent](https://github.com/millionco/react-review) when triaging this rule:

> Confirm the type parameter is truly unused in the opaque body and not just a phantom brand or public API marker. Skip names that already start with `_`, and be careful with generated Flow wrappers where the generic is intentional even though the body does not reference it. False positives usually come from branded types, adapter shims, or codegen that mirrors an upstream signature.

## Fix prompt

Actionable fix suggestion surfaced to the user when the rule fires:

> Rename intentionally unused Flow type parameters to start with `_` or remove them if the generic is only there to silence `no-unused-vars`. For example:

```js
export opaque type ClientReference<_T> = {
  $$typeof: symbol,
  $$id: string,
  $$hblp: mixed,
};
```

## Positive fixture (SHOULD trigger)

```tsx
export opaque type ClientReference<T> = {
  $$typeof: symbol,
  $$id: string,
  $$hblp: mixed,
};
```

## Negative fixture (should NOT trigger)

```tsx
export opaque type ClientReference<_T> = {
  $$typeof: symbol,
  $$id: string,
  $$hblp: mixed,
};
```

## Proposed AST detector

Would land at `packages/oxlint-plugin-react-doctor/src/plugin/rules/correctness/no-unused-opaque-type-parameter.ts`:

```ts
import { collectReferenceIdentifierNames } from "../../utils/collect-reference-identifier-names.js";
import { defineRule } from "../../utils/define-rule.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

interface FlowTypeParameterLike {
  name?: unknown;
}

interface FlowTypeParametersLike {
  params?: ReadonlyArray<FlowTypeParameterLike>;
}

interface FlowOpaqueTypeNode extends EsTreeNodeOfType<"OpaqueType"> {
  id?: unknown;
  typeParameters?: FlowTypeParametersLike | null;
}

const getTypeParameterName = (
  typeParameterNode: FlowTypeParameterLike
): string | null => {
  const parameterName = typeParameterNode.name;
  if (typeof parameterName === "string") return parameterName;
  if (isNodeOfType(parameterName, "Identifier")) return parameterName.name;
  return null;
};

const collectOpaqueTypeReferences = (
  opaqueTypeNode: FlowOpaqueTypeNode
): Set<string> => {
  const references = new Set<string>();
  collectReferenceIdentifierNames(opaqueTypeNode, references);
  if (isNodeOfType(opaqueTypeNode.id, "Identifier")) {
    references.delete(opaqueTypeNode.id.name);
  }
  return references;
};

export const noUnusedOpaqueTypeParameter = defineRule<Rule>({
  id: "no-unused-opaque-type-parameter",
  severity: "warn",
  recommendation:
    "Rename intentionally unused Flow type parameters to start with `_` (for example, `ClientReference<_T>`) or remove them if the generic is only there to silence `no-unused-vars`",
  create: (context: RuleContext) => ({
    OpaqueType(node: FlowOpaqueTypeNode) {
      const typeParameters = node.typeParameters?.params ?? [];
      if (typeParameters.length === 0) return;

      const references = collectOpaqueTypeReferences(node);
      const unusedTypeParameterNames = typeParameters
        .map((typeParameterNode) => getTypeParameterName(typeParameterNode))
        .filter(
          (name): name is string =>
            name !== null && !name.startsWith("_") && !references.has(name)
        );

      if (unusedTypeParameterNames.length === 0) return;

      const typeName = isNodeOfType(node.id, "Identifier")
        ? node.id.name
        : "opaque type";
      const isPlural = unusedTypeParameterNames.length > 1;

      context.report({
        node,
        message: `${typeName} has unused Flow type parameter${
          isPlural ? "s" : ""
        } ${unusedTypeParameterNames
          .map((name) => `'${name}'`)
          .join(", ")} - rename ${
          isPlural ? "them" : "it"
        } to start with '_' or remove ${
          isPlural ? "them" : "it"
        } instead of disabling no-unused-vars`,
      });
    },
  }),
});
```

---

<sub>
Generated by `rde discover` (see [millionco/react-doctor-evals#11](https://github.com/millionco/react-doctor-evals/pull/11) for the pipeline). Implementation, test fixtures, and rule registration are deliberately deferred — this PR exists for maintainer triage of the proposal only. Reject, edit-and-approve, or merge after wiring as you see fit.
</sub>
