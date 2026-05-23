# Proposal: `react-doctor/no-overridable-source-uri`

> **Status**: 🟡 Auto-discovered draft proposal. **Not yet implemented.** Maintainer review wanted before any code lands.

|                        |                                  |
| ---------------------- | -------------------------------- |
| Category               | `react-native`                   |
| Severity               | `warn`                           |
| Source cluster         | `NEW::no-overridable-source-uri` |
| Backing evidence units | 1                                |

## Why the bug exists

> The developer assumed spreading additional source options after `uri` would only add optional fields. Object spread order means later spreads overwrite earlier keys, so a supplied `uri` can replace the value the component intended to render.

## Generality check

> React Native apps commonly merge source options with a computed URI in JSX. Any wrapper component that puts caller-provided source options after `uri` can silently render the wrong resource.

## Sources

Discovered by the [react-doctor-evals discovery flywheel](https://github.com/millionco/react-doctor-evals/pull/11) mining bug-fix evidence across React OSS repos. This proposal was sourced from the **accepted-review** signal (a reviewer commented + the author edited the file in response + the thread was marked resolved). Pipeline:

```
OSS repo -> GitHub GraphQL (PR review threads) -> acceptance filter (file changed between comment SHA and merge SHA) -> EvidenceUnit -> DraftAgent (gpt-5.5, xhigh reasoning) -> RuleDedupe -> THIS PR
```

### Backing evidence

- [`FaridSafi/react-native-gifted-chat` - `src/MessageImage.tsx` (AcceptedReviewFixMeta)](https://github.com/FaridSafi/react-native-gifted-chat/pull/2330#discussion_r1284343654) — reviewer: human @Johan-dutoit · PR #2330 · signal: resolved-and-changed
  > Would the following change make more sense? As it'll preserve the uri coming from the message and not allowed to be overridden.

## Validation prompt

FP-aware guidance for the [react-review agent](https://github.com/millionco/react-review) when triaging this rule:

> Verify that the `uri` in the flagged `source` object is the authoritative value for what should render, rather than just a default. Typical false positives are a spread object with a type or local construction that cannot include `uri`, and a deliberate default URI that caller-provided source options are allowed to replace.

## Fix prompt

> Put spreads before the authoritative field so later properties cannot replace it, or omit `uri` from the options object before spreading. Example: `<Image source={{ ...props, uri: value }} />` instead of `<Image source={{ uri: value, ...props }} />`.

## Positive fixture (SHOULD trigger)

```tsx
import React from "react";
import { Image } from "react-native";

export function Component({ value, props }) {
  return <Image source={{ uri: value, ...props }} />;
}
```

## Negative fixture (should NOT trigger)

```tsx
import React from "react";
import { Image } from "react-native";

export function Component({ value, props }) {
  return <Image source={{ ...props, uri: value }} />;
}
```

## Proposed AST detector

Would land at `packages/oxlint-plugin-react-doctor/src/plugin/rules/react-native/no-overridable-source-uri.ts`:

```ts
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const getStaticPropertyName = (node: unknown): string | null => {
  if (!isNodeOfType(node, "Property")) return null;
  if (node.computed) return null;

  const key = node.key;
  if (isNodeOfType(key, "Identifier")) return key.name;
  if (isNodeOfType(key, "Literal") && typeof key.value === "string") return key.value;
  return null;
};

const isSourceAttribute = (node: EsTreeNodeOfType<"JSXAttribute">): boolean =>
  isNodeOfType(node.name, "JSXIdentifier") && node.name.name === "source";

const hasUriBeforeSpread = (node: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  if (!isNodeOfType(node.value, "JSXExpressionContainer")) return false;
  if (!isNodeOfType(node.value.expression, "ObjectExpression")) return false;

  let didSeeUriProperty = false;
  for (const property of node.value.expression.properties ?? []) {
    if (isNodeOfType(property, "SpreadElement")) {
      if (didSeeUriProperty) return true;
      continue;
    }

    if (getStaticPropertyName(property) === "uri") didSeeUriProperty = true;
  }

  return false;
};

export const noOverridableSourceUri = defineRule<Rule>({
  id: "no-overridable-source-uri",
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "Put source option spreads before `uri` when the rendered source must come from component state or props.",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      if (!isSourceAttribute(node)) return;
      if (!hasUriBeforeSpread(node)) return;

      context.report({
        node,
        message:
          "A source object sets `uri` before a spread, so the spread can override the rendered URI. Move spreads before `uri` when this component owns the source value.",
      });
    },
  }),
});
```

---

<sub>
Generated by `rde discover` (v3: accepted-review evidence + WHY-reasoning + generality check + explicit abstain). See [millionco/react-doctor-evals#11](https://github.com/millionco/react-doctor-evals/pull/11) for the pipeline. Implementation, test fixtures, and rule registration are deliberately deferred — this PR exists for maintainer triage of the proposal only.
</sub>
