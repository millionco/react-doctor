---
"oxlint-plugin-react-doctor": patch
---

fix: eliminate false positives across ~30 rules from a deep adversarial review

A wide adversarial sweep over every rule surfaced and fixed false positives that
flagged correct, idiomatic code. Highlights:

- **state-and-effects**: `rerender-state-only-in-handlers` no longer flags state
  read by an effect through a one-hop derived local (`const offset = page * 10;
useEffect(…, [offset])`); `redux-useselector-inline-derivation` stops treating
  `String.prototype.slice`/`concat` as a fresh array allocation;
  `no-mirror-prop-effect` and `no-derived-state-effect` now honor the
  `initialCount` reset and controlled-input mirror idioms their sibling rules
  already allowed; `no-direct-state-mutation` no longer flags mutating-method
  calls on opaque (non-literal) instance state.
- **performance / js-performance**: `no-usememo-simple-expression` inspects
  template-literal interpolations before calling a memo "trivially cheap";
  `rerender-derived-state-from-hook` only fires when the continuous value isn't
  itself rendered; `js-cache-property-access` ignores property chains mutated in
  the loop; `js-hoist-intl` allows per-locale memoizing factories;
  `rerender-memo-before-early-return` skips when the early return uses the memo;
  `no-inline-prop-on-memo-component` respects a custom `memo` comparator;
  `async-await-in-loop` detects loop-carried dependencies flowing through
  `push`; `rendering-usetransition-loading` recognizes `.then` loading flags.
- **nextjs / correctness**: `nextjs-no-a-element` treats protocol-relative
  (`//host`) URLs as external; `no-prevent-default` allows progressively-enhanced
  `<form action>`; `nextjs-no-font-link` skips `rel="preconnect"`/`dns-prefetch`;
  `nextjs-image-missing-sizes` ignores `fill={false}`; `nextjs-no-script-in-head`
  and `nextjs-no-redirect-in-try-catch` respect prop-vs-child and function
  boundaries.
- **a11y**: `lang` accepts 3-letter ISO-639-2/3 codes (`fil`, `haw`, `yue`…);
  `media-has-caption` unwraps `kind={"captions"}`; `no-redundant-roles` is
  href-aware for `<a>`; `role-has-required-aria-props` allows native
  `<input type="range">` to supply `aria-valuenow`.
- **react-native / client**: the type-only-import family
  (`rn-prefer-pressable`, `rn-no-deprecated-modules`, `rn-prefer-reanimated`,
  `rn-no-non-native-navigator`, …) ignores build-erased `import type`;
  `client-passive-event-listeners` resolves member/method handlers that call
  `preventDefault`; `rn-no-falsy-and-render` exempts provably non-zero constants.
- **architecture / design**: `prefer-module-scope-static-value` no longer hoists
  impure initializers (`Date.now()`, `Math.random()`); `no-gray-on-colored-background`
  only flags low-contrast gray text shades; `react-compiler-destructure-method`
  drops the unsafe `useSearchParams().get` recommendation; `no-side-tab-border`
  recognizes achromatic arbitrary hex borders; `no-layout-transition-inline`
  stops matching `scroll-margin`/`scroll-padding`.
- **libs**: `tanstack-start-redirect-in-try-catch` honors the re-throw-in-catch
  idiom; `query-no-query-in-effect` and `tanstack-start-no-use-effect-fetch`
  ignore calls inside effect-registered event handlers;
  `tanstack-start-no-navigate-in-render` and `jotai-select-atom-in-render-body`
  treat any `use*`-hook callback and usage-wired handlers as deferred;
  `preact-no-children-length` requires component evidence for `props.children`
  member access; `jotai-derived-atom-returns-fresh-object` no longer flags
  `Object.assign(target, …)`.
- **security**: `raw-sql-injection-risk` exempts the mysqljs/sqlstring
  `connection.escape()` / `.escapeId()` sanitizers in its string-concat arm while
  still flagging raw request taint and `escapeHtml`.

Each fix preserves the rule's true positives and ships with a regression test.
