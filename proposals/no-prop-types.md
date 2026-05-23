# Proposal: `react-doctor/no-prop-types`

> **Status**: 🟡 Auto-discovered draft proposal. **Not yet implemented.** Maintainer review wanted before any code lands.

|                        |                      |
| ---------------------- | -------------------- |
| Category               | `architecture`       |
| Severity               | `warn`               |
| Source cluster         | `NEW::no-prop-types` |
| Backing evidence units | 1                    |

## Why the bug exists

> The developer assumed React would continue executing `Component.propTypes` validators at runtime. In React 19 those checks are removed and silently ignored, so invalid props no longer trigger the intended validation path.

## Generality check

> Many React apps and component libraries historically used `propTypes` for runtime validation, especially JavaScript code and published UI packages. Any unrelated React 19 codebase relying on those checks can experience the same silent validation loss.

## Sources

Discovered by the [react-doctor-evals discovery flywheel](https://github.com/millionco/react-doctor-evals/pull/11) mining bug-fix evidence across React OSS repos. This proposal was sourced from the **accepted-review** signal (a reviewer commented + the author edited the file in response + the thread was marked resolved). Pipeline:

```
OSS repo -> GitHub GraphQL (PR review threads) -> acceptance filter (file changed between comment SHA and merge SHA) -> EvidenceUnit -> DraftAgent (gpt-5.5, xhigh reasoning) -> RuleDedupe -> THIS PR
```

### Backing evidence

- [`react-native-elements/react-native-elements` - `packages/base/src/AirbnbRating/SwipeRating.tsx` (AcceptedReviewFixMeta)](https://github.com/react-native-elements/react-native-elements/pull/3990#discussion_r2486066335) — reviewer: human @deepktp · PR #3990 · signal: resolved-and-changed
  > https://react.dev/blog/2024/04/25/react-19-upgrade-guide#removed-proptypes-and-defaultprops

## Validation prompt

FP-aware guidance for the [react-review agent](https://github.com/millionco/react-review) when triaging this rule:

> Verify the reported `propTypes` is being used as React runtime prop validation in a React 19+ component. False positive: `propTypes` is only metadata consumed by a documentation or design-system tool and React validation is not expected. False positive: the uppercase receiver is not a React component but a custom class or namespace object with an unrelated `propTypes` property.

## Fix prompt

> Replace `Component.propTypes` with static props types and explicit runtime validation only where runtime data can be invalid. For defaults, use destructuring defaults in the component signature. Example: `interface Props { value?: number }\nfunction Component({ value = 0 }: Props) {\n  React.useEffect(() => {\n    if (value < 0 || value > 20) console.error('value must be between 0 and 20');\n  }, [value]);\n  return <span>{value}</span>;\n}`

## Positive fixture (SHOULD trigger)

```tsx
import React from "react";
import PropTypes from "prop-types";

function Component({ value }) {
  return <span>{value}</span>;
}

Component.propTypes = {
  value: PropTypes.number,
};
```

## Negative fixture (should NOT trigger)

```tsx
import React from "react";

interface Props {
  value?: number;
}

function Component({ value = 0 }: Props) {
  return <span>{value}</span>;
}
```

## Proposed AST detector

Would land at `packages/oxlint-plugin-react-doctor/src/plugin/rules/architecture/no-prop-types.ts`:

```ts
import { defineRule } from "../../utils/define-rule.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const PROP_TYPES_PROPERTY = "propTypes";

const isPropTypesKey = (key: EsTreeNode | null | undefined, computed: boolean): boolean => {
  if (!key) return false;
  if (computed) return isNodeOfType(key, "Literal") && key.value === PROP_TYPES_PROPERTY;
  return isNodeOfType(key, "Identifier") && key.name === PROP_TYPES_PROPERTY;
};

const getComponentNameFromPropTypesAssignment = (left: EsTreeNode): string | null => {
  if (!isNodeOfType(left, "MemberExpression")) return null;
  if (!isPropTypesKey(left.property, Boolean(left.computed))) return null;
  if (!isNodeOfType(left.object, "Identifier")) return null;
  if (!isUppercaseName(left.object.name)) return null;
  return left.object.name;
};

const getComponentNameFromClassProperty = (
  node: EsTreeNodeOfType<"PropertyDefinition">,
): string | null => {
  if (!node.static) return null;
  if (!isPropTypesKey(node.key, Boolean(node.computed))) return null;

  const classBody = node.parent;
  if (!isNodeOfType(classBody, "ClassBody")) return null;
  const classNode = classBody.parent;
  if (!classNode) return null;

  if (
    (isNodeOfType(classNode, "ClassDeclaration") || isNodeOfType(classNode, "ClassExpression")) &&
    classNode.id?.name &&
    isUppercaseName(classNode.id.name)
  ) {
    return classNode.id.name;
  }

  if (!isNodeOfType(classNode, "ClassExpression")) return null;
  const declarator = classNode.parent;
  if (!isNodeOfType(declarator, "VariableDeclarator")) return null;
  if (!isNodeOfType(declarator.id, "Identifier")) return null;
  if (!isUppercaseName(declarator.id.name)) return null;
  return declarator.id.name;
};

export const noPropTypes = defineRule<Rule>({
  id: "no-prop-types",
  requires: ["react:19"],
  tags: ["test-noise", "migration-hint"],
  severity: "warn",
  recommendation:
    "React 19 no longer runs `propTypes` checks. Use TypeScript for static props and move required runtime validation to schema parsing or explicit checks in component code.",
  create: (context: RuleContext) => ({
    AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
      if (node.operator !== "=") return;
      const componentName = getComponentNameFromPropTypesAssignment(node.left);
      if (!componentName) return;
      context.report({
        node: node.left,
        message: `${componentName}.propTypes - React 19 ignores propTypes checks. Move props to TypeScript types or explicit runtime validation instead`,
      });
    },
    PropertyDefinition(node: EsTreeNodeOfType<"PropertyDefinition">) {
      const componentName = getComponentNameFromClassProperty(node);
      if (!componentName) return;
      context.report({
        node: node.key,
        message: `${componentName}.propTypes - React 19 ignores propTypes checks. Move props to TypeScript types or explicit runtime validation instead`,
      });
    },
  }),
});
```

---

<sub>
Generated by `rde discover` (v3: accepted-review evidence + WHY-reasoning + generality check + explicit abstain). See [millionco/react-doctor-evals#11](https://github.com/millionco/react-doctor-evals/pull/11) for the pipeline. Implementation, test fixtures, and rule registration are deliberately deferred — this PR exists for maintainer triage of the proposal only.
</sub>
