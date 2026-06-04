import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { checkPnpmHardening } from "@react-doctor/core";

const FIXTURES_DIRECTORY = path.resolve(import.meta.dirname, "fixtures", "check-pnpm-hardening");

const HARDENING_RULE_KEY = "require-pnpm-hardening";

interface FixtureExpectation {
  readonly name: string;
  readonly description: string;
  readonly expectedRuleKeys: ReadonlyArray<string>;
  readonly expectedSubstrings: ReadonlyArray<string>;
}

const FIXTURE_EXPECTATIONS: ReadonlyArray<FixtureExpectation> = [
  {
    name: "hardened",
    description: "all three settings set to hardened values → no warnings",
    expectedRuleKeys: [],
    expectedSubstrings: [],
  },
  {
    name: "missing-all-settings",
    description:
      "pnpm-workspace.yaml present but lacks all three keys → warns on minimumReleaseAge + trustPolicy (blockExoticSubdeps defaults to true)",
    expectedRuleKeys: [HARDENING_RULE_KEY, HARDENING_RULE_KEY],
    expectedSubstrings: ["minimumReleaseAge", "trustPolicy"],
  },
  {
    name: "custom-release-age",
    description:
      "custom minimumReleaseAge of 1440 (1 day) → no warnings (any custom value accepted)",
    expectedRuleKeys: [],
    expectedSubstrings: [],
  },
  {
    name: "exotic-subdeps-allowed",
    description:
      "`blockExoticSubdeps: false` is the only violation → exactly one warning citing that key",
    expectedRuleKeys: [HARDENING_RULE_KEY],
    expectedSubstrings: ["blockExoticSubdeps"],
  },
  {
    name: "trust-policy-weakened",
    description: "`trustPolicy: any` is weaker than `no-downgrade` → exactly one warning",
    expectedRuleKeys: [HARDENING_RULE_KEY],
    expectedSubstrings: ["trustPolicy: any"],
  },
  {
    name: "trust-policy-missing",
    description: "trustPolicy missing entirely → exactly one warning",
    expectedRuleKeys: [HARDENING_RULE_KEY],
    expectedSubstrings: ["trustPolicy"],
  },
  {
    name: "catalog-key-shadowing",
    description: "the three hardening keys nested inside `catalog:` must be ignored",
    expectedRuleKeys: [],
    expectedSubstrings: [],
  },
  {
    name: "quoted-values",
    description: "quoted scalars (single, double, and quoted keys) parse correctly",
    expectedRuleKeys: [],
    expectedSubstrings: [],
  },
  {
    name: "comments-only",
    description: "commented-out keys count as absent → warns on minimumReleaseAge + trustPolicy",
    expectedRuleKeys: [HARDENING_RULE_KEY, HARDENING_RULE_KEY],
    expectedSubstrings: ["minimumReleaseAge", "trustPolicy"],
  },
  {
    name: "empty-workspace",
    description:
      "completely empty pnpm-workspace.yaml file → warns on minimumReleaseAge + trustPolicy",
    expectedRuleKeys: [HARDENING_RULE_KEY, HARDENING_RULE_KEY],
    expectedSubstrings: ["minimumReleaseAge", "trustPolicy"],
  },
  {
    name: "package-manager-only",
    description:
      "pnpm detected via `packageManager` field with no workspace yaml → warns on minimumReleaseAge + trustPolicy",
    expectedRuleKeys: [HARDENING_RULE_KEY, HARDENING_RULE_KEY],
    expectedSubstrings: ["minimumReleaseAge", "trustPolicy"],
  },
  {
    name: "pnpm-lock-only",
    description:
      "pnpm-lock.yaml alone is enough to detect a pnpm project; warns on minimumReleaseAge + trustPolicy",
    expectedRuleKeys: [HARDENING_RULE_KEY, HARDENING_RULE_KEY],
    expectedSubstrings: ["minimumReleaseAge", "trustPolicy"],
  },
  {
    name: "not-pnpm",
    description: "no pnpm signals at all (yarn project) → check is skipped entirely",
    expectedRuleKeys: [],
    expectedSubstrings: [],
  },
];

