import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { analyze, defineConfig } from "../src/index.js";
import type { ScanResult, SemanticConfig } from "../src/types.js";
import { FIXTURES_DIR } from "./helpers/fixtures-dir.js";

const scanFixtureWithSemantic = async (
  fixtureName: string,
  semanticOverrides: Partial<SemanticConfig> = {},
  extraConfigOverrides: Record<string, unknown> = {},
): Promise<ScanResult> => {
  return analyze(
    defineConfig({
      rootDir: resolve(FIXTURES_DIR, fixtureName),
      semantic: { enabled: true, ...semanticOverrides },
      ...extraConfigOverrides,
    }),
  );
};

const unusedTypeNames = (result: ScanResult): string[] =>
  result.unusedTypes.map((unusedType) => unusedType.name).sort();

describe("semantic (Phase 0)", () => {
  it("populates unusedTypes as [] by default (semantic disabled)", async () => {
    const result = await analyze(defineConfig({ rootDir: resolve(FIXTURES_DIR, "simple-app") }));
    assert.deepEqual(result.unusedTypes, []);
  });

  it("does not crash when semantic.enabled is true on a project without tsconfig", async () => {
    const result = await analyze(
      defineConfig({
        rootDir: resolve(FIXTURES_DIR, "simple-app"),
        semantic: { enabled: true },
      }),
    );
    assert.ok(Array.isArray(result.unusedTypes), "unusedTypes must be an array");
    assert.equal(result.unusedTypes.length, 0, "Phase 0 returns no findings yet");
  });

  it("preserves all pre-existing ScanResult fields when semantic is enabled", async () => {
    const result = await analyze(
      defineConfig({
        rootDir: resolve(FIXTURES_DIR, "simple-app"),
        semantic: { enabled: true },
      }),
    );
    assert.ok(Array.isArray(result.unusedFiles));
    assert.ok(Array.isArray(result.unusedExports));
    assert.ok(Array.isArray(result.unusedDependencies));
    assert.ok(Array.isArray(result.circularDependencies));
    assert.equal(typeof result.totalFiles, "number");
    assert.equal(typeof result.totalExports, "number");
    assert.equal(typeof result.analysisTimeMs, "number");
  });

  it("defaults semantic.enabled to true when no override is passed", async () => {
    const config = defineConfig({ rootDir: resolve(FIXTURES_DIR, "simple-app") });
    assert.ok(config.semantic, "semantic should be populated by default");
    assert.equal(config.semantic.enabled, true);
  });

  it("fills semantic defaults when {} passed", async () => {
    const config = defineConfig({
      rootDir: resolve(FIXTURES_DIR, "simple-app"),
      semantic: {},
    });
    assert.ok(config.semantic, "semantic should be set");
    assert.equal(config.semantic.enabled, true);
    assert.equal(config.semantic.reportUnusedTypes, true);
    assert.equal(config.semantic.reportUnusedEnumMembers, true);
    assert.equal(config.semantic.reportMisclassifiedDependencies, true);
    assert.equal(config.semantic.reportRedundantVariableAliases, true);
    assert.equal(config.semantic.reportRoundTripAliases, true);
    assert.equal(config.semantic.reportUnusedClassMembers, false);
    assert.ok(Array.isArray(config.semantic.decoratorAllowlist));
    assert.ok(config.semantic.decoratorAllowlist.length > 0);
  });
});

describe("semantic / unused-types: P0 basic", () => {
  it("flags interface and type-alias with no references", async () => {
    const result = await scanFixtureWithSemantic("unused-types-basic");
    const found = unusedTypeNames(result);
    assert.deepEqual(found, ["UnusedAlias", "UnusedType"]);
  });

  it("does NOT flag types that have at least one referencing import", async () => {
    const result = await scanFixtureWithSemantic("unused-types-basic");
    const found = unusedTypeNames(result);
    assert.ok(!found.includes("UsedType"));
    assert.ok(!found.includes("UsedAlias"));
  });

  it("classifies kinds correctly (interface vs type-alias)", async () => {
    const result = await scanFixtureWithSemantic("unused-types-basic");
    const byName = new Map(result.unusedTypes.map((unusedType) => [unusedType.name, unusedType]));
    assert.equal(byName.get("UnusedType")?.kind, "interface");
    assert.equal(byName.get("UnusedAlias")?.kind, "type-alias");
  });

  it("populates trace with declaration site + reference counts", async () => {
    const result = await scanFixtureWithSemantic("unused-types-basic");
    const target = result.unusedTypes.find((unusedType) => unusedType.name === "UnusedType");
    assert.ok(target);
    assert.ok(target.trace.length > 0, "trace should be populated");
    assert.ok(
      target.trace[0].includes("UnusedType"),
      `first trace entry should mention the type, got: ${target.trace[0]}`,
    );
  });
});

describe("semantic / unused-types: nested references should NOT flag inner types", () => {
  it("does NOT flag Inner referenced only inside Outer's body", async () => {
    const result = await scanFixtureWithSemantic("unused-types-nested");
    const found = unusedTypeNames(result);
    assert.ok(!found.includes("Inner"), `Inner is used inside Outer, got: ${found}`);
    assert.ok(!found.includes("Outer"), `Outer is imported by entry, got: ${found}`);
  });

  it("still flags truly-unused types in the same module", async () => {
    const result = await scanFixtureWithSemantic("unused-types-nested");
    assert.ok(unusedTypeNames(result).includes("DeadDeep"));
  });
});

describe("semantic / unused-types: heritage clauses", () => {
  it("does NOT flag Parent when only Child is referenced (extends keeps Parent alive)", async () => {
    const result = await scanFixtureWithSemantic("unused-types-extends");
    const found = unusedTypeNames(result);
    assert.ok(!found.includes("Parent"), `Parent is extended by Child, got: ${found}`);
    assert.ok(!found.includes("Child"));
  });

  it("flags OrphanInterface with no references", async () => {
    const result = await scanFixtureWithSemantic("unused-types-extends");
    assert.ok(unusedTypeNames(result).includes("OrphanInterface"));
  });
});

describe("semantic / unused-types: re-export chains", () => {
  it("does NOT flag types reachable through 3-hop re-export chain", async () => {
    const result = await scanFixtureWithSemantic("unused-types-reexport-chain");
    const found = unusedTypeNames(result);
    assert.ok(!found.includes("TripleHopUsed"), `TripleHopUsed reaches entry, got: ${found}`);
  });

  it("flags TripleHopDead which has zero non-re-export references", async () => {
    const result = await scanFixtureWithSemantic("unused-types-reexport-chain");
    assert.ok(unusedTypeNames(result).includes("TripleHopDead"));
  });

  it("marks confidence as medium when only re-export references exist", async () => {
    const result = await scanFixtureWithSemantic("unused-types-reexport-chain");
    const target = result.unusedTypes.find((unusedType) => unusedType.name === "TripleHopDead");
    assert.equal(target?.confidence, "medium");
  });
});

