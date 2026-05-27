# Proposal: `react-doctor/no-render-prop-slots`

> **Status**: 🟡 Auto-discovered draft proposal from a curated **knowledge-base** principle. **Not yet implemented.** Maintainer review wanted before any code lands.

|                        |                             |
| ---------------------- | --------------------------- |
| Category               | `architecture`              |
| Severity               | `warn`                      |
| Source cluster         | `NEW::no-render-prop-slots` |
| Backing evidence units | 1                           |

## Why the bug exists

> Developers add renderer callbacks for each customization point, assuming a single parent component should own every slot and conditional branch. As variants grow, that API becomes rigid and pushes state or layout knowledge through props.

## Generality check

> Multiple render-slot props create the same composition bottleneck across React apps regardless of domain or design system. Compound components and `children` are standard React patterns for letting consumers choose structure while shared context carries state where needed.

## Sources

Discovered by the [react-doctor-evals discovery flywheel](https://github.com/millionco/react-doctor-evals/pull/11) via a new **knowledge-doc evidence source** that mines curated principle libraries (this evidence comes from the [react-doctor-knowledge-base](https://github.com/millionco/react-doctor-knowledge-base) repo). Pipeline:

```
knowledge-base markdown -> heading-anchored section split -> EvidenceUnit (KnowledgeDocMeta) -> DraftAgent (gpt-5.5, xhigh reasoning) -> RuleDedupe -> THIS PR
```

### Backing principle

- Skill: **vercel-composition-patterns** — section _1.2 Use Compound Components_ of `React Composition Patterns`

## Validation prompt

FP-aware guidance for the [react-review agent](https://github.com/millionco/react-review):

> Confirm the component is exposing several `renderXxx` callbacks as UI slots that the parent orchestrates. Typical false positives are third-party components whose documented API intentionally requires multiple renderer callbacks, and adapter components that only forward those callbacks without owning layout or state. Also suppress if the functions are data formatters or non-JSX callbacks rather than render slots.

## Fix prompt

> Replace the render-slot props with explicit composition. For example, prefer `const Dialog = { Root, Header, Body, Actions }` and `<Dialog.Root><Dialog.Header /><Dialog.Body /><Dialog.Actions /></Dialog.Root>` over `<Dialog renderHeader={...} renderBody={...} renderActions={...} />`. If subcomponents need shared state, provide it through context from the root/provider component.

## Positive fixture (SHOULD trigger)

```tsx
function Dialog({ renderHeader, renderBody, renderActions }) {
  return (
    <section>
      {renderHeader?.()}
      {renderBody?.()}
      {renderActions?.()}
    </section>
  );
}

<Dialog
  renderHeader={() => <h1>Title</h1>}
  renderBody={() => <p>Body</p>}
  renderActions={() => <button>Save</button>}
/>;
```

## Negative fixture (should NOT trigger)

```tsx
function Autocomplete({ renderInput, options }) {
  return <div>{renderInput(options)}</div>;
}

<Autocomplete renderInput={(options) => <input aria-label={options.label} />} />;
```

## Proposed AST detector

Would land at `packages/oxlint-plugin-react-doctor/src/plugin/rules/architecture/no-render-prop-slots.ts`:

```ts
import { RENDER_PROP_PROLIFERATION_THRESHOLD } from "../../constants/thresholds.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isComponentDeclaration } from "../../utils/is-component-declaration.js";
import { isInlineFunctionExpression } from "../../utils/is-inline-function-expression.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";

const RENDER_PROP_PATTERN = /^render[A-Z]/;

const collectRenderPropsFromBody = (
  componentBody: EsTreeNode | undefined,
  propsParamName: string,
): Set<string> => {
  const renderPropNames = new Set<string>();
  if (!componentBody) return renderPropNames;
  walkAst(componentBody, (child: EsTreeNode) => {
    if (!isNodeOfType(child, "MemberExpression")) return;
    if (child.computed) return;
    if (!isNodeOfType(child.object, "Identifier")) return;
    if (child.object.name !== propsParamName) return;
    if (!isNodeOfType(child.property, "Identifier")) return;
    if (!RENDER_PROP_PATTERN.test(child.property.name)) return;
    renderPropNames.add(child.property.name);
  });
  return renderPropNames;
};

const collectRenderPropsFromObjectPattern = (param: EsTreeNode | undefined): string[] => {
  if (!isNodeOfType(param, "ObjectPattern")) return [];
  const renderPropNames: string[] = [];
  for (const property of param.properties ?? []) {
    if (!isNodeOfType(property, "Property")) continue;
    const keyName = isNodeOfType(property.key, "Identifier") ? property.key.name : null;
    if (!keyName) continue;
    if (!RENDER_PROP_PATTERN.test(keyName)) continue;
    renderPropNames.push(keyName);
  }
  return renderPropNames;
};

export const noRenderPropSlots = defineRule<Rule>({
  id: "no-render-prop-slots",
  severity: "warn",
  tags: ["test-noise", "react-jsx-only"],
  recommendation:
    "Replace multiple `renderXxx` slot props with compound subcomponents or `children` so consumers compose the pieces they need",
  create: (context: RuleContext) => {
    const reportIfMany = (
      renderPropNames: string[],
      componentName: string,
      reportNode: EsTreeNode,
    ): void => {
      if (renderPropNames.length < RENDER_PROP_PROLIFERATION_THRESHOLD) return;
      context.report({
        node: reportNode,
        message: `Component ${componentName} exposes ${renderPropNames.length} render-prop slots (${renderPropNames.slice(0, 3).join(", ")}...) - prefer compound subcomponents or children for flexible composition`,
      });
    };

    const checkComponent = (
      param: EsTreeNode | undefined,
      body: EsTreeNode | undefined,
      componentName: string,
      reportNode: EsTreeNode,
    ): void => {
      if (!param) return;
      if (isNodeOfType(param, "ObjectPattern")) {
        reportIfMany(collectRenderPropsFromObjectPattern(param), componentName, reportNode);
        return;
      }
      if (isNodeOfType(param, "Identifier")) {
        reportIfMany([...collectRenderPropsFromBody(body, param.name)], componentName, reportNode);
      }
    };

    return {
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (!isComponentDeclaration(node) || !node.id) return;
        checkComponent(node.params?.[0], node.body, node.id.name, node.id);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isComponentAssignment(node)) return;
        if (!isNodeOfType(node.id, "Identifier")) return;
        if (!isInlineFunctionExpression(node.init)) return;
        checkComponent(node.init.params?.[0], node.init.body, node.id.name, node.id);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const renderPropAttributes: Array<{ name: string; node: EsTreeNode }> = [];
        for (const attr of node.attributes ?? []) {
          if (!isNodeOfType(attr, "JSXAttribute")) continue;
          if (!isNodeOfType(attr.name, "JSXIdentifier")) continue;
          if (!RENDER_PROP_PATTERN.test(attr.name.name)) continue;
          renderPropAttributes.push({ name: attr.name.name, node: attr });
        }
        if (renderPropAttributes.length < RENDER_PROP_PROLIFERATION_THRESHOLD) return;
        context.report({
          node: renderPropAttributes[0].node,
          message: `Element receives ${renderPropAttributes.length} render-prop slots (${renderPropAttributes
            .slice(0, 3)
            .map((attr) => attr.name)
            .join(", ")}...) - prefer compound subcomponents or children for flexible composition`,
        });
      },
    };
  },
});
```

---

<sub>
Generated by `rde discover ingest-knowledge` + `rde discover draft` (v3 knowledge-aware prompt: AST-detectability check + WHY-reasoning + generality check + explicit abstain). See [millionco/react-doctor-evals#11](https://github.com/millionco/react-doctor-evals/pull/11) for the pipeline.
</sub>
