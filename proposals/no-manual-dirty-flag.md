# Proposal: `react-doctor/no-manual-dirty-flag`

> **Status**: 🟡 Auto-discovered draft proposal. **Not yet implemented.** Maintainer review wanted before any code lands.

| | |
| --- | --- |
| Category | `state-and-effects` |
| Severity | `warn` |
| Source clusters | `NEW::no-manual-dirty-flag` |
| Independent draft proposals | 1 |
| Backing evidence units | 1 |

## Sources

Discovered by the [react-doctor-evals discovery flywheel](https://github.com/millionco/react-doctor-evals/pull/11) mining bug-fix evidence across React OSS repos. The pipeline below produced this proposal:

```
OSS repo → Vercel Sandbox miner → EvidenceUnit → RuleDrafter (LLM) → RuleDedupe → THIS PR
```

### Backing evidence

- [`freeCodeCamp/freeCodeCamp` — `client/src/components/profile/components/profile-privacy.tsx` (FixCommitMeta)](https://github.com/freeCodeCamp/freeCodeCamp/commit/7d62ea3f5fdd6494588d1abda5480985ee422fff)

## Validation prompt

FP-aware guidance for the [react-review agent](https://github.com/millionco/react-review) when triaging this rule:

> Confirm this is a manually managed change-tracking flag, not a legitimate UI boolean like `isExpanded`, `isLoading`, or `isSubmitting`. Typical false positives are components that already derive the flag from a comparison, or booleans whose names mention changes but are actually unrelated status flags. Only report when there is editable state alongside explicit `true`/`false` setter writes and a negated read such as `if (!madeChanges)` or `disabled={!madeChanges}`.

## Fix prompt

Actionable fix suggestion surfaced to the user when the rule fires:

> Keep the editable values in state and derive the dirty flag from a baseline snapshot during render. After a successful save, reset the snapshot instead of flipping a separate boolean.
```tsx
const [initialValues, setInitialValues] = useState(values);
const [values, setValues] = useState(values);
const madeChanges = !isEqual(values, initialValues);
// after save
setInitialValues(values);
```

## Positive fixture (SHOULD trigger)

```tsx
import { useState } from 'react';

function Form() {
  const [values, setValues] = useState({ name: '' });
  const [madeChanges, setMadeChanges] = useState(false);

  const toggle = () => {
    setValues({ ...values, name: 'Ada' });
    setMadeChanges(true);
  };

  const save = (event) => {
    event.preventDefault();
    if (!madeChanges) return;
    setMadeChanges(false);
  };

  return (
    <form onSubmit={save}>
      <button type='button' onClick={toggle}>Edit</button>
      <button type='submit' disabled={!madeChanges}>Save</button>
    </form>
  );
}
```

## Negative fixture (should NOT trigger)

```tsx
import { useState } from 'react';

function Form() {
  const [initialValues] = useState({ name: '' });
  const [values, setValues] = useState(initialValues);
  const madeChanges = values.name !== initialValues.name;

  return <button disabled={!madeChanges}>Save</button>;
}
```

## Proposed AST detector

Would land at `packages/oxlint-plugin-react-doctor/src/plugin/rules/state-and-effects/no-manual-dirty-flag.ts`:

```ts
import { createComponentPropStackTracker } from '../../utils/create-component-prop-stack-tracker.js';
import { defineRule } from '../../utils/define-rule.js';
import type { EsTreeNode } from '../../utils/es-tree-node.js';
import type { EsTreeNodeOfType } from '../../utils/es-tree-node-of-type.js';
import { isNodeOfType } from '../../utils/is-node-of-type.js';
import type { Rule } from '../../utils/rule.js';
import type { RuleContext } from '../../utils/rule-context.js';
import { walkAst } from '../../utils/walk-ast.js';
import { collectUseStateBindings } from './utils/collect-use-state-bindings.js';

interface DirtyFlagStateBinding {
  valueName: string;
  setterName: string;
  declarator: EsTreeNodeOfType<'VariableDeclarator'>;
}

const DIRTY_FLAG_NAME_PATTERN = /(dirty|change|changes|modified|unsaved)/i;

const isBooleanLiteral = (node: EsTreeNode | null | undefined, expectedValue: boolean): boolean =>
  isNodeOfType(node, 'Literal') && node.value === expectedValue;

const getUseStateInitializer = (
  declarator: EsTreeNodeOfType<'VariableDeclarator'>,
): EsTreeNode | null => {
  if (!isNodeOfType(declarator.init, 'CallExpression')) return null;
  return declarator.init.arguments?.[0] ?? null;
};

const isObjectLikeInitializer = (node: EsTreeNode | null | undefined): boolean =>
  Boolean(node) &&
  (isNodeOfType(node, 'ObjectExpression') || isNodeOfType(node, 'ArrayExpression'));

const hasSetterCallWithBooleanLiteral = (
  componentBody: EsTreeNode,
  setterName: string,
  expectedValue: boolean,
): boolean => {
  let didFindMatch = false;
  walkAst(componentBody, (child: EsTreeNode) => {
    if (didFindMatch) return false;
    if (!isNodeOfType(child, 'CallExpression')) return;
    if (!isNodeOfType(child.callee, 'Identifier')) return;
    if (child.callee.name !== setterName) return;
    const firstArgument = child.arguments?.[0];
    if (!isBooleanLiteral(firstArgument, expectedValue)) return;
    didFindMatch = true;
  });
  return didFindMatch;
};

const hasSetterCallWithObjectLikeValue = (
  componentBody: EsTreeNode,
  setterName: string,
): boolean => {
  let didFindMatch = false;
  walkAst(componentBody, (child: EsTreeNode) => {
    if (didFindMatch) return false;
    if (!isNodeOfType(child, 'CallExpression')) return;
    if (!isNodeOfType(child.callee, 'Identifier')) return;
    if (child.callee.name !== setterName) return;
    const firstArgument = child.arguments?.[0];
    if (!isObjectLikeInitializer(firstArgument)) return;
    didFindMatch = true;
  });
  return didFindMatch;
};

const hasNegatedIdentifierRead = (componentBody: EsTreeNode, valueName: string): boolean => {
  let didFindMatch = false;
  walkAst(componentBody, (child: EsTreeNode) => {
    if (didFindMatch) return false;
    if (!isNodeOfType(child, 'UnaryExpression')) return;
    if (child.operator !== '!') return;
    if (!isNodeOfType(child.argument, 'Identifier')) return;
    if (child.argument.name !== valueName) return;
    didFindMatch = true;
  });
  return didFindMatch;
};

const hasObjectLikeSiblingState = (
  componentBody: EsTreeNode,
  bindings: Array<DirtyFlagStateBinding>,
  dirtyValueName: string,
): boolean =>
  bindings.some((binding) => {
    if (binding.valueName === dirtyValueName) return false;
    if (!isObjectLikeInitializer(getUseStateInitializer(binding.declarator))) return false;
    return hasSetterCallWithObjectLikeValue(componentBody, binding.setterName);
  });

export const noManualDirtyFlag = defineRule<Rule>({
  id: 'no-manual-dirty-flag',
  severity: 'warn',
  tags: ['test-noise'],
  recommendation:
    'Derive the dirty flag from the editable values and an initial snapshot during render instead of storing a separate boolean. After a successful save, reset the baseline snapshot rather than flipping a second piece of state.',
  create: (context: RuleContext) => {
    const checkComponent = (componentBody: EsTreeNode | null | undefined): void => {
      if (!componentBody || !isNodeOfType(componentBody, 'BlockStatement')) return;
      const useStateBindings: Array<DirtyFlagStateBinding> = collectUseStateBindings(componentBody);
      if (useStateBindings.length === 0) return;

      for (const binding of useStateBindings) {
        const initializer = getUseStateInitializer(binding.declarator);
        if (!isBooleanLiteral(initializer, false) && !isBooleanLiteral(initializer, true)) continue;
        if (!DIRTY_FLAG_NAME_PATTERN.test(binding.valueName)) continue;
        if (!hasSetterCallWithBooleanLiteral(componentBody, binding.setterName, true)) continue;
        if (!hasSetterCallWithBooleanLiteral(componentBody, binding.setterName, false)) continue;
        if (!hasNegatedIdentifierRead(componentBody, binding.valueName)) continue;
        if (!hasObjectLikeSiblingState(componentBody, useStateBindings, binding.valueName)) continue;

        const useStateCall = binding.declarator.init;
        if (!isNodeOfType(useStateCall, 'CallExpression')) continue;

        context.report({
          node: useStateCall,
          message:
            `Avoid storing '${binding.valueName}' as separate boolean state. Derive it from the editable values and an initial snapshot instead.`,
        });
      }
    };

    const propStackTracker = createComponentPropStackTracker({
      onComponentEnter: checkComponent,
    });

    return propStackTracker.visitors;
  },
});
```

---

<sub>
Generated by `rde discover` (see [millionco/react-doctor-evals#11](https://github.com/millionco/react-doctor-evals/pull/11) for the pipeline). Implementation, test fixtures, and rule registration are deliberately deferred — this PR exists for maintainer triage of the proposal only. Reject, edit-and-approve, or merge after wiring as you see fit.
</sub>