describe("semantic / unused-types: declaration merging", () => {
  it("does NOT flag any branch of a merged interface when the merged symbol is referenced", async () => {
    const result = await scanFixtureWithSemantic("unused-types-decl-merge");
    const found = unusedTypeNames(result);
    assert.ok(
      !found.includes("MergedConfig"),
      `MergedConfig branches must not flag, got: ${found}`,
    );
  });

  it("flags non-merged dead types alongside merged-and-used types", async () => {
    const result = await scanFixtureWithSemantic("unused-types-decl-merge");
    assert.ok(unusedTypeNames(result).includes("SoloDead"));
  });
});

describe("semantic / unused-types: generics", () => {
  it("does NOT flag a type used only as a generic constraint", async () => {
    const result = await scanFixtureWithSemantic("unused-types-generics");
    const found = unusedTypeNames(result);
    assert.ok(!found.includes("Identifiable"), `Identifiable is a constraint, got: ${found}`);
    assert.ok(!found.includes("Box"));
  });

  it("flags DeadBox with no references at all", async () => {
    const result = await scanFixtureWithSemantic("unused-types-generics");
    assert.ok(unusedTypeNames(result).includes("DeadBox"));
  });
});

describe("semantic / unused-types: import type", () => {
  it("does NOT flag type referenced via import type", async () => {
    const result = await scanFixtureWithSemantic("unused-types-import-type");
    const found = unusedTypeNames(result);
    assert.ok(!found.includes("ReturnedShape"));
  });

  it("flags NeverImported truly dead type-alias", async () => {
    const result = await scanFixtureWithSemantic("unused-types-import-type");
    assert.ok(unusedTypeNames(result).includes("NeverImported"));
  });
});

describe("semantic / unused-types: JSDoc references", () => {
  it("does NOT flag a type referenced only from JSDoc @param annotations", async () => {
    const result = await scanFixtureWithSemantic("unused-types-jsdoc");
    const found = unusedTypeNames(result);
    assert.ok(
      !found.includes("JsDocConsumed"),
      `JsDocConsumed is used via JSDoc import("./types.js"), got: ${found}`,
    );
  });

  it("does NOT flag a type imported via regular TS import alongside JSDoc usage", async () => {
    const result = await scanFixtureWithSemantic("unused-types-jsdoc");
    assert.ok(!unusedTypeNames(result).includes("RegularImported"));
  });

  it("flags NeverReferenced as unused inside a JSDoc-aware project", async () => {
    const result = await scanFixtureWithSemantic("unused-types-jsdoc");
    assert.ok(unusedTypeNames(result).includes("NeverReferenced"));
  });
});

describe("semantic / unused-types: entry export gating", () => {
  it("respects includeEntryExports=false: never flags top-level entry exports", async () => {
    const result = await scanFixtureWithSemantic("unused-types-entry-export");
    assert.deepEqual(unusedTypeNames(result), []);
  });

  it("includeEntryExports=true flags dead types declared in the entry file", async () => {
    const result = await scanFixtureWithSemantic(
      "unused-types-entry-export",
      {},
      { includeEntryExports: true },
    );
    const found = unusedTypeNames(result);
    assert.ok(found.includes("DeadEntryType"));
    assert.ok(!found.includes("PublicApiShape"), "PublicApiShape used by callApi");
  });

  it("respects reportUnusedTypes=false: skips type detection entirely", async () => {
    const result = await scanFixtureWithSemantic("unused-types-basic", {
      reportUnusedTypes: false,
    });
    assert.deepEqual(result.unusedTypes, []);
  });
});

const misclassifiedNames = (result: ScanResult): string[] =>
  result.misclassifiedDependencies.map((finding) => finding.name).sort();

describe("semantic / misclassified-dependencies", () => {
  it("populates the additive misclassifiedDependencies field as [] when semantic is disabled", async () => {
    const result = await analyze(
      defineConfig({
        rootDir: resolve(FIXTURES_DIR, "misclassified-deps-typeonly"),
        semantic: { enabled: false },
      }),
    );
    assert.deepEqual(result.misclassifiedDependencies, []);
  });

  it("flags dependencies that are only consumed via `import type`", async () => {
    const result = await scanFixtureWithSemantic("misclassified-deps-typeonly", {
      reportUnusedTypes: false,
    });
    const names = misclassifiedNames(result);
    assert.ok(names.includes("type-only-lib"), `type-only-lib should be flagged, got: ${names}`);
  });

  it("flags dependencies that are only consumed via `export type ... from`", async () => {
    const result = await scanFixtureWithSemantic("misclassified-deps-typeonly", {
      reportUnusedTypes: false,
    });
    assert.ok(misclassifiedNames(result).includes("reexported-type-lib"));
  });

  it("does NOT flag dependencies imported with value bindings", async () => {
    const result = await scanFixtureWithSemantic("misclassified-deps-typeonly", {
      reportUnusedTypes: false,
    });
    const names = misclassifiedNames(result);
    assert.ok(!names.includes("value-used-lib"), `value-used-lib used at runtime, got: ${names}`);
  });

  it("does NOT flag side-effect imports (always runtime)", async () => {
    const result = await scanFixtureWithSemantic("misclassified-deps-typeonly", {
      reportUnusedTypes: false,
    });
    assert.ok(!misclassifiedNames(result).includes("side-effect-lib"));
  });

  it("does NOT flag mixed-use packages (any value import wins)", async () => {
    const result = await scanFixtureWithSemantic("misclassified-deps-typeonly", {
      reportUnusedTypes: false,
    });
    assert.ok(!misclassifiedNames(result).includes("mixed-use-lib"));
  });

  it("does NOT flag value re-exports `export { x } from`", async () => {
    const result = await scanFixtureWithSemantic("misclassified-deps-typeonly", {
      reportUnusedTypes: false,
    });
    assert.ok(!misclassifiedNames(result).includes("reexported-value-lib"));
  });

  it("includes a trace with at least one import site path", async () => {
    const result = await scanFixtureWithSemantic("misclassified-deps-typeonly", {
      reportUnusedTypes: false,
    });
    const finding = result.misclassifiedDependencies.find(
      (entry) => entry.name === "type-only-lib",
    );
    assert.ok(finding);
    assert.ok(finding.trace.length > 0);
    assert.ok(
      finding.trace[0].includes("src/index.ts"),
      `expected trace to mention src/index.ts, got: ${finding.trace[0]}`,
    );
  });

  it("marks suggestedAs as devDependencies for all current findings", async () => {
    const result = await scanFixtureWithSemantic("misclassified-deps-typeonly", {
      reportUnusedTypes: false,
    });
    for (const finding of result.misclassifiedDependencies) {
      assert.equal(finding.suggestedAs, "devDependencies");
    }
  });

  it("respects reportMisclassifiedDependencies=false", async () => {
    const result = await scanFixtureWithSemantic("misclassified-deps-typeonly", {
      reportUnusedTypes: false,
      reportMisclassifiedDependencies: false,
    });
    assert.deepEqual(result.misclassifiedDependencies, []);
  });
});

