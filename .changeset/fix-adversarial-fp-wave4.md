---
"oxlint-plugin-react-doctor": patch
---

fix: eliminate more false positives from a wider/deeper adversarial review (wave 4)

A second, wider adversarial pass over every rule (with `rule-validate`) surfaced
and fixed additional false positives, each paired with a regression test that
asserts the FP is gone and a true positive still fires:

- **react-builtins**: `jsx-no-script-url` anchors the `javascript:` obfuscation
  regex to the protocol position (an `https://…/wiki/JavaScript:…` URL no longer
  fires); `void-dom-elements-no-children` and `no-danger-with-children` ignore
  comment / formatting-newline / nullish children via a shared
  `is-meaningful-jsx-child` helper (OXC bare-space parity preserved);
  `no-string-false-on-boolean-attribute` skips hyphenated custom elements;
  `button-has-type` recognizes a renamed destructured `type` prop forward;
  `no-unknown-property` allows `transform-origin` on every transformable SVG
  element.
- **security**: `clickjacking-redirect-risk` scopes `role=` to a query position
  (ARIA `role` on an iframe no longer fires); `artifact-baas-authority-surface`
  drops the bare `role`/`roles` tokens that collided with ARIA `role`;
  `firebase-client-owned-authz-field` scopes the authz-field window to the
  write's own statement; `firebase-permissive-rules` strips comments from
  `.rules` files; `path-traversal-risk` excludes a static path segment after a
  `/` or backtick; `secret-in-fallback` exempts numeric duration fallbacks;
  `package-metadata-secret` drops the bare `service_role` keyword;
  `auth-token-in-web-storage` exempts design-token / tokenizer configs;
  `no-secrets-in-client-code` exempts public OAuth/endpoint URLs;
  `svg-filter-clickjacking-risk` requires the filter inside the iframe's own tag.
- **state / a11y / nextjs / performance / js-performance / architecture / server
  / react-native / tanstack / jotai / preact**: numerous further narrowings
  (non-deterministic mount seeds, stable-handler effect refs, function-boundary
  walks for client redirect/fetch rules, statement-scoped server-await checks,
  type-only import guards, deferred-callback detection, and more — see the PR
  description for the full per-rule inventory).

Also fixes the unit test harness (`attach-source-locations.ts`) to attach
`node.range`, so the `eslint-scope`-backed rules can be exercised under the
unit-test harness, not just integration fixtures.
