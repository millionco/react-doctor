---
"oxlint-plugin-react-doctor": patch
---

Ship `no-danger` default-off so it no longer blanket-flags safe `dangerouslySetInnerHTML`.

`no-danger` is the absolutist oxc port — it flags **every** `dangerouslySetInnerHTML` with zero content awareness, so it fired Security warnings on the canonical-safe idioms that React Doctor's own content-aware detectors deliberately exempt: escaped JSON-LD, theme-init `<script>` templates, CSS-variable `<style>` injection, and sanitized / `safe`-named values. Two default-on Security rules judged the same prop and disagreed.

The content-aware rules are now the canonical default-on detectors for `dangerouslySetInnerHTML`: `dangerous-html-sink` (dynamic/tainted markup, with the style-tag / static-template / sanitizer exemptions) and `unsafe-json-in-html` (the unescaped-`JSON.stringify` breakout case). `no-danger` remains available opt-in (`"react-doctor/no-danger": "warn"`) for teams that want the stricter "never use `dangerouslySetInnerHTML` at all" policy (oxc / `eslint-plugin-react` parity).

Score impact: repos using these safe idioms will see fewer Security findings and a correspondingly **higher** score. A CI gate pinned to a fixed threshold may pass where it previously failed. Re-enable `no-danger` in config to restore the old behavior.
