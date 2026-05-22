# Proposal: `react-doctor/no-trans-without-parent`

> **Status**: 🟡 Auto-discovered draft proposal. **Not yet implemented.** Maintainer review wanted before any code lands.

| | |
| --- | --- |
| Category | `react-ui` |
| Severity | `warn` |
| Source clusters | `NEW::no-trans-without-parent` |
| Independent draft proposals | 1 |
| Backing evidence units | 1 |

## Sources

Discovered by the [react-doctor-evals discovery flywheel](https://github.com/millionco/react-doctor-evals/pull/11) mining bug-fix evidence across React OSS repos. The pipeline below produced this proposal:

```
OSS repo → Vercel Sandbox miner → EvidenceUnit → RuleDrafter (LLM) → RuleDedupe → THIS PR
```

### Backing evidence

- [`freeCodeCamp/freeCodeCamp` — `client/src/client-only-routes/show-settings.tsx` (FixCommitMeta)](https://github.com/freeCodeCamp/freeCodeCamp/commit/c7072338b1f08b1ee7b4b34fd095098f14662e67)

## Validation prompt

FP-aware guidance for the [react-review agent](https://github.com/millionco/react-review) when triaging this rule:

> Treat this as a paragraph-semantic issue, not a generic `<Trans>` style nit. False positives include inline phrases inside sentences, `Trans` blocks that already sit inside a semantic wrapper, and deliberately inline copy where a block parent would be wrong. If the translated content is standalone user-facing prose or a disclaimer and no explicit `parent` is set, the finding is likely real.

## Fix prompt

Actionable fix suggestion surfaced to the user when the rule fires:

> Wrap standalone translation copy in a semantic block and give `Trans` an explicit `parent`, usually `p`, so margins and text flow behave correctly.
```tsx
<Trans i18nKey="settings.profile-note" parent="p" className="text-center">
  <a href={`/${username}`}>your profile</a>
</Trans>
```
If the translation is intentionally inline, keep it inline and do not add a block parent.

## Positive fixture (SHOULD trigger)

```tsx
import { Trans } from "react-i18next";

export function Example() {
  return (
    <Trans i18nKey="settings.profile-note">
      Please read the <a href="/docs">docs</a>.
    </Trans>
  );
}
```

## Negative fixture (should NOT trigger)

```tsx
import { Trans } from "react-i18next";

export function Example() {
  return (
    <Trans i18nKey="settings.profile-note" parent="p">
      Please read the <a href="/docs">docs</a>.
    </Trans>
  );
}
```

## Proposed AST detector

Would land at `packages/oxlint-plugin-react-doctor/src/plugin/rules/react-ui/no-trans-without-parent.ts`:

```ts
import { defineRule } from "../../utils/define-rule.js";
import { isImportedFromModule } from "../../utils/find-import-source-for-name.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getOpeningElementTagName } from "./utils/get-opening-element-tag-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const REACT_I18NEXT_MODULE = "react-i18next";

const hasVisibleTransContent = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "JSXText")) return Boolean(node.value.trim());

  if (isNodeOfType(node, "JSXExpressionContainer")) {
    const expression = node.expression;
    if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") {
      return Boolean(expression.value.trim());
    }
    return false;
  }

  if (isNodeOfType(node, "JSXElement")) {
    for (const childNode of node.children) {
      if (hasVisibleTransContent(childNode)) return true;
    }
    return false;
  }

  if (isNodeOfType(node, "JSXFragment")) {
    for (const childNode of node.children) {
      if (hasVisibleTransContent(childNode)) return true;
    }
    return false;
  }

  return false;
};

const usesStandaloneTrans = (jsxElementNode: EsTreeNodeOfType<"JSXElement">): boolean => {
  const openingElement = jsxElementNode.openingElement;
  const tagName = getOpeningElementTagName(openingElement);
  if (tagName !== "Trans") return false;
  if (!isImportedFromModule(jsxElementNode, tagName, REACT_I18NEXT_MODULE)) return false;
  if (findJsxAttribute(openingElement.attributes, "parent")) return false;

  for (const childNode of jsxElementNode.children) {
    if (hasVisibleTransContent(childNode)) return true;
  }
  return false;
};

export const noTransWithoutParent = defineRule<Rule>({
  id: "no-trans-without-parent",
  severity: "warn",
  recommendation:
    "Use `parent=\"p\"` for standalone `react-i18next` `<Trans>` copy, or wrap it in another semantic block element when the text is meant to behave like a paragraph.",
  create: (context) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (!usesStandaloneTrans(node)) return;
      context.report({
        node: node.openingElement,
        message:
          "`react-i18next` <Trans> copy without an explicit `parent` often renders with the wrong box model and margins - use `parent=\"p\"` (or another block element) for paragraph-style content.",
      });
    },
  }),
});
```

---

<sub>
Generated by `rde discover` (see [millionco/react-doctor-evals#11](https://github.com/millionco/react-doctor-evals/pull/11) for the pipeline). Implementation, test fixtures, and rule registration are deliberately deferred — this PR exists for maintainer triage of the proposal only. Reject, edit-and-approve, or merge after wiring as you see fit.
</sub>

