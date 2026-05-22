# Proposal: `react-doctor/no-defer-render-until-mounted`

> **Status**: 🟡 Auto-discovered draft proposal. **Not yet implemented.** Maintainer review wanted before any code lands.

|                             |                                      |
| --------------------------- | ------------------------------------ |
| Category                    | `client`                             |
| Severity                    | `warn`                               |
| Source clusters             | `NEW::no-defer-render-until-mounted` |
| Independent draft proposals | 1                                    |
| Backing evidence units      | 1                                    |

## Sources

Discovered by the [react-doctor-evals discovery flywheel](https://github.com/millionco/react-doctor-evals/pull/11) mining bug-fix evidence across React OSS repos. The pipeline below produced this proposal:

```
OSS repo → Vercel Sandbox miner → EvidenceUnit → RuleDrafter (LLM) → RuleDedupe → THIS PR
```

### Backing evidence

- [`freeCodeCamp/freeCodeCamp` — `client/src/templates/Challenges/components/mobile-app-modal.test.tsx` (FixCommitMeta)](https://github.com/freeCodeCamp/freeCodeCamp/commit/90cc514f786f3d786cb66ab2fd6fee26d3471a00)

## Validation prompt

FP-aware guidance for the [react-review agent](https://github.com/millionco/react-review) when triaging this rule:

> Check that this is a real mount-gated client component, not an explicit `ClientOnly`/`NoSsr` wrapper or a third-party widget that truly cannot render on the server. The key pattern is a boolean state initialized to `false`, flipped to `true` in an empty-deps effect, and then used to return `null` or otherwise suppress the first render. If the component still renders a meaningful shell or placeholder while hydrating, this should usually not be flagged.

## Fix prompt

Actionable fix suggestion surfaced to the user when the rule fires:

> Render a stable shell on the first pass and keep only the browser-only work behind an effect or inside a smaller client-only child. For example:

```tsx
export function MobileAppModal() {
  return <MobileAppModalContent />;
}
```

If a browser-only subtree is unavoidable, isolate just that subtree instead of hiding the entire component until `mounted` becomes `true`.

## Positive fixture (SHOULD trigger)

```tsx
import { useEffect, useState } from "react";

export const MobileAppModal = () => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return <div>modal</div>;
};
```

## Negative fixture (should NOT trigger)

```tsx
import { useEffect, useState } from "react";

export const MobileAppModal = () => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return mounted ? <div>modal</div> : <span>loading</span>;
};
```

## Proposed AST detector

Would land at `packages/oxlint-plugin-react-doctor/src/plugin/rules/client/no-defer-render-until-mounted.ts`:

```ts
import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { walkAst } from "../../utils/walk-ast.js";
import { walkInsideStatementBlocks } from "../../utils/walk-inside-statement-blocks.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { collectUseStateBindings } from "../state-and-effects/utils/collect-use-state-bindings.js";

const isFalseLiteral = (node: EsTreeNode | null | undefined): boolean =>
  isNodeOfType(node, "Literal") && node.value === false;

const isNullishRenderValue = (node: EsTreeNode | null | undefined): boolean =>
  !node ||
  (isNodeOfType(node, "Literal") &&
    (node.value === null || node.value === false));

const containsStateIdentifier = (
  node: EsTreeNode,
  stateName: string
): boolean => {
  let didFind = false;
  walkAst(node, (child) => {
    if (didFind) return false;
    if (isNodeOfType(child, "Identifier") && child.name === stateName) {
      didFind = true;
      return false;
    }
  });
  return didFind;
};

const isNegativeStateGuard = (node: EsTreeNode, stateName: string): boolean => {
  let didFind = false;
  walkAst(node, (child) => {
    if (didFind) return false;
    if (
      isNodeOfType(child, "UnaryExpression") &&
      child.operator === "!" &&
      isNodeOfType(child.argument, "Identifier") &&
      child.argument.name === stateName
    ) {
      didFind = true;
      return false;
    }
    if (
      isNodeOfType(child, "BinaryExpression") &&
      (child.operator === "===" || child.operator === "==") &&
      ((isNodeOfType(child.left, "Identifier") &&
        child.left.name === stateName &&
        isFalseLiteral(child.right)) ||
        (isNodeOfType(child.right, "Identifier") &&
          child.right.name === stateName &&
          isFalseLiteral(child.left)))
    ) {
      didFind = true;
      return false;
    }
  });
  return didFind;
};

const isNullishReturningBranch = (
  node: EsTreeNode | null | undefined
): boolean => {
  if (!node) return false;
  if (isNodeOfType(node, "ReturnStatement")) {
    return isNullishRenderValue(node.argument);
  }
  if (isNodeOfType(node, "BlockStatement")) {
    const statements = node.body ?? [];
    return (
      statements.length === 1 &&
      isNodeOfType(statements[0], "ReturnStatement") &&
      isNullishRenderValue(statements[0].argument)
    );
  }
  return false;
};

const isMountedGateStatement = (
  statement: EsTreeNode,
  stateName: string
): boolean => {
  if (isNodeOfType(statement, "IfStatement")) {
    if (!isNegativeStateGuard(statement.test, stateName)) return false;
    return isNullishReturningBranch(statement.consequent);
  }

  if (isNodeOfType(statement, "ReturnStatement") && statement.argument) {
    if (isNodeOfType(statement.argument, "ConditionalExpression")) {
      if (
        isNegativeStateGuard(statement.argument.test, stateName) &&
        isNullishRenderValue(statement.argument.consequent)
      ) {
        return true;
      }
      if (
        containsStateIdentifier(statement.argument.test, stateName) &&
        isNullishRenderValue(statement.argument.alternate)
      ) {
        return true;
      }
    }

    if (
      isNodeOfType(statement.argument, "LogicalExpression") &&
      statement.argument.operator === "&&" &&
      containsStateIdentifier(statement.argument.left, stateName)
    ) {
      return true;
    }
  }

  return false;
};

const isMountEffect = (
  componentBody: EsTreeNode,
  setterName: string
): boolean => {
  if (!isNodeOfType(componentBody, "BlockStatement")) return false;

  for (const statement of componentBody.body ?? []) {
    if (!isNodeOfType(statement, "ExpressionStatement")) continue;
    if (!isHookCall(statement.expression, EFFECT_HOOK_NAMES)) continue;
    if ((statement.expression.arguments?.length ?? 0) < 2) continue;

    const depsNode = statement.expression.arguments[1];
    if (
      !isNodeOfType(depsNode, "ArrayExpression") ||
      (depsNode.elements?.length ?? 0) !== 0
    ) {
      continue;
    }

    const callback = getEffectCallback(statement.expression);
    if (!callback) continue;

    let didFindSetter = false;
    walkInsideStatementBlocks(callback.body, (child) => {
      if (didFindSetter) return;
      if (!isNodeOfType(child, "CallExpression")) return;
      if (!isNodeOfType(child.callee, "Identifier")) return;
      if (child.callee.name !== setterName) return;
      const firstArgument = child.arguments?.[0];
      if (
        !isNodeOfType(firstArgument, "Literal") ||
        firstArgument.value !== true
      )
        return;
      didFindSetter = true;
    });

    if (didFindSetter) return true;
  }

  return false;
};

const findMountedGateStatement = (
  componentBody: EsTreeNode,
  stateName: string
): EsTreeNode | null => {
  if (!isNodeOfType(componentBody, "BlockStatement")) return null;

  for (const statement of componentBody.body ?? []) {
    if (isMountedGateStatement(statement, stateName)) return statement;
  }

  return null;
};

const checkComponent = (
  componentBody: EsTreeNode | null | undefined,
  context: RuleContext
): void => {
  if (!componentBody || !isNodeOfType(componentBody, "BlockStatement")) return;

  for (const binding of collectUseStateBindings(componentBody)) {
    const initializer = binding.declarator.init;
    if (!isNodeOfType(initializer, "CallExpression")) continue;
    if (
      !isNodeOfType(initializer.arguments?.[0], "Literal") ||
      initializer.arguments[0].value !== false
    ) {
      continue;
    }
    if (!isMountEffect(componentBody, binding.setterName)) continue;

    const gateStatement = findMountedGateStatement(
      componentBody,
      binding.valueName
    );
    if (!gateStatement) continue;

    context.report({
      node: gateStatement,
      message: `Avoid deferring the whole render behind \`${binding.valueName}\` — render a stable shell on the first pass and keep browser-only work inside an effect or a smaller client-only subtree`,
    });
    return;
  }
};

export const noDeferRenderUntilMounted = defineRule<Rule>({
  id: "no-defer-render-until-mounted",
  severity: "warn",
  recommendation:
    "Render a stable shell immediately and move browser-only logic into a nested client-only subtree or effect instead of returning null until the component has mounted",
  create: (context: RuleContext) => ({
    FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
      if (!node.id?.name || !isUppercaseName(node.id.name)) return;
      checkComponent(node.body, context);
    },
    VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
      if (!isComponentAssignment(node)) return;
      if (
        !isNodeOfType(node.init, "ArrowFunctionExpression") &&
        !isNodeOfType(node.init, "FunctionExpression")
      ) {
        return;
      }
      checkComponent(node.init.body, context);
    },
  }),
});
```

---

<sub>
Generated by `rde discover` (see [millionco/react-doctor-evals#11](https://github.com/millionco/react-doctor-evals/pull/11) for the pipeline). Implementation, test fixtures, and rule registration are deliberately deferred — this PR exists for maintainer triage of the proposal only. Reject, edit-and-approve, or merge after wiring as you see fit.
</sub>
