Implement the `StatusPill` component in `src/status-pill.tsx`.

## Expected behavior

`StatusPill` takes a single `status` prop — one of `"success"`, `"error"`,
`"warning"`, `"info"` — and renders a `<span>`:

- Its `className` is exactly `pill pill-<status>`, e.g.
  `<span class="pill pill-success">`.
- Its text content is the capitalized status label: `Success`, `Error`,
  `Warning`, `Info` respectively.

Example: `<StatusPill status="warning" />` renders
`<span class="pill pill-warning">Warning</span>`.

## Constraints

Keep the exported `StatusPill` component and the `StatusPillProps` / `PillStatus`
types. The component must accept the four statuses through the single `status`
prop.
