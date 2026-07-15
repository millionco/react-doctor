---
"oxlint-plugin-react-doctor": patch
---

fix(control-has-associated-label): recognize component-wrapped labels with htmlFor

Fixes #1314. The rule now recognizes form controls associated through
component-wrapped labels like shadcn/ui's `<Label htmlFor>` (Radix
LabelPrimitive.Root), not just native `<label>` elements.

Previously, the rule only collected `htmlFor` associations from native `<label>`
elements. Now it collects them from ANY element (native or component) that has
both an `htmlFor` attribute and accessible text content. This handles:

- `<Label htmlFor="id">Text</Label>` (shadcn/Radix pattern)
- `<FormLabel htmlFor="id">Text</FormLabel>`
- `<InputLabel htmlFor="id">Text</InputLabel>`
- Any other capitalized component carrying `htmlFor`

The fix is intentionally broad: a component with `htmlFor` + text is a strong
association signal even when the rendered tag can't be resolved statically.
