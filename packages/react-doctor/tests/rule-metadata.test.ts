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