const enumMemberLabels = (result: ScanResult): string[] =>
  result.unusedEnumMembers.map((finding) => `${finding.enumName}.${finding.memberName}`).sort();

describe("semantic / unused-enum-members: string enum", () => {
  it("flags unreferenced members with high confidence", async () => {
    const result = await scanFixtureWithSemantic("unused-enum-members-string", {
      reportUnusedTypes: false,
      reportMisclassifiedDependencies: false,
    });
    const labels = enumMemberLabels(result);
    assert.deepEqual(labels, ["Status.Archived", "Status.Deprecated"]);
    for (const finding of result.unusedEnumMembers) {
      assert.equal(finding.confidence, "high");
    }
  });

  it("does NOT flag members that are referenced via dot access", async () => {
    const result = await scanFixtureWithSemantic("unused-enum-members-string", {
      reportUnusedTypes: false,
      reportMisclassifiedDependencies: false,
    });
    const labels = enumMemberLabels(result);
    assert.ok(!labels.includes("Status.Active"));
    assert.ok(!labels.includes("Status.Pending"));
  });
});

describe("semantic / unused-enum-members: numeric enum", () => {
  it("flags unreferenced numeric members with medium confidence", async () => {
    const result = await scanFixtureWithSemantic("unused-enum-members-numeric", {
      reportUnusedTypes: false,
      reportMisclassifiedDependencies: false,
    });
    const labels = enumMemberLabels(result);
    assert.deepEqual(labels, ["Level.High", "Level.Low", "Level.Medium"]);
    for (const finding of result.unusedEnumMembers) {
      assert.equal(finding.confidence, "medium");
    }
  });
});

describe("semantic / unused-enum-members: reverse-lookup pattern", () => {
  it("does NOT flag any member when Enum[X] computed access exists", async () => {
    const result = await scanFixtureWithSemantic("unused-enum-members-reverse-lookup", {
      reportUnusedTypes: false,
      reportMisclassifiedDependencies: false,
    });
    assert.deepEqual(result.unusedEnumMembers, []);
  });
});

describe("semantic / unused-enum-members: const enum", () => {
  it("flags unreferenced const-enum members with low confidence (inlining caveat)", async () => {
    const result = await scanFixtureWithSemantic("unused-enum-members-const", {
      reportUnusedTypes: false,
      reportMisclassifiedDependencies: false,
    });
    const labels = enumMemberLabels(result);
    assert.deepEqual(labels, ["Flags.Execute", "Flags.None"]);
    for (const finding of result.unusedEnumMembers) {
      assert.equal(finding.confidence, "low");
    }
  });
});

describe("semantic / unused-enum-members: feature flag", () => {
  it("respects reportUnusedEnumMembers=false", async () => {
    const result = await scanFixtureWithSemantic("unused-enum-members-string", {
      reportUnusedTypes: false,
      reportUnusedEnumMembers: false,
      reportMisclassifiedDependencies: false,
    });
    assert.deepEqual(result.unusedEnumMembers, []);
  });

  it("populates the additive unusedEnumMembers field as [] when semantic is disabled", async () => {
    const result = await analyze(
      defineConfig({
        rootDir: resolve(FIXTURES_DIR, "unused-enum-members-string"),
        semantic: { enabled: false },
      }),
    );
    assert.deepEqual(result.unusedEnumMembers, []);
  });
});

const scanFixtureSyntactic = async (fixtureName: string): Promise<ScanResult> =>
  analyze(defineConfig({ rootDir: resolve(FIXTURES_DIR, fixtureName) }));

const redundantAliasKinds = (result: ScanResult): Array<{ kind: string; name: string }> =>
  result.redundantAliases
    .map((finding) => ({ kind: finding.kind, name: finding.name }))
    .sort((leftEntry, rightEntry) =>
      `${leftEntry.kind}/${leftEntry.name}`.localeCompare(`${rightEntry.kind}/${rightEntry.name}`),
    );

describe("redundancy / self-aliases (syntactic, default-on)", () => {
  it("flags import { x as x }", async () => {
    const result = await scanFixtureSyntactic("redundant-aliases-self");
    const found = redundantAliasKinds(result);
    assert.ok(
      found.some((entry) => entry.kind === "import-self-alias" && entry.name === "usedThing"),
      `expected import-self-alias for usedThing, got: ${JSON.stringify(found)}`,
    );
  });

  it("flags export { x as x }", async () => {
    const result = await scanFixtureSyntactic("redundant-aliases-self");
    const found = redundantAliasKinds(result);
    assert.ok(
      found.some((entry) => entry.kind === "export-self-alias" && entry.name === "reusedLocal"),
    );
  });

  it("flags export { x as x } from ...", async () => {
    const result = await scanFixtureSyntactic("redundant-aliases-self");
    const found = redundantAliasKinds(result);
    assert.ok(
      found.some(
        (entry) => entry.kind === "reexport-self-alias" && entry.name === "reExportedThrough",
      ),
    );
  });

  it("does NOT flag legitimate renaming aliases", async () => {
    const result = await scanFixtureSyntactic("redundant-aliases-self");
    const found = redundantAliasKinds(result);
    assert.ok(
      !found.some((entry) => entry.name === "betterName"),
      `betterName is a real rename, must not flag, got: ${JSON.stringify(found)}`,
    );
    assert.ok(
      !found.some((entry) => entry.name === "renamedUsedThing"),
      `renamedUsedThing is a real rename, must not flag, got: ${JSON.stringify(found)}`,
    );
  });

  it("respects reportRedundancy=false", async () => {
    const result = await analyze(
      defineConfig({
        rootDir: resolve(FIXTURES_DIR, "redundant-aliases-self"),
        reportRedundancy: false,
      }),
    );
    assert.deepEqual(result.redundantAliases, []);
    assert.deepEqual(result.duplicateExports, []);
  });
});

