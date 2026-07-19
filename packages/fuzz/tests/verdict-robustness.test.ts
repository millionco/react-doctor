import { describe, expect, it } from "vite-plus/test";
import { livenessFixtures } from "../../oxlint-plugin-react-doctor/src/plugin/liveness/liveness-fixtures.js";
import { ruleRegistry } from "../../oxlint-plugin-react-doctor/src/plugin/rule-registry.js";
import { runRule } from "../../oxlint-plugin-react-doctor/src/test-utils/run-rule.js";
import { buildVerdictPreservingVariants } from "../src/verdict-preserving-variants.js";

// Mutation-robustness gate for the rules hardened in the precision/coverage
// audit: the rule must keep firing on its canonical bad example after every
// verdict-preserving rewrite ("x + 1 = 2" must still be caught as
// "x + 1 + 1 - 1 = 2"). A drop means detection keys on incidental source
// shape — the evasion class the audit repeatedly surfaced (paren-shape,
// wrapper-transparency, concise-vs-block bodies).
//
// Scoped to the audited rules (not the whole registry) so the gate lands
// green and stays enforceable; broaden coverage with
// `bun scripts/measure-verdict-robustness.ts`, which reports drops across
// every liveness fixture without failing the build.
const AUDITED_RULE_IDS = [
  "anchor-is-valid",
  "aria-role",
  "class-component-missing-component-will-unmount-teardown",
  "debounce-no-cleanup",
  "effect-listener-cleanup-reference-mismatch",
  "effect-listener-cleanup-mismatch",
  "effect-needs-cleanup",
  "effect-observer-needs-disconnect",
  "effect-raf-loop-needs-cancel",
  "effect-remove-listener-inline-handler",
  "forward-ref-uses-ref",
  "hook-import-rename-loses-use-prefix",
  "interactive-supports-focus",
  "js-min-max-loop",
  "js-hoist-regexp",
  "jsx-no-new-object-as-prop",
  "jsx-numeric-and-leaked-render",
  "mobx-reaction-disposer-discarded",
  "nextjs-async-dynamic-api-not-awaited",
  "nextjs-no-polyfill-script",
  "no-adjust-state-on-prop-change",
  "no-aria-hidden-on-focusable",
  "no-async-event-handler-without-reentry-guard",
  "no-boolean-toggle-without-functional-update",
  "no-collapsed-literal-or-chain-as-value",
  "no-controlled-input-value-without-state-update",
  "no-create-object-url-without-revoke",
  "no-deprecated-keyboard-event-keycode-which",
  "no-derived-state-effect",
  "no-eager-new-in-use-state-initializer",
  "no-effect-chain",
  "no-effect-wrapper-discards-callback-cleanup-return",
  "no-enter-submit-without-ime-composition-guard",
  "no-fetch-response-used-without-status-check",
  "no-fill-map-element-as-key",
  "no-floating-then-in-jsx-handler",
  "no-impure-call-at-module-scope",
  "no-impure-state-updater",
  "no-inline-hoc-on-component",
  "no-inline-prop-on-memo-component",
  "no-jsx-element-type",
  "no-locale-format-in-render",
  "no-loading-flag-reset-outside-finally",
  "no-mutate-queried-dom-node-in-component",
  "no-mutate-then-set-or-return-same-reference",
  "no-mutating-array-method-on-prop-or-hook-result",
  "no-mutating-reducer-state",
  "no-non-literal-selector-query-without-try-catch",
  "no-nested-component-definition",
  "no-nondeterministic-id-value-in-render-body",
  "no-object-keys-values-entries-on-maybe-undefined",
  "no-object-or-array-coerced-to-string-in-template-literal",
  "no-pass-data-to-parent",
  "no-prop-callback-in-render",
  "no-prop-types",
  "no-promise-then-side-effect-in-effect-without-catch",
  "no-react19-deprecated-apis",
  "no-ref-current-in-render",
  "no-render-in-render",
  "no-set-state-after-await-in-effect",
  "no-side-effect-in-state-updater-function",
  "no-spread-props-over-defaults-clobbers-with-undefined",
  "no-stale-timer-ref",
  "no-unguarded-browser-global-at-module-scope",
  "no-unstable-nested-components",
  "no-unescaped-dynamic-string-in-regexp",
  "no-unguarded-numeric-input-parse",
  "no-unguarded-throwing-parse-call",
  "no-unsafe-json-parse",
  "no-usememo-simple-expression",
  "no-whole-object-dep-with-member-reads",
  "no-whole-object-default-losing-per-key-defaults",
  "only-export-components",
  "prefer-use-sync-external-store",
  "radio-input-missing-name",
  "rendering-hydration-mismatch-time",
  "rendering-hydration-no-flicker",
  "rerender-lazy-ref-init",
  "rerender-lazy-state-init",
  "role-has-required-aria-props",
  "role-supports-aria-props",
  "rn-detox-missing-await",
  "rules-of-hooks",
  "styled-components-non-transient-custom-prop-on-intrinsic-element",
  "window-open-without-noopener",
] as const;

// Rule × variant pairs where losing the diagnostic is the rule's DOCUMENTED
// semantics, not brittleness. Every entry needs a reason; keep it short.
const ALLOWED_DROPS: ReadonlyArray<{ ruleId: string; variantLabel: string; reason: string }> = [];

const isAllowedDrop = (ruleId: string, variantLabel: string): boolean =>
  ALLOWED_DROPS.some((entry) => entry.ruleId === ruleId && entry.variantLabel === variantLabel);

describe("verdict-preserving mutation robustness (audited rules)", () => {
  for (const ruleId of AUDITED_RULE_IDS) {
    const rule = ruleRegistry[ruleId];
    const fixture = livenessFixtures[ruleId];

    it(`${ruleId} keeps firing under every verdict-preserving rewrite`, () => {
      expect(rule, `rule "${ruleId}" is not registered`).toBeDefined();
      expect(fixture, `rule "${ruleId}" has no liveness fixture`).toBeDefined();
      if (!rule || !fixture) return;

      const filename = fixture.filePath ?? "fixture.tsx";
      const runOptions = {
        filename,
        settings: fixture.settings,
        forceJsx: true,
      };
      const base = runRule(rule, fixture.code, runOptions);
      expect(
        base.diagnostics.length,
        `liveness fixture no longer fires for "${ruleId}"`,
      ).toBeGreaterThanOrEqual(1);

      const failures: string[] = [];
      for (const variant of buildVerdictPreservingVariants(fixture.code, filename)) {
        if (!variant.mustPreserveVerdict) continue;
        if (isAllowedDrop(ruleId, variant.label)) continue;
        const mutated = runRule(rule, variant.code, runOptions);
        if (mutated.parseErrors.length > 0) continue;
        if (mutated.diagnostics.length === 0) {
          failures.push(`"${variant.label}" silenced the rule:\n${variant.code}`);
        }
      }
      expect(
        failures,
        `verdict-preserving rewrites silenced "${ruleId}" — detection keys on incidental source shape`,
      ).toEqual([]);
    });
  }
});
