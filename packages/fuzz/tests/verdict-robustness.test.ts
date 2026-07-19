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
  "effect-listener-cleanup-mismatch",
  "effect-needs-cleanup",
  "forward-ref-uses-ref",
  "interactive-supports-focus",
  "js-min-max-loop",
  "js-hoist-regexp",
  "jsx-no-new-object-as-prop",
  "nextjs-no-polyfill-script",
  "no-adjust-state-on-prop-change",
  "no-aria-hidden-on-focusable",
  "no-derived-state-effect",
  "no-effect-chain",
  "no-impure-state-updater",
  "no-inline-prop-on-memo-component",
  "no-jsx-element-type",
  "no-locale-format-in-render",
  "no-mutating-reducer-state",
  "no-nested-component-definition",
  "no-pass-data-to-parent",
  "no-prop-callback-in-render",
  "no-prop-types",
  "no-react19-deprecated-apis",
  "no-ref-current-in-render",
  "no-render-in-render",
  "no-stale-timer-ref",
  "no-unstable-nested-components",
  "no-usememo-simple-expression",
  "only-export-components",
  "prefer-use-sync-external-store",
  "rendering-hydration-mismatch-time",
  "rendering-hydration-no-flicker",
  "rerender-lazy-ref-init",
  "rerender-lazy-state-init",
  "role-has-required-aria-props",
  "role-supports-aria-props",
  "rules-of-hooks",
  "valtio-no-proxy-read-in-render",
  "valtio-no-snapshot-in-callback",
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