describe("redundancy / variable aliases (semantic)", () => {
  it("flags const x = y when y has no other consumer", async () => {
    const result = await scanFixtureWithSemantic("redundant-aliases-variable", {
      reportUnusedTypes: false,
      reportUnusedEnumMembers: false,
      reportMisclassifiedDependencies: false,
    });
    const variableAliases = result.redundantAliases.filter(
      (entry) => entry.kind === "variable-alias",
    );
    const names = variableAliases.map((entry) => entry.name).sort();
    assert.ok(
      names.includes("renamedOnce"),
      `renamedOnce should be flagged (only consumer of ARRIVED_AT_VALUE), got: ${names}`,
    );
  });

  it("does NOT flag a variable alias when the source has other consumers", async () => {
    const result = await scanFixtureWithSemantic("redundant-aliases-variable", {
      reportUnusedTypes: false,
      reportUnusedEnumMembers: false,
      reportMisclassifiedDependencies: false,
    });
    const variableAliases = result.redundantAliases.filter(
      (entry) => entry.kind === "variable-alias",
    );
    const names = variableAliases.map((entry) => entry.name).sort();
    assert.ok(
      !names.includes("sharedAlias"),
      `sharedAlias' source SHARED_VALUE is also consumed directly — must not flag, got: ${names}`,
    );
  });

  it("respects reportRedundantVariableAliases=false", async () => {
    const result = await scanFixtureWithSemantic("redundant-aliases-variable", {
      reportUnusedTypes: false,
      reportUnusedEnumMembers: false,
      reportMisclassifiedDependencies: false,
      reportRedundantVariableAliases: false,
    });
    const variableAliases = result.redundantAliases.filter(
      (entry) => entry.kind === "variable-alias",
    );
    assert.deepEqual(variableAliases, []);
  });
});

describe("redundancy / duplicate exports", () => {
  it("flags barrels that export the same name from multiple sources", async () => {
    const result = await scanFixtureSyntactic("duplicate-exports-barrel");
    const names = result.duplicateExports.map((entry) => entry.name).sort();
    assert.ok(names.includes("shared"), `shared exported twice from barrel.ts, got: ${names}`);
  });

  it("does NOT flag uniquely-named re-exports", async () => {
    const result = await scanFixtureSyntactic("duplicate-exports-barrel");
    const names = result.duplicateExports.map((entry) => entry.name).sort();
    assert.ok(!names.includes("aOnly"));
    assert.ok(!names.includes("bOnly"));
  });

  it("records each occurrence with line + reExportSource", async () => {
    const result = await scanFixtureSyntactic("duplicate-exports-barrel");
    const sharedFinding = result.duplicateExports.find((entry) => entry.name === "shared");
    assert.ok(sharedFinding);
    assert.equal(sharedFinding.occurrences.length, 2);
    for (const occurrence of sharedFinding.occurrences) {
      assert.ok(occurrence.isReExport);
      assert.ok(occurrence.reExportSource);
    }
  });
});

const classMemberLabels = (result: ScanResult): string[] =>
  result.unusedClassMembers.map((finding) => `${finding.className}.${finding.memberName}`).sort();

describe("semantic / unused-class-members: basic", () => {
  it("flags methods and properties with no external references", async () => {
    const result = await scanFixtureWithSemantic("unused-class-members-basic", {
      reportUnusedTypes: false,
      reportUnusedEnumMembers: false,
      reportMisclassifiedDependencies: false,
      reportRedundantVariableAliases: false,
      reportUnusedClassMembers: true,
    });
    const labels = classMemberLabels(result);
    assert.ok(labels.includes("InternalCalculator.deadMethod"));
    assert.ok(labels.includes("InternalCalculator.deadProperty"));
  });

  it("does NOT flag referenced members", async () => {
    const result = await scanFixtureWithSemantic("unused-class-members-basic", {
      reportUnusedTypes: false,
      reportUnusedEnumMembers: false,
      reportMisclassifiedDependencies: false,
      reportRedundantVariableAliases: false,
      reportUnusedClassMembers: true,
    });
    const labels = classMemberLabels(result);
    assert.ok(!labels.includes("InternalCalculator.sum"), `sum is used, got: ${labels}`);
    assert.ok(
      !labels.includes("InternalCalculator.usedProperty"),
      `usedProperty is used, got: ${labels}`,
    );
  });

  it("does NOT flag private members", async () => {
    const result = await scanFixtureWithSemantic("unused-class-members-basic", {
      reportUnusedTypes: false,
      reportUnusedEnumMembers: false,
      reportMisclassifiedDependencies: false,
      reportRedundantVariableAliases: false,
      reportUnusedClassMembers: true,
    });
    const labels = classMemberLabels(result);
    assert.ok(
      !labels.includes("InternalCalculator.internalHelper"),
      `private members are ESLint territory, got: ${labels}`,
    );
  });
});

describe("semantic / unused-class-members: inheritance", () => {
  it("does NOT flag a parent method when a subclass overrides it (polymorphic call possible)", async () => {
    const result = await scanFixtureWithSemantic("unused-class-members-inherited", {
      reportUnusedTypes: false,
      reportUnusedEnumMembers: false,
      reportMisclassifiedDependencies: false,
      reportRedundantVariableAliases: false,
      reportUnusedClassMembers: true,
    });
    const labels = classMemberLabels(result);
    assert.ok(
      !labels.includes("Animal.speak"),
      `Animal.speak is overridden by Dog, got: ${labels}`,
    );
  });

  it("flags a parent method that no subclass overrides and is never called", async () => {
    const result = await scanFixtureWithSemantic("unused-class-members-inherited", {
      reportUnusedTypes: false,
      reportUnusedEnumMembers: false,
      reportMisclassifiedDependencies: false,
      reportRedundantVariableAliases: false,
      reportUnusedClassMembers: true,
    });
    const labels = classMemberLabels(result);
    assert.ok(labels.includes("Animal.sleep"));
  });

  it("does NOT flag a parent method that is called on a subclass instance", async () => {
    const result = await scanFixtureWithSemantic("unused-class-members-inherited", {
      reportUnusedTypes: false,
      reportUnusedEnumMembers: false,
      reportMisclassifiedDependencies: false,
      reportRedundantVariableAliases: false,
      reportUnusedClassMembers: true,
    });
    const labels = classMemberLabels(result);
    assert.ok(!labels.includes("Animal.eat"), `Animal.eat called via buddy.eat(), got: ${labels}`);
  });
});

