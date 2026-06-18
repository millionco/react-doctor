import { describe, expect, it } from "vite-plus/test";
import type { ReactDoctorConfig } from "@react-doctor/core";
import {
  buildRuleCatalog,
  findRuleInCatalog,
  listRuleCategories,
  listRuleTags,
} from "../src/cli/utils/rule-catalog.js";
import { resolveEffectiveRuleSeverity } from "../src/cli/utils/resolve-effective-rule-severity.js";
import {
  addIgnoredTag,
  removeIgnoredTag,
  setCategorySeverity,
  setRuleSeverity,
} from "../src/cli/utils/update-rule-config.js";

const catalog = buildRuleCatalog();

const findRequiredRule = (ruleQuery: string) => {
  const entry = findRuleInCatalog(catalog, ruleQuery);
  if (!entry) throw new Error(`Expected catalog to contain ${ruleQuery}`);
  return entry;
};

describe("buildRuleCatalog", () => {
  it("exposes fully-qualified keys, ids, categories, and default severity", () => {
    const entry = findRequiredRule("react-doctor/no-danger");
    expect(entry.id).toBe("no-danger");
    expect(entry.key).toBe("react-doctor/no-danger");
    expect(entry.category.length).toBeGreaterThan(0);
    expect(["error", "warn"]).toContain(entry.defaultSeverity);
  });

  it("lists known categories and tags", () => {
    expect(listRuleCategories(catalog)).toContain("Accessibility");
    expect(listRuleTags(catalog)).toContain("design");
  });
});

describe("findRuleInCatalog", () => {
  it("matches the bare rule id", () => {
    expect(findRuleInCatalog(catalog, "no-danger")?.key).toBe("react-doctor/no-danger");
  });

  it("matches a legacy plugin key via the alias map", () => {
    expect(findRuleInCatalog(catalog, "react/no-danger")?.key).toBe("react-doctor/no-danger");
  });

  it("returns undefined for an unknown rule", () => {
    expect(findRuleInCatalog(catalog, "react-doctor/does-not-exist")).toBeUndefined();
    expect(findRuleInCatalog(catalog, "")).toBeUndefined();
  });
});

describe("setRuleSeverity", () => {
  it("adds a rule severity, preserving unrelated fields", () => {
    const next = setRuleSeverity({ lint: true }, "react-doctor/no-danger", "off");
    expect(next.lint).toBe(true);
    expect(next.rules).toEqual({ "react-doctor/no-danger": "off" });
  });

  it("replaces a legacy-aliased key with the canonical key", () => {
    const config: ReactDoctorConfig = { rules: { "react/no-danger": "warn" } };
    const next = setRuleSeverity(config, "react-doctor/no-danger", "error");
    expect(next.rules).toEqual({ "react-doctor/no-danger": "error" });
  });
});

describe("setCategorySeverity", () => {
  it("sets a category severity without clobbering others", () => {
    const next = setCategorySeverity(
      { categories: { Performance: "warn" } },
      "React Native",
      "off",
    );
    expect(next.categories).toEqual({ Performance: "warn", "React Native": "off" });
  });
});

describe("addIgnoredTag / removeIgnoredTag", () => {
  it("adds a tag, deduped and sorted", () => {
    const next = addIgnoredTag({ ignore: { tags: ["test-noise"] } }, "design");
    expect(next.ignore?.tags).toEqual(["design", "test-noise"]);
  });

  it("is a no-op when the tag is already ignored", () => {
    const config: ReactDoctorConfig = { ignore: { tags: ["design"] } };
    expect(addIgnoredTag(config, "design")).toBe(config);
  });

  it("removes a tag and drops the empty ignore block", () => {
    const next = removeIgnoredTag({ ignore: { tags: ["design"] } }, "design");
    expect(next.ignore).toBeUndefined();
  });

  it("keeps other ignore fields when removing the last tag", () => {
    const next = removeIgnoredTag({ ignore: { tags: ["design"], files: ["dist/**"] } }, "design");
    expect(next.ignore).toEqual({ files: ["dist/**"] });
  });
});

describe("resolveEffectiveRuleSeverity", () => {
  const entry = findRequiredRule("react-doctor/no-danger");

  it("falls back to the registry default when nothing overrides it", () => {
    const defaultOnEntry = catalog.find((candidate) => candidate.defaultEnabled);
    if (!defaultOnEntry) throw new Error("Expected at least one default-enabled rule");
    const result = resolveEffectiveRuleSeverity(null, defaultOnEntry);
    expect(result.source).toBe("default");
    expect(result.value).toBe(defaultOnEntry.defaultSeverity);
  });

  it("prefers a rule-level override (including legacy keys)", () => {
    const result = resolveEffectiveRuleSeverity({ rules: { "react/no-danger": "off" } }, entry);
    expect(result).toEqual({ value: "off", source: "rule" });
  });

  it("uses a category override when no rule override exists", () => {
    const result = resolveEffectiveRuleSeverity({ categories: { [entry.category]: "off" } }, entry);
    expect(result).toEqual({ value: "off", source: "category" });
  });

  it("reports off via an ignored tag", () => {
    const taggedEntry = catalog.find((candidate) => candidate.tags.includes("design"));
    if (!taggedEntry) throw new Error("Expected at least one design-tagged rule");
    const result = resolveEffectiveRuleSeverity({ ignore: { tags: ["design"] } }, taggedEntry);
    expect(result).toEqual({ value: "off", source: "tag" });
  });

  it("treats an ignored tag as decisive over a rule-level override (pre-lint gate)", () => {
    const taggedEntry = catalog.find((candidate) => candidate.tags.includes("design"));
    if (!taggedEntry) throw new Error("Expected at least one design-tagged rule");
    const result = resolveEffectiveRuleSeverity(
      { ignore: { tags: ["design"] }, rules: { [taggedEntry.key]: "error" } },
      taggedEntry,
    );
    expect(result).toEqual({ value: "off", source: "tag" });
  });

  it("reports off for an opt-in rule that is disabled by default", () => {
    const optInEntry = catalog.find((candidate) => !candidate.defaultEnabled);
    if (!optInEntry) throw new Error("Expected at least one default-disabled rule");
    const result = resolveEffectiveRuleSeverity(null, optInEntry);
    expect(result).toEqual({ value: "off", source: "default" });
  });

  it("applies a compiler-cleanup bucket override below rules and categories", () => {
    const bucketEntry = findRuleInCatalog(
      catalog,
      "react-doctor/react-compiler-no-manual-memoization",
    );
    if (!bucketEntry) throw new Error("Expected the compiler-cleanup rule in the catalog");
    expect(
      resolveEffectiveRuleSeverity({ buckets: { "compiler-cleanup": "off" } }, bucketEntry),
    ).toEqual({ value: "off", source: "bucket" });
    // A per-rule override still wins over the bucket.
    expect(
      resolveEffectiveRuleSeverity(
        { buckets: { "compiler-cleanup": "off" }, rules: { [bucketEntry.key]: "error" } },
        bucketEntry,
      ),
    ).toEqual({ value: "error", source: "rule" });
  });
});