describe("checkPnpmHardening (fixtures)", () => {
  for (const expectation of FIXTURE_EXPECTATIONS) {
    it(`${expectation.name}: ${expectation.description}`, () => {
      const fixtureDirectory = path.join(FIXTURES_DIRECTORY, expectation.name);
      const diagnostics = checkPnpmHardening(fixtureDirectory);

      const observedRuleKeys = diagnostics.map((diagnostic) => diagnostic.rule);
      expect(observedRuleKeys).toEqual([...expectation.expectedRuleKeys]);

      const concatenatedMessages = diagnostics.map((diagnostic) => diagnostic.message).join("\n");
      for (const expectedSubstring of expectation.expectedSubstrings) {
        expect(concatenatedMessages).toContain(expectedSubstring);
      }

      for (const diagnostic of diagnostics) {
        expect(diagnostic.plugin).toBe("react-doctor");
        expect(diagnostic.severity).toBe("warning");
        expect(diagnostic.category).toBe("Security");
        expect(diagnostic.filePath).toBe("pnpm-workspace.yaml");
        expect(diagnostic.help.length).toBeGreaterThan(0);
        expect(diagnostic.message.length).toBeGreaterThan(0);
      }
    });
  }

  it("reports the recommended 7-day (10080-minute) starting point in the help text for the missing-minimumReleaseAge diagnostic", () => {
    const diagnostics = checkPnpmHardening(path.join(FIXTURES_DIRECTORY, "missing-all-settings"));
    const minimumReleaseAgeDiagnostic = diagnostics.find((diagnostic) =>
      diagnostic.message.includes("minimumReleaseAge"),
    );
    expect(minimumReleaseAgeDiagnostic).toBeDefined();
    expect(minimumReleaseAgeDiagnostic?.help).toContain("10080");
    expect(minimumReleaseAgeDiagnostic?.help).toContain("7 days");
  });

  it("points at the actual line of `blockExoticSubdeps: false` when the key is present", () => {
    const diagnostics = checkPnpmHardening(path.join(FIXTURES_DIRECTORY, "exotic-subdeps-allowed"));
    const fixtureSource = fs.readFileSync(
      path.join(FIXTURES_DIRECTORY, "exotic-subdeps-allowed", "pnpm-workspace.yaml"),
      "utf-8",
    );
    const expectedLine =
      fixtureSource.split("\n").findIndex((line) => line.startsWith("blockExoticSubdeps")) + 1;
    expect(expectedLine).toBeGreaterThan(0);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].line).toBe(expectedLine);
    expect(diagnostics[0].column).toBe(1);
  });

  it("points at the actual line of `trustPolicy: any` when the key is present", () => {
    const diagnostics = checkPnpmHardening(path.join(FIXTURES_DIRECTORY, "trust-policy-weakened"));
    const fixtureSource = fs.readFileSync(
      path.join(FIXTURES_DIRECTORY, "trust-policy-weakened", "pnpm-workspace.yaml"),
      "utf-8",
    );
    const expectedLine =
      fixtureSource.split("\n").findIndex((line) => line.startsWith("trustPolicy")) + 1;
    expect(expectedLine).toBeGreaterThan(0);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].line).toBe(expectedLine);
  });

  it("zeros out line/column for diagnostics about missing keys", () => {
    const diagnostics = checkPnpmHardening(path.join(FIXTURES_DIRECTORY, "missing-all-settings"));
    for (const diagnostic of diagnostics) {
      expect(diagnostic.line).toBe(0);
      expect(diagnostic.column).toBe(0);
    }
  });
});