describe("semantic / unused-class-members: decorators", () => {
  it("does NOT flag methods carrying a decorator in the allowlist (e.g. @Get)", async () => {
    const result = await scanFixtureWithSemantic("unused-class-members-decorated", {
      reportUnusedTypes: false,
      reportUnusedEnumMembers: false,
      reportMisclassifiedDependencies: false,
      reportRedundantVariableAliases: false,
      reportUnusedClassMembers: true,
    });
    const labels = classMemberLabels(result);
    assert.ok(!labels.includes("UserController.listUsers"));
    assert.ok(!labels.includes("UserController.currentUser"));
  });

  it("flags methods decorated with non-allowlisted decorators", async () => {
    const result = await scanFixtureWithSemantic("unused-class-members-decorated", {
      reportUnusedTypes: false,
      reportUnusedEnumMembers: false,
      reportMisclassifiedDependencies: false,
      reportRedundantVariableAliases: false,
      reportUnusedClassMembers: true,
    });
    const labels = classMemberLabels(result);
    assert.ok(labels.includes("UserController.deadInternal"));
    assert.ok(labels.includes("UserController.deadPlainMethod"));
  });

  it("respects custom decoratorAllowlist", async () => {
    const result = await scanFixtureWithSemantic("unused-class-members-decorated", {
      reportUnusedTypes: false,
      reportUnusedEnumMembers: false,
      reportMisclassifiedDependencies: false,
      reportRedundantVariableAliases: false,
      reportUnusedClassMembers: true,
      decoratorAllowlist: ["Get", "Internal"],
    });
    const labels = classMemberLabels(result);
    assert.ok(
      !labels.includes("UserController.deadInternal"),
      `Internal now allowlisted, got: ${labels}`,
    );
    assert.ok(labels.includes("UserController.deadPlainMethod"));
  });
});

describe("semantic / unused-class-members: feature flag default", () => {
  it("is off by default (P1 stability)", async () => {
    const result = await scanFixtureWithSemantic("unused-class-members-basic", {
      reportUnusedTypes: false,
      reportUnusedEnumMembers: false,
      reportMisclassifiedDependencies: false,
      reportRedundantVariableAliases: false,
    });
    assert.deepEqual(result.unusedClassMembers, []);
  });
});

describe("redundancy / DRY patterns (syntactic)", () => {
  it("flags duplicate imports from the same module", async () => {
    const result = await scanFixtureSyntactic("dry-patterns-syntactic");
    const finding = result.duplicateImports.find((entry) => entry.specifier === "./helpers.js");
    assert.ok(
      finding,
      `expected ./helpers.js duplicate import, got: ${JSON.stringify(result.duplicateImports)}`,
    );
    assert.equal(finding.occurrences.length, 3);
  });

  it("does NOT flag a module imported only once", async () => {
    const result = await scanFixtureSyntactic("dry-patterns-syntactic");
    assert.ok(!result.duplicateImports.some((entry) => entry.specifier === "./other.js"));
  });

  it("flags every redundant type utility pattern", async () => {
    const result = await scanFixtureSyntactic("dry-patterns-syntactic");
    const patternsByKind = new Map<string, string[]>();
    for (const finding of result.redundantTypePatterns) {
      const list = patternsByKind.get(finding.kind);
      if (list) list.push(finding.typeName);
      else patternsByKind.set(finding.kind, [finding.typeName]);
    }
    assert.deepEqual(patternsByKind.get("intersection-with-empty-object"), ["IntersectWithEmpty"]);
    assert.deepEqual(patternsByKind.get("self-union"), ["SelfUnion"]);
    assert.deepEqual(patternsByKind.get("nested-partial"), ["NestedPartial"]);
    assert.deepEqual(patternsByKind.get("nested-readonly"), ["NestedReadonly"]);
    assert.deepEqual(patternsByKind.get("pick-all-keys"), ["PickAll"]);
    assert.deepEqual(patternsByKind.get("omit-no-keys"), ["OmitNever"]);
    assert.deepEqual(patternsByKind.get("empty-interface-extends-one"), ["EmptyExtends"]);
  });

  it("does NOT flag legitimate interface/type definitions", async () => {
    const result = await scanFixtureSyntactic("dry-patterns-syntactic");
    const flaggedTypeNames = new Set(
      result.redundantTypePatterns.map((finding) => finding.typeName),
    );
    assert.ok(!flaggedTypeNames.has("User"));
    assert.ok(!flaggedTypeNames.has("LegitChild"));
    assert.ok(!flaggedTypeNames.has("LegitUnion"));
  });

  it("does NOT flag Zod-style declaration-merging (`interface X extends Schema.infer<typeof X>`)", async () => {
    const result = await scanFixtureSyntactic("dry-patterns-syntactic");
    const flaggedTypeNames = new Set(
      result.redundantTypePatterns.map((finding) => finding.typeName),
    );
    assert.ok(
      !flaggedTypeNames.has("ZodMergedSchemaShape"),
      "extending `Namespace.infer<...>` is the canonical Zod/Effect schema-type merging idiom",
    );
  });

  it("does NOT flag UI primitive prop re-aliasing (`interface X extends Lib.Component.Props`)", async () => {
    const result = await scanFixtureSyntactic("dry-patterns-syntactic");
    const flaggedTypeNames = new Set(
      result.redundantTypePatterns.map((finding) => finding.typeName),
    );
    assert.ok(
      !flaggedTypeNames.has("CheckboxRootProps"),
      "extending `Namespace.Props` is the canonical Radix/Ark prop re-export idiom",
    );
  });

  it("flags identity wrappers and ignores wrappers that add real work", async () => {
    const result = await scanFixtureSyntactic("dry-patterns-syntactic");
    const wrapperNames = result.identityWrappers.map((finding) => finding.wrapperName).sort();
    assert.deepEqual(wrapperNames, ["callOnly", "debugLog", "triggerWith", "variadicWrap"]);
  });

  it("does NOT flag wrappers that transform arguments or reorder them", async () => {
    const result = await scanFixtureSyntactic("dry-patterns-syntactic");
    const wrapperNames = new Set(result.identityWrappers.map((finding) => finding.wrapperName));
    assert.ok(!wrapperNames.has("legitWrap"), "legitWrap calls .toUpperCase() — not an identity");
    assert.ok(!wrapperNames.has("legitExtra"), "legitExtra adds an extra arg");
    assert.ok(!wrapperNames.has("legitDifferentOrder"), "legitDifferentOrder swaps args");
  });

  it("flags structurally-identical type definitions across modules", async () => {
    const result = await scanFixtureSyntactic("dry-patterns-syntactic");
    const userDuplicates = result.duplicateTypeDefinitions.filter((entry) =>
      entry.instances.some((instance) => instance.typeName === "User"),
    );
    assert.equal(userDuplicates.length, 1);
    assert.ok(userDuplicates[0].instances.length >= 2);
  });

  it("respects reportRedundancy=false for all DRY patterns", async () => {
    const result = await analyze(
      defineConfig({
        rootDir: resolve(FIXTURES_DIR, "dry-patterns-syntactic"),
        reportRedundancy: false,
      }),
    );
    assert.deepEqual(result.duplicateImports, []);
    assert.deepEqual(result.redundantTypePatterns, []);
    assert.deepEqual(result.identityWrappers, []);
    assert.deepEqual(result.duplicateTypeDefinitions, []);
  });
});

