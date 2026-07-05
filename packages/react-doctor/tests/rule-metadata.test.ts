import { describe, expect, it } from "vite-plus/test";
import { DIAGNOSTIC_CATEGORY_BUCKETS } from "@react-doctor/core";
import reactDoctorPlugin from "oxlint-plugin-react-doctor";

// Executable spec for the rule-copy conventions introduced when every
// rule gained a human `title` and its messages were rewritten to plain,
// dash-free prose. `title` is intentionally optional on the `Rule` type
// so adopted third-party rules can fall back to their `plugin/rule` id,
// but every FIRST-PARTY react-doctor rule must carry one — otherwise it
// silently renders its kebab-case id in the CLI "errors you should fix"
// block with no other signal. This test is the guard.

const TITLE_MAX_LENGTH_CHARS = 60;
const DASH_PATTERN = /[—–]/; // em dash / en dash used as separators

const IMPACTS = new Set(["behavior", "style", "perf", "a11y", "security"]);
const CONFIDENCES = new Set(["high", "heuristic"]);
const FIXES = new Set(["mechanical", "local", "structural"]);
const BARE_TAGS = new Set([
  "design",
  "migration-hint",
  "react-jsx-only",
  "react-native",
  "security-scan",
  "server-action",
  "test-noise",
]);

// A handful of high-signal behavior-correctness rules as tripwires — if
// any silently drops out of `impact:behavior`, a downstream reward gate
// shifts. Deliberately a small subset, not an exhaustive whitelist (which
// would re-create the brittle external rule-name list this feature replaces).
const BEHAVIOR_SENTINELS = [
  "no-derived-state",
  "no-chain-state-updates",
  "no-array-index-as-key",
  "no-adjust-state-on-prop-change",
  "exhaustive-deps",
  "rules-of-hooks",
];

const ruleEntries = Object.entries(reactDoctorPlugin.rules);

describe("rule metadata conventions", () => {
  it("registers a non-trivial number of rules (sanity)", () => {
    expect(ruleEntries.length).toBeGreaterThan(100);
  });

  it("gives every rule a non-empty title", () => {
    const missing = ruleEntries
      .filter(([, rule]) => !rule.title || rule.title.trim().length === 0)
      .map(([id]) => id);
    expect(missing, `rules missing a title: ${missing.join(", ")}`).toEqual([]);
  });

  it("keeps titles short, headline-style (no trailing period, under the cap)", () => {
    for (const [id, rule] of ruleEntries) {
      const title = rule.title ?? "";
      expect(title.endsWith("."), `title for "${id}" should not end with a period`).toBe(false);
      expect(
        title.length,
        `title for "${id}" exceeds ${TITLE_MAX_LENGTH_CHARS} chars: "${title}"`,
      ).toBeLessThanOrEqual(TITLE_MAX_LENGTH_CHARS);
    }
  });

  it("buckets every rule into one of the five user-facing categories", () => {
    const allowed = new Set<string>(DIAGNOSTIC_CATEGORY_BUCKETS);
    const offenders = ruleEntries
      .filter(([, rule]) => !rule.category || !allowed.has(rule.category))
      .map(([id, rule]) => `${id} → ${rule.category ?? "(none)"}`);
    expect(
      offenders,
      `rules outside ${DIAGNOSTIC_CATEGORY_BUCKETS.join(" / ")}: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("classifies every rule with exactly one impact/confidence/fix, all from the closed vocabulary", () => {
    for (const [id, rule] of ruleEntries) {
      expect(IMPACTS.has(rule.impact ?? ""), `${id} impact: ${rule.impact}`).toBe(true);
      expect(CONFIDENCES.has(rule.confidence ?? ""), `${id} confidence: ${rule.confidence}`).toBe(
        true,
      );
      expect(FIXES.has(rule.fix ?? ""), `${id} fix: ${rule.fix}`).toBe(true);
    }
  });

  it("keeps every rule tag inside the closed vocabulary and projects each axis exactly once", () => {
    for (const [id, rule] of ruleEntries) {
      const tags = rule.tags ?? [];
      for (const tag of tags) {
        const isKnown =
          BARE_TAGS.has(tag) ||
          tag.startsWith("impact:") ||
          tag.startsWith("confidence:") ||
          tag.startsWith("fix:");
        expect(isKnown, `${id} carries unknown tag "${tag}"`).toBe(true);
      }
      const perAxis = (prefix: string) => tags.filter((tag) => tag.startsWith(prefix));
      expect(perAxis("impact:"), `${id} impact tags`).toEqual([`impact:${rule.impact}`]);
      expect(perAxis("confidence:"), `${id} confidence tags`).toEqual([
        `confidence:${rule.confidence}`,
      ]);
      expect(perAxis("fix:"), `${id} fix tags`).toEqual([`fix:${rule.fix}`]);
    }
  });

  it("keeps every design-tagged rule classified as impact:style", () => {
    for (const [id, rule] of ruleEntries) {
      if ((rule.tags ?? []).includes("design")) {
        expect(rule.impact, `${id} is design-tagged so must be impact:style`).toBe("style");
      }
    }
  });

  it("keeps the behavior-footgun sentinels classified as impact:behavior", () => {
    for (const sentinel of BEHAVIOR_SENTINELS) {
      const rule = reactDoctorPlugin.rules[sentinel];
      expect(rule, `sentinel rule "${sentinel}" is missing from the registry`).toBeDefined();
      expect(rule?.impact, `sentinel "${sentinel}" must stay impact:behavior`).toBe("behavior");
    }
  });

  it("uses no em/en dashes in titles or recommendations", () => {
    for (const [id, rule] of ruleEntries) {
      expect(DASH_PATTERN.test(rule.title ?? ""), `title for "${id}" contains an em/en dash`).toBe(
        false,
      );
      // `no-em-dash-in-jsx-text` is the one rule that legitimately names
      // the character it bans; its recommendation may reference it.
      if (id === "design-no-em-dash-in-jsx-text") continue;
      expect(
        DASH_PATTERN.test(rule.recommendation ?? ""),
        `recommendation for "${id}" contains an em/en dash`,
      ).toBe(false);
    }
  });
});
