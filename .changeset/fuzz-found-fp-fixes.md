---
"oxlint-plugin-react-doctor": patch
---

fix(rules): three false-positive fixes found by the fuzz FP oracle

- `role-supports-aria-props`: the ported role→props table was missing
  spec-supported properties (aria-query parity) — `aria-multiselectable`
  on listbox/grid/tablist/tree/treegrid, `aria-readonly` on 15 widget
  roles, `aria-errormessage` on treegrid — so valid ARIA markup was
  flagged (upstream report: oxc-project/oxc#20855).
- `rendering-hydration-no-flicker`: no longer flags `useLayoutEffect` —
  it runs synchronously before paint, so the canonical DOM-measurement
  pattern (`useLayoutEffect(() => setHeight(ref.current...), [])`) never
  flashes (upstream report: facebook/react#34858).
- `no-derived-state`: the async-intermediate suppression now sees through
  `const f = useCallback(async () => ...)` — a setter reached after an
  await is async sequencing state, not a render-derivable value
  (upstream report: facebook/react#34905).