describe("redundancy / aliased re-export not consumed (syntactic graph)", () => {
  it("flags re-exports whose new name no consumer imports", async () => {
    const result = await scanFixtureSyntactic("redundant-reexports-semantic");
    const reexportFindings = result.redundantAliases.filter(
      (finding) => finding.kind === "reexport-aliased-not-used",
    );
    const flaggedNames = reexportFindings.map((finding) => finding.name).sort();
    assert.ok(
      flaggedNames.includes("wronglyAliased"),
      `wronglyAliased should flag — consumer imports usedOnlyByOriginalName directly, got: ${flaggedNames}`,
    );
  });

  it("does NOT flag aliased re-exports that are actually consumed under the new name", async () => {
    const result = await scanFixtureSyntactic("redundant-reexports-semantic");
    const reexportFindings = result.redundantAliases.filter(
      (finding) => finding.kind === "reexport-aliased-not-used",
    );
    const flaggedNames = new Set(reexportFindings.map((finding) => finding.name));
    assert.ok(!flaggedNames.has("goodAlias"), `goodAlias is consumed under its alias`);
  });
});

describe("redundancy / round-trip aliases (semantic)", () => {
  it("flags `import { x as y }` where y matches the underlying declaration name", async () => {
    const result = await scanFixtureWithSemantic("redundant-reexports-semantic", {
      reportUnusedTypes: false,
      reportUnusedEnumMembers: false,
      reportMisclassifiedDependencies: false,
      reportRedundantVariableAliases: false,
    });
    const roundTrips = result.redundantAliases.filter(
      (finding) => finding.kind === "roundtrip-alias",
    );
    assert.ok(
      roundTrips.some(
        (finding) => finding.name === "realThing" && finding.aliasedFrom === "renamedThing",
      ),
      `expected round-trip alias for realThing ← renamedThing, got: ${JSON.stringify(roundTrips)}`,
    );
  });

  it("respects reportRoundTripAliases=false", async () => {
    const result = await scanFixtureWithSemantic("redundant-reexports-semantic", {
      reportUnusedTypes: false,
      reportUnusedEnumMembers: false,
      reportMisclassifiedDependencies: false,
      reportRedundantVariableAliases: false,
      reportRoundTripAliases: false,
    });
    const roundTrips = result.redundantAliases.filter(
      (finding) => finding.kind === "roundtrip-alias",
    );
    assert.deepEqual(roundTrips, []);
  });
});

describe("redundancy / duplicate inline types (inside functions, returns, locals)", () => {
  it("flags identical inline shape across parameters, returns, and local type aliases", async () => {
    const result = await scanFixtureSyntactic("duplicate-inline-types");
    assert.ok(
      result.duplicateInlineTypes.length >= 1,
      `expected at least 1 inline duplicate, got: ${result.duplicateInlineTypes.length}`,
    );
    const profileGroup = result.duplicateInlineTypes.find(
      (entry) =>
        entry.preview.includes("email") &&
        entry.preview.includes("id") &&
        entry.preview.includes("name"),
    );
    assert.ok(
      profileGroup,
      `expected profile shape, got: ${JSON.stringify(result.duplicateInlineTypes)}`,
    );
    assert.ok(
      profileGroup.occurrences.length >= 5,
      `at least 5 occurrences expected, got ${profileGroup.occurrences.length}`,
    );
    const contexts = new Set(profileGroup.occurrences.map((occurrence) => occurrence.context));
    assert.ok(contexts.has("function-parameter"));
    assert.ok(contexts.has("function-return"));
    assert.ok(contexts.has("local-type-alias"));
  });

  it("does NOT flag shapes with fewer than 3 properties (noise threshold)", async () => {
    const result = await scanFixtureSyntactic("duplicate-inline-types");
    const twoPropFinding = result.duplicateInlineTypes.find(
      (entry) => entry.preview.includes("a") && entry.preview.includes("b"),
    );
    assert.ok(!twoPropFinding, "2-prop shapes should be below threshold");
  });

  it("does NOT flag shapes that occur only once", async () => {
    const result = await scanFixtureSyntactic("duplicate-inline-types");
    const uniqueFinding = result.duplicateInlineTypes.find((entry) =>
      entry.preview.includes("onlyHere"),
    );
    assert.ok(!uniqueFinding, "single-occurrence shape should not be flagged");
  });

  it("records nearestName so the user can locate each duplicate", async () => {
    const result = await scanFixtureSyntactic("duplicate-inline-types");
    const profileGroup = result.duplicateInlineTypes.find((entry) =>
      entry.preview.includes("email"),
    );
    assert.ok(profileGroup);
    const namesByContext = new Map<string, string | undefined>();
    for (const occurrence of profileGroup.occurrences) {
      namesByContext.set(occurrence.context, occurrence.nearestName);
    }
    assert.ok(
      namesByContext.get("function-return") === "fetchProfile" ||
        namesByContext.get("function-return") === "buildProfile",
      `function-return nearestName should be a function name, got: ${namesByContext.get("function-return")}`,
    );
    assert.equal(namesByContext.get("local-type-alias"), "ProfileLocal");
  });

  it("respects reportRedundancy=false", async () => {
    const result = await analyze(
      defineConfig({
        rootDir: resolve(FIXTURES_DIR, "duplicate-inline-types"),
        reportRedundancy: false,
      }),
    );
    assert.deepEqual(result.duplicateInlineTypes, []);
  });
});

const simplifiableLabels = (result: ScanResult): Array<{ kind: string; functionName?: string }> =>
  result.simplifiableFunctions.map((finding) => ({
    kind: finding.kind,
    functionName: finding.functionName,
  }));

