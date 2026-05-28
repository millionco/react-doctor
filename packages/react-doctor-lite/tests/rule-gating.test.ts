import { describe, expect, it } from "vite-plus/test";
import { buildCapabilities } from "../src/capabilities/build-capabilities.js";
import { buildDependencyGraphFromManifest } from "../src/dependency-graph/build-dependency-graph.js";
import { loadRules } from "../src/rules/load-rules.js";

const rulesFor = (dependencies: Record<string, string>) =>
  loadRules({
    capabilities: buildCapabilities(buildDependencyGraphFromManifest({ dependencies })),
  });

describe("framework / capability gating", () => {
  it("loads framework-specific rules only when the framework is present", () => {
    const webRules = rulesFor({ react: "19.0.0", vite: "6.0.0" });
    const nextRules = rulesFor({ react: "19.0.0", next: "15.0.0" });

    const webIds = new Set(webRules.map((rule) => rule.id));
    const nextOnlyIds = nextRules.filter((rule) => !webIds.has(rule.id));

    expect(nextOnlyIds.length).toBeGreaterThan(0);
  });

  it("honors severity overrides and disables", () => {
    const capabilities = buildCapabilities(
      buildDependencyGraphFromManifest({ dependencies: { react: "19.0.0" } }),
    );

    const overridden = loadRules({
      capabilities,
      selection: {
        only: ["no-array-index-as-key"],
        severity: { "no-array-index-as-key": "error" },
      },
    });
    expect(overridden[0].severity).toBe("error");

    const disabled = loadRules({
      capabilities,
      selection: { only: ["no-array-index-as-key"], disable: ["no-array-index-as-key"] },
    });
    expect(disabled).toHaveLength(0);
  });

  it("respects ignored tags", () => {
    const capabilities = buildCapabilities(
      buildDependencyGraphFromManifest({ dependencies: { react: "19.0.0" } }),
    );
    const all = loadRules({ capabilities });
    const withoutTestNoise = loadRules({ capabilities, selection: { ignoreTags: ["test-noise"] } });

    expect(withoutTestNoise.length).toBeLessThan(all.length);
  });
});
