---
name: preact-signals-no-build
description: Use when Preact or @preact/signals is used directly in the browser with import maps, CDNs, HTM, esm.sh, unpkg, no bundler, or symptoms that signals update internally but components do not rerender.
---

# Preact Signals No-Build

## Core Approach

No-build signals setups must load one Preact singleton. If HTM, Preact, hooks, and signals each resolve their own copy of Preact, signals and hooks can update internally while components never rerender.

## Working Import Map Pattern

Use `htm/preact`, not `htm/preact/standalone`, when signals are involved:

```html
<script type="importmap">
{
  "imports": {
    "preact": "https://esm.sh/preact@10.23.1",
    "preact/hooks": "https://esm.sh/preact@10.23.1/hooks?external=preact",
    "htm/preact": "https://esm.sh/htm@3.1.1/preact?external=preact",
    "@preact/signals": "https://esm.sh/@preact/signals@2.0.4?external=preact"
  }
}
</script>
<script type="module">
  import { html } from "htm/preact";
  import { render } from "preact";
  import { signal } from "@preact/signals";

  const page = signal("home");

  function App() {
    return html`
      <button onClick=${() => (page.value = "tasks")}>Tasks</button>
      <div>Current page: ${page.value}</div>
    `;
  }

  render(html`<${App} />`, document.getElementById("app"));
</script>
```

## Diagnosis Checklist

- Replace `htm/preact/standalone` with `htm/preact`.
- Import `render` from `preact`, not from the standalone HTM bundle.
- Pin compatible versions rather than relying on moving CDN defaults.
- Add `?external=preact` to CDN URLs that might otherwise bundle Preact.
- Ensure `preact`, `preact/hooks`, and `@preact/signals` resolve to the same Preact version.
- Check the browser network panel for duplicate Preact module URLs.

## Common Failure Modes

| Symptom | Likely Cause | Fix |
| --- | --- | --- |
| `effect()` logs updates but UI is stale | Duplicate Preact copy | Use import map singleton |
| Basic REPL or CDN example fails | Version drift | Pin versions |
| Hooks behave oddly | `standalone` bundled Preact | Use `htm/preact` |
| Works after adding a version to imports | CDN resolved mismatched packages | Pin all Preact-related packages |

## What Not To Do

- Do not combine `htm/preact/standalone` with `@preact/signals`.
- Do not import Preact from one CDN URL and signals from another URL that bundles its own Preact.
- Do not assume unpkg, esm.sh, and local package-manager output are byte-identical if a runtime or cache is transforming modules.

## References

- Preact no-build guide: https://preactjs.com/guide/v10/no-build-workflows
- Preact llms documentation: https://preactjs.com/llms.txt