describe("redundancy / simplifiable functions", () => {
  it("flags `(x) => { return f(x); }` as block-arrow-single-return", async () => {
    const result = await scanFixtureSyntactic("simplifiable-functions");
    const labels = simplifiableLabels(result);
    assert.ok(
      labels.some(
        (entry) =>
          entry.kind === "block-arrow-single-return" && entry.functionName === "blockArrowSimple",
      ),
      `expected block-arrow-single-return for blockArrowSimple, got: ${JSON.stringify(labels)}`,
    );
  });

  it("does NOT flag block bodies with more than one statement", async () => {
    const result = await scanFixtureSyntactic("simplifiable-functions");
    assert.ok(
      !result.simplifiableFunctions.some(
        (finding) =>
          finding.kind === "block-arrow-single-return" &&
          finding.functionName === "blockArrowComplex",
      ),
    );
  });

  it("does NOT flag arrows that are already expression-bodied", async () => {
    const result = await scanFixtureSyntactic("simplifiable-functions");
    assert.ok(
      !result.simplifiableFunctions.some((finding) => finding.functionName === "expressionArrow"),
    );
  });

  it("flags `const x = await Y; return x;` as redundant-await-return", async () => {
    const result = await scanFixtureSyntactic("simplifiable-functions");
    const labels = simplifiableLabels(result);
    assert.ok(
      labels.some(
        (entry) =>
          entry.kind === "redundant-await-return" && entry.functionName === "fetchDataRedundant",
      ),
    );
  });

  it("flags useless-async only when body has no calls/await/Promise surface (low confidence)", async () => {
    const result = await scanFixtureSyntactic("simplifiable-functions");
    const uselessAsync = result.simplifiableFunctions.filter(
      (finding) => finding.kind === "useless-async-no-await",
    );
    const names = new Set(uselessAsync.map((finding) => finding.functionName));
    assert.ok(names.has("uselessAsync"), `uselessAsync must flag, got: ${[...names]}`);
    assert.ok(
      !names.has("fetchDataDirect"),
      `fetchDataDirect calls Promise.resolve — must NOT flag, got: ${[...names]}`,
    );
    for (const finding of uselessAsync) {
      assert.equal(finding.confidence, "low", "useless-async findings should be low-confidence");
    }
  });

  it("does NOT flag genuinely async functions that await", async () => {
    const result = await scanFixtureSyntactic("simplifiable-functions");
    assert.ok(
      !result.simplifiableFunctions.some(
        (finding) =>
          finding.kind === "useless-async-no-await" && finding.functionName === "legitAsync",
      ),
    );
  });

  it("does NOT flag useless-async when the function has an explicit Promise<T> return type (contract preserved)", async () => {
    const result = await scanFixtureSyntactic("simplifiable-functions");
    const flaggedNames = new Set(
      result.simplifiableFunctions
        .filter((finding) => finding.kind === "useless-async-no-await")
        .map((finding) => finding.functionName),
    );
    assert.ok(
      !flaggedNames.has("uselessAsyncWithPromiseReturnType"),
      `Promise<T> annotation makes async load-bearing — must NOT flag, got: ${[...flaggedNames]}`,
    );
  });

  it("does NOT flag useless-async on object method shorthands (interface-contract methods)", async () => {
    const result = await scanFixtureSyntactic("simplifiable-functions");
    const flaggedNames = new Set(
      result.simplifiableFunctions
        .filter((finding) => finding.kind === "useless-async-no-await")
        .map((finding) => finding.functionName),
    );
    assert.ok(
      !flaggedNames.has("redirects"),
      `object method shorthand 'async redirects() {}' must NOT flag (Next.js config pattern), got: ${[...flaggedNames]}`,
    );
  });

  it("does NOT flag useless-async on object property arrows (e.g. mock-response callbacks)", async () => {
    const result = await scanFixtureSyntactic("simplifiable-functions");
    const flaggedNames = new Set(
      result.simplifiableFunctions
        .filter((finding) => finding.kind === "useless-async-no-await")
        .map((finding) => finding.functionName),
    );
    assert.ok(
      !flaggedNames.has("text"),
      `'{ text: async () => "x" }' must NOT flag (Response.text() callback signature), got: ${[...flaggedNames]}`,
    );
    assert.ok(
      !flaggedNames.has("json"),
      `'{ json: async () => ({}) }' must NOT flag, got: ${[...flaggedNames]}`,
    );
  });

  it("does NOT flag useless-async on arrows passed directly as CallExpression arguments", async () => {
    const result = await scanFixtureSyntactic("simplifiable-functions");
    const inlineAsyncCallbacks = result.simplifiableFunctions.filter(
      (finding) =>
        finding.kind === "useless-async-no-await" &&
        finding.path.endsWith("simplifiable-functions/src/index.ts") &&
        finding.line > 30,
    );
    assert.equal(
      inlineAsyncCallbacks.length,
      0,
      `inline inlineCallbackInvoker arrow must NOT flag (callback signature is contract), got: ${inlineAsyncCallbacks
        .map((finding) => `${finding.kind} ${finding.path}:${finding.line}`)
        .join(", ")}`,
    );
  });

  it("respects reportRedundancy=false", async () => {
    const result = await analyze(
      defineConfig({
        rootDir: resolve(FIXTURES_DIR, "simplifiable-functions"),
        reportRedundancy: false,
      }),
    );
    assert.deepEqual(result.simplifiableFunctions, []);
  });
});

