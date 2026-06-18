import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { collectOverrideMappingsFromRecord } from "../src/utils/collect-override-mappings-from-record.js";
import { collectPnpmWorkspaceOverrideMappings } from "../src/utils/parse-pnpm-workspace-overrides.js";
import { matchesPackageImportReference } from "../src/utils/matches-package-import-reference.js";
import { matchesPackageTokenReference } from "../src/utils/matches-package-token-reference.js";
import { resolve } from "node:path";

describe("collectOverrideMappingsFromRecord", () => {
  it("should flatten nested override records", () => {
    const mappings = collectOverrideMappingsFromRecord({
      vite: "npm:@voidzero-dev/vite-plus-core@^0.1.20",
      "eslint-config-custom@1.0.0": {
        typescript: "npm:@typescript/native-preview",
      },
    });

    assert.deepEqual(mappings, [
      { fromPackage: "vite", toPackage: "@voidzero-dev/vite-plus-core" },
      { fromPackage: "typescript", toPackage: "@typescript/native-preview" },
    ]);
  });
});

describe("collectPnpmWorkspaceOverrideMappings", () => {
  it("should parse overrides under pnpm blocks", () => {
    const fixtureDir = resolve(import.meta.dirname, "fixtures/vitest-override-target");
    const mappings = collectPnpmWorkspaceOverrideMappings(fixtureDir);

    assert.deepEqual(mappings, [
      { fromPackage: "vitest", toPackage: "@voidzero-dev/vite-plus-test" },
    ]);
  });

  it("should parse nested overrides from workspace yaml", () => {
    const fixtureDir = resolve(import.meta.dirname, "fixtures/pnpm-nested-overrides");
    const mappings = collectPnpmWorkspaceOverrideMappings(fixtureDir);

    assert.deepEqual(mappings, [
      { fromPackage: "typescript", toPackage: "@typescript/native-preview" },
    ]);
  });
});

describe("matchesPackageImportReference", () => {
  it("should match import and require usage", () => {
    const source = [
      "import foo from 'used-package/subpath'",
      'const bar = require("used-package")',
      'const names = ["unused-string-only-package"]',
    ].join("\n");

    assert.equal(matchesPackageImportReference(source, "used-package"), true);
    assert.equal(matchesPackageImportReference(source, "unused-string-only-package"), false);
    assert.equal(
      matchesPackageImportReference(
        "const icon = require(`flag-icons/flags/4x3/${code}.svg`);",
        "flag-icons",
      ),
      true,
    );
  });
});

describe("matchesPackageTokenReference", () => {
  it("should match a dep passed as a flag argument", () => {
    assert.equal(
      matchesPackageTokenReference(
        "jest --coverage --testResultsProcessor jest-sonar-reporter",
        "jest-sonar-reporter",
      ),
      true,
    );
  });

  it("should match a dep passed as an `=`-joined flag value", () => {
    assert.equal(matchesPackageTokenReference("jest --reporters=jest-junit", "jest-junit"), true);
  });

  it("should match a scoped dep and a dep with a /subpath", () => {
    assert.equal(matchesPackageTokenReference("node @org/cli build", "@org/cli"), true);
    assert.equal(matchesPackageTokenReference("node some-pkg/register app.js", "some-pkg"), true);
  });

  it("should not match a token that merely contains the name", () => {
    assert.equal(
      matchesPackageTokenReference("run my-jest-sonar-reporter-extra", "jest-sonar-reporter"),
      false,
    );
  });
});
