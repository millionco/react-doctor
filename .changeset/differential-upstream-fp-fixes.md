---
"oxlint-plugin-react-doctor": patch
---

fix: six false-positive classes found by differential testing against the
upstream ESLint plugins over an OSS corpus:

- `exhaustive-deps`: cleanup `ref.current` reads no longer warn when the ref
  is assigned via a callback anywhere in the component, and an explicit
  `undefined` deps argument is treated like an omitted one for effect hooks
  (upstream parity; `null` still reports as a non-array deps list).
- `no-static-element-interactions`: a string-literal role wrapped in a JSX
  expression container (`role={'link'}`) now counts as a role, and `<svg>`
  is skipped — it has the implicit `graphics-document` role, so it isn't
  static (upstream parity).
- `no-aria-hidden-on-focusable`: dynamic `aria-hidden` expressions
  (`aria-hidden={!interactive || undefined}`) are no longer treated as
  literal `true`.
- `img-redundant-alt`: hyphens and underscores are word-continuation
  characters, so `alt="image-left-top"` and `alt="my_image_1"` no longer
  match the redundant word "image".
- `no-noninteractive-tabindex`: the roving-tabindex pattern
  (`tabIndex={active ? 0 : -1}`) is no longer flagged.
- `rules-of-hooks`: hooks in anonymous callbacks with no resolved name are
  skipped (upstream's conservative approach), and a hook call in a ternary
  test position is no longer treated as conditional.