describe("redundancy / simplifiable expressions", () => {
  it("flags `!!x` as double-bang-boolean with high confidence", async () => {
    const result = await scanFixtureSyntactic("simplifiable-expressions");
    const doubleBangs = result.simplifiableExpressions.filter(
      (finding) => finding.kind === "double-bang-boolean",
    );
    assert.ok(
      doubleBangs.length >= 3,
      `expected at least 3 double-bang findings, got: ${doubleBangs.length}`,
    );
    for (const finding of doubleBangs) {
      assert.equal(finding.confidence, "high");
    }
  });

  it("flags `x ? x : y` as self-fallback-ternary", async () => {
    const result = await scanFixtureSyntactic("simplifiable-expressions");
    const selfFallbacks = result.simplifiableExpressions.filter(
      (finding) => finding.kind === "self-fallback-ternary",
    );
    assert.ok(
      selfFallbacks.some((finding) => finding.snippet.startsWith("config ? config")),
      `expected config self-fallback, got: ${JSON.stringify(selfFallbacks.map((finding) => finding.snippet))}`,
    );
  });

  it("does NOT flag legitimate ternaries where consequent differs from test", async () => {
    const result = await scanFixtureSyntactic("simplifiable-expressions");
    const selfFallbacks = result.simplifiableExpressions.filter(
      (finding) => finding.kind === "self-fallback-ternary",
    );
    for (const finding of selfFallbacks) {
      assert.ok(
        !finding.snippet.includes(`legitTernary`),
        `legit ternary must not be flagged: ${finding.snippet}`,
      );
    }
  });

  it("flags `cond ? true : false` and `cond ? false : true`", async () => {
    const result = await scanFixtureSyntactic("simplifiable-expressions");
    const ternaryBools = result.simplifiableExpressions.filter(
      (finding) => finding.kind === "ternary-returns-boolean",
    );
    assert.equal(ternaryBools.length, 2);
    const snippets = ternaryBools.map((finding) => finding.snippet);
    assert.ok(snippets.includes("cond ? true : false"));
    assert.ok(snippets.includes("cond ? false : true"));
  });

  it("does NOT flag boolean-returning ternaries with non-boolean consequents", async () => {
    const result = await scanFixtureSyntactic("simplifiable-expressions");
    const ternaryBools = result.simplifiableExpressions.filter(
      (finding) => finding.kind === "ternary-returns-boolean",
    );
    for (const finding of ternaryBools) {
      assert.ok(
        finding.snippet !== "cond ? 'yes' : 'no'",
        `non-boolean ternary must not flag: ${finding.snippet}`,
      );
    }
  });

  it("flags `x ?? null` and `x ?? undefined` as nullish-no-op", async () => {
    const result = await scanFixtureSyntactic("simplifiable-expressions");
    const nullish = result.simplifiableExpressions.filter(
      (finding) => finding.kind === "nullish-coalescing-with-nullish",
    );
    const snippets = nullish.map((finding) => finding.snippet);
    assert.ok(snippets.includes("someValue ?? null"));
    assert.ok(snippets.includes("someValue ?? undefined"));
  });

  it("does NOT flag `x ?? value` with a real fallback", async () => {
    const result = await scanFixtureSyntactic("simplifiable-expressions");
    const nullish = result.simplifiableExpressions.filter(
      (finding) => finding.kind === "nullish-coalescing-with-nullish",
    );
    for (const finding of nullish) {
      assert.ok(!finding.snippet.includes('"fallback"'));
    }
  });

  it("flags `x !== null && x !== undefined` in either order", async () => {
    const result = await scanFixtureSyntactic("simplifiable-expressions");
    const redundantChecks = result.simplifiableExpressions.filter(
      (finding) => finding.kind === "redundant-null-and-undefined-check",
    );
    assert.equal(redundantChecks.length, 2);
    for (const finding of redundantChecks) {
      assert.ok(finding.suggestion.includes("!= null"));
    }
  });

  it("does NOT flag mixed null/typeof checks", async () => {
    const result = await scanFixtureSyntactic("simplifiable-expressions");
    const redundantChecks = result.simplifiableExpressions.filter(
      (finding) => finding.kind === "redundant-null-and-undefined-check",
    );
    for (const finding of redundantChecks) {
      assert.ok(!finding.snippet.includes("typeof"));
    }
  });
});

describe("redundancy / cross-file duplicate constants", () => {
  it("flags same string literal repeated across 3+ files with same name as high confidence", async () => {
    const result = await scanFixtureSyntactic("duplicate-constants");
    const apiBaseFinding = result.duplicateConstants.find((finding) =>
      finding.occurrences.every((occurrence) => occurrence.constantName === "API_BASE_URL"),
    );
    assert.ok(
      apiBaseFinding,
      `expected API_BASE_URL duplicate, got: ${JSON.stringify(result.duplicateConstants)}`,
    );
    assert.equal(apiBaseFinding.confidence, "high");
    assert.equal(apiBaseFinding.occurrences.length, 3);
  });

  it("does NOT flag short strings below the length threshold", async () => {
    const result = await scanFixtureSyntactic("duplicate-constants");
    for (const finding of result.duplicateConstants) {
      assert.ok(!finding.literalPreview.includes('"x"'));
    }
  });

  it("does NOT flag small numeric literals below the threshold", async () => {
    const result = await scanFixtureSyntactic("duplicate-constants");
    for (const finding of result.duplicateConstants) {
      assert.ok(!finding.literalPreview.includes("42"));
    }
  });

  it("does NOT flag values that appear in fewer than 3 distinct files", async () => {
    const result = await scanFixtureSyntactic("duplicate-constants");
    for (const finding of result.duplicateConstants) {
      const uniquePaths = new Set(finding.occurrences.map((occurrence) => occurrence.path));
      assert.ok(uniquePaths.size >= 3);
    }
  });

  it("marks duplicates with different names as medium confidence", async () => {
    const result = await scanFixtureSyntactic("duplicate-constants");
    const pollFinding = result.duplicateConstants.find((finding) =>
      finding.occurrences.some((occurrence) => occurrence.constantName === "POLL_INTERVAL_MS"),
    );
    if (pollFinding) {
      assert.equal(pollFinding.confidence, "medium");
    }
  });

  it("respects reportRedundancy=false", async () => {
    const result = await analyze(
      defineConfig({
        rootDir: resolve(FIXTURES_DIR, "duplicate-constants"),
        reportRedundancy: false,
      }),
    );
    assert.deepEqual(result.duplicateConstants, []);
  });
});

describe("redundancy / duplicate-constants unit-suffix awareness", () => {
  it("does NOT flag same-value constants whose names use distinct unit suffixes (semantically different quantities)", async () => {
    const result = await scanFixtureSyntactic("duplicate-constants-unit-mismatch");
    const value1000Finding = result.duplicateConstants.find(
      (finding) => finding.literalPreview === "1000",
    );
    assert.equal(
      value1000Finding,
      undefined,
      `STEP_DELAY_MS(_MS) + MINIMUM_TOKENS(_TOKENS) + SCREEN_WIDTH(_WIDTH) all = 1000 but represent different units — must NOT flag, got: ${JSON.stringify(value1000Finding)}`,
    );
  });

  it("STILL flags same-value constants when all names share the same unit suffix (truly extractable)", async () => {
    const result = await scanFixtureSyntactic("duplicate-constants-unit-mismatch");
    const value2000Finding = result.duplicateConstants.find(
      (finding) => finding.literalPreview === "2000",
    );
    assert.ok(
      value2000Finding,
      `CACHE_INTERVAL_MS + RECONNECT_DELAY_MS + POLL_INTERVAL_MS all = 2000 ms — SHOULD still flag, got: ${JSON.stringify(result.duplicateConstants)}`,
    );
    assert.equal(value2000Finding.confidence, "medium");
  });
});

describe("redundancy / regression: numeric / symbol / call-signature keys", () => {
  it("does not crash on interfaces with numeric property keys, index signatures, or call signatures", async () => {
    const result = await scanFixtureSyntactic("numeric-keys-types");
    assert.ok(Array.isArray(result.duplicateTypeDefinitions));
    assert.ok(Array.isArray(result.duplicateInlineTypes));
    assert.ok(result.totalFiles > 0);
  });
});