describe("checkPnpmHardening (parser edge cases)", () => {
  let temporaryRoot: string;

  beforeEach(() => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-pnpm-hardening-"));
  });

  afterEach(() => {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  });

  const writeWorkspaceFixture = (caseName: string, workspaceYamlContents: string): string => {
    const projectDirectory = path.join(temporaryRoot, caseName);
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({ name: caseName, dependencies: { react: "^19.0.0" } }),
    );
    fs.writeFileSync(path.join(projectDirectory, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    fs.writeFileSync(path.join(projectDirectory, "pnpm-workspace.yaml"), workspaceYamlContents);
    return projectDirectory;
  };

  it("ignores `minimumReleaseAge` written at any non-zero indentation", () => {
    const projectDirectory = writeWorkspaceFixture(
      "indented-keys",
      `packages:\n  - "packages/*"\n  minimumReleaseAge: 10080\n  blockExoticSubdeps: true\n  trustPolicy: no-downgrade\n`,
    );

    const diagnostics = checkPnpmHardening(projectDirectory);

    expect(diagnostics).toHaveLength(2);
    const messages = diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("minimumReleaseAge");
    expect(messages).toContain("trustPolicy");
  });

  it("strips trailing whitespace from a scalar before comparing to `no-downgrade`", () => {
    const projectDirectory = writeWorkspaceFixture(
      "trailing-whitespace",
      "minimumReleaseAge: 10080\nblockExoticSubdeps: true\ntrustPolicy: no-downgrade   \n",
    );

    const diagnostics = checkPnpmHardening(projectDirectory);

    expect(diagnostics).toHaveLength(0);
  });

  it("recognises a trailing inline comment after the value", () => {
    const projectDirectory = writeWorkspaceFixture(
      "inline-comment",
      "minimumReleaseAge: 10080  # 7 days\nblockExoticSubdeps: true  # registry-only\ntrustPolicy: no-downgrade  # locked in\n",
    );

    const diagnostics = checkPnpmHardening(projectDirectory);

    expect(diagnostics).toHaveLength(0);
  });

  it("treats `blockExoticSubdeps: false` with an inline comment as a violation", () => {
    const projectDirectory = writeWorkspaceFixture(
      "exotic-with-comment",
      "minimumReleaseAge: 10080\nblockExoticSubdeps: false  # we depend on a local tarball\ntrustPolicy: no-downgrade\n",
    );

    const diagnostics = checkPnpmHardening(projectDirectory);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("blockExoticSubdeps");
  });

  it("does not crash on a workspace file containing only a multi-line list", () => {
    const projectDirectory = writeWorkspaceFixture(
      "list-only",
      "packages:\n  - apps/*\n  - packages/*\n",
    );

    const diagnostics = checkPnpmHardening(projectDirectory);

    expect(diagnostics).toHaveLength(2);
  });

  it("returns no diagnostics when only a non-pnpm package.json exists", () => {
    const projectDirectory = path.join(temporaryRoot, "yarn-only");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "yarn-only",
        packageManager: "yarn@4.3.1",
        dependencies: { react: "^19.0.0" },
      }),
    );

    const diagnostics = checkPnpmHardening(projectDirectory);

    expect(diagnostics).toHaveLength(0);
  });

  it("returns no diagnostics when package.json is malformed and no other pnpm signal exists", () => {
    const projectDirectory = path.join(temporaryRoot, "broken-package-json");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(path.join(projectDirectory, "package.json"), "{ not json");

    const diagnostics = checkPnpmHardening(projectDirectory);

    expect(diagnostics).toHaveLength(0);
  });

  it("returns no diagnostics for a missing project directory", () => {
    const diagnostics = checkPnpmHardening(path.join(temporaryRoot, "does-not-exist"));

    expect(diagnostics).toHaveLength(0);
  });

  it("parses CRLF line endings identically to LF", () => {
    const crlfWorkspaceContents =
      'packages:\r\n  - "packages/*"\r\n\r\nminimumReleaseAge: 10080\r\nblockExoticSubdeps: true\r\ntrustPolicy: no-downgrade\r\n';
    const projectDirectory = writeWorkspaceFixture("crlf-line-endings", crlfWorkspaceContents);

    const diagnostics = checkPnpmHardening(projectDirectory);

    expect(diagnostics).toHaveLength(0);
  });

  it("tolerates a UTF-8 BOM at the start of the file", () => {
    const bomWorkspaceContents =
      '\uFEFFpackages:\n  - "packages/*"\n\nminimumReleaseAge: 10080\nblockExoticSubdeps: true\ntrustPolicy: no-downgrade\n';
    const projectDirectory = writeWorkspaceFixture("bom-prefixed", bomWorkspaceContents);

    const diagnostics = checkPnpmHardening(projectDirectory);

    expect(diagnostics).toHaveLength(0);
  });

  it("applies YAML last-wins semantics when the same key appears twice", () => {
    const duplicateKeyContents =
      "minimumReleaseAge: 60\nblockExoticSubdeps: false\ntrustPolicy: any\n\nminimumReleaseAge: 10080\nblockExoticSubdeps: true\ntrustPolicy: no-downgrade\n";
    const projectDirectory = writeWorkspaceFixture("duplicate-keys", duplicateKeyContents);

    const diagnostics = checkPnpmHardening(projectDirectory);

    expect(diagnostics).toHaveLength(0);
  });

  it("flags `blockExoticSubdeps: False` (capitalised YAML 1.2 boolean) as a violation", () => {
    const projectDirectory = writeWorkspaceFixture(
      "exotic-capital-false",
      "minimumReleaseAge: 10080\nblockExoticSubdeps: False\ntrustPolicy: no-downgrade\n",
    );

    const diagnostics = checkPnpmHardening(projectDirectory);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("blockExoticSubdeps");
  });

  it("flags `blockExoticSubdeps: FALSE` (all-caps YAML 1.2 boolean) as a violation", () => {
    const projectDirectory = writeWorkspaceFixture(
      "exotic-allcaps-false",
      "minimumReleaseAge: 10080\nblockExoticSubdeps: FALSE\ntrustPolicy: no-downgrade\n",
    );

    const diagnostics = checkPnpmHardening(projectDirectory);

    expect(diagnostics).toHaveLength(1);
  });

  it("does NOT treat `no-downgrade#typo` as `no-downgrade` (no whitespace before #)", () => {
    const projectDirectory = writeWorkspaceFixture(
      "trust-policy-hash-typo",
      "minimumReleaseAge: 10080\nblockExoticSubdeps: true\ntrustPolicy: no-downgrade#typo\n",
    );

    const diagnostics = checkPnpmHardening(projectDirectory);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("no-downgrade#typo");
  });

  it("does not treat `#` inside a single-quoted string as a comment start", () => {
    const projectDirectory = writeWorkspaceFixture(
      "trust-policy-hash-in-quotes",
      "minimumReleaseAge: 10080\nblockExoticSubdeps: true\ntrustPolicy: 'no-downgrade # not a comment'\n",
    );

    const diagnostics = checkPnpmHardening(projectDirectory);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("no-downgrade # not a comment");
  });

  it("strips a real inline comment after whitespace from an unquoted scalar", () => {
    const projectDirectory = writeWorkspaceFixture(
      "trust-policy-hash-comment",
      "minimumReleaseAge: 10080\nblockExoticSubdeps: true\ntrustPolicy: no-downgrade #fixed policy\n",
    );

    const diagnostics = checkPnpmHardening(projectDirectory);

    expect(diagnostics).toHaveLength(0);
  });
});
