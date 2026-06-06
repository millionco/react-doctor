---
"oxlint-plugin-react-doctor": minor
---

feat: add `prefer-explicit-variants` rule. Flags a component that picks which component to render from 2+ boolean props (each used as the test of a two-sided JSX ternary), nudging toward explicit variant components instead of variants jammed into one component. App-only, `warn` severity; cross-cutting state/responsive/auth booleans (`isLoading`, `isMobile`, …) and single switches are intentionally ignored.
