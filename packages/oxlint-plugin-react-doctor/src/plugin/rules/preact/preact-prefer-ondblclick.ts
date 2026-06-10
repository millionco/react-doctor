import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE =
  "Your users get no response from `onDoubleClick` in Preact core, where it never fires, so use `onDblClick` instead, which matches the DOM event name.";

// Preact registers DOM events under their browser-spec names. `dblclick` is
// the DOM event name; React aliases it to `onDoubleClick` via its synthetic
// event system. Pure-Preact code that copies a React-style `onDoubleClick`
// handler silently never fires — the listener is attached to a non-existent
// `doubleclick` event. The Preact "Differences to React" doc lists this as a
// Main difference.
//
// Restricted to lowercase host JSX elements: a `<MyButton onDoubleClick>`
// is just a custom prop on a user component, where the lib name doesn't
// determine event semantics.
//
// Gated on `pure-preact` (Preact in deps AND no `react` package). When
// `react` IS installed alongside Preact the project is almost always
// running through `preact/compat`, which mirrors React's event names —
// flagging it there would be a false positive. Pairs with the existing
// `preact-prefer-oninput` rule (same naming convention, same intent for
// the `onChange` → `onInput` divergence).
export const preactPreferOndblclick = defineRule<Rule>({
  id: "preact-prefer-ondblclick",
  title: "onDoubleClick instead of onDblClick",
  requires: ["pure-preact"],
  severity: "warn",
  recommendation:
    "Rename `onDoubleClick` to `onDblClick` because Preact core listens for the DOM `dblclick` event name and `onDoubleClick` never fires.",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier")) return;
      const tagName = node.name.name;
      if (tagName.length === 0 || tagName[0] !== tagName[0].toLowerCase()) return;
      const onDoubleClickAttribute = findJsxAttribute(node.attributes, "onDoubleClick");
      if (!onDoubleClickAttribute) return;
      context.report({ node: onDoubleClickAttribute, message: MESSAGE });
    },
  }),
});
