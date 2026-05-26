import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { checkInstallHardening } from "@react-doctor/core";

const FIXTURES_DIRECTORY = path.resolve(import.meta.dirname, "fixtures", "check-install-hardening");

const HARDENING_RULE_KEY = "require-install-hardening";

interface FixtureExpectation {
  readonly name: string;
  readonly description: string;
  readonly expectedRuleKeys: ReadonlyArray<string>;
  readonly expectedSubstrings: ReadonlyArray<string>;
  readonly expectedFilePath?: string;
}

const FIXTURE_EXPECTATIONS: ReadonlyArray<FixtureExpectation> = [
  {
    name: "hardened",
    description: "all three pnpm settings set to hardened values → no warnings",
    expectedRuleKeys: [],
    expectedSubstrings: [],
  },
  {
    name: "missing-all-settings",
    description:
      "pnpm-workspace.yaml present but lacks all three keys → warns on minimumReleaseAge + trustPolicy",
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
      "pnpm detected via `packageManager` field with no workspace yaml → warns on minimum-release-age + trust-policy via .npmrc",
    expectedRuleKeys: [HARDENING_RULE_KEY, HARDENING_RULE_KEY],
    expectedSubstrings: ["minimum-release-age", "trust-policy"],
    expectedFilePath: ".npmrc",
  },
  {
    name: "pnpm-lock-only",
    description:
      "pnpm-lock.yaml alone is enough to detect a pnpm project; warns on minimum-release-age + trust-policy via .npmrc",
    expectedRuleKeys: [HARDENING_RULE_KEY, HARDENING_RULE_KEY],
    expectedSubstrings: ["minimum-release-age", "trust-policy"],
    expectedFilePath: ".npmrc",
  },
  {
    name: "npmrc-hardened",
    description: "single-package pnpm project with all hardening settings in .npmrc → no warnings",
    expectedRuleKeys: [],
    expectedSubstrings: [],
    expectedFilePath: ".npmrc",
  },
  {
    name: "not-pnpm",
    description: "yarn project with yarn.lock but no .yarnrc.yml → warns on npmMinimalAgeGate",
    expectedRuleKeys: [HARDENING_RULE_KEY],
    expectedSubstrings: ["npmMinimalAgeGate"],
    expectedFilePath: ".yarnrc.yml",
  },
  {
    name: "npm-hardened",
    description: "npm project with min-release-age in .npmrc → no warnings",
    expectedRuleKeys: [],
    expectedSubstrings: [],
    expectedFilePath: ".npmrc",
  },
  {
    name: "npm-missing-age",
    description: "npm project without min-release-age → warns",
    expectedRuleKeys: [HARDENING_RULE_KEY],
    expectedSubstrings: ["min-release-age"],
    expectedFilePath: ".npmrc",
  },
  {
    name: "yarn-hardened",
    description: "yarn project with npmMinimalAgeGate in .yarnrc.yml → no warnings",
    expectedRuleKeys: [],
    expectedSubstrings: [],
    expectedFilePath: ".yarnrc.yml",
  },
  {
    name: "yarn-missing-age",
    description: "yarn project without npmMinimalAgeGate → warns",
    expectedRuleKeys: [HARDENING_RULE_KEY],
    expectedSubstrings: ["npmMinimalAgeGate"],
    expectedFilePath: ".yarnrc.yml",
  },
  {
    name: "bun-hardened",
    description: "bun project with minimumReleaseAge in bunfig.toml → no warnings",
    expectedRuleKeys: [],
    expectedSubstrings: [],
    expectedFilePath: "bunfig.toml",
  },
  {
    name: "bun-missing-age",
    description: "bun project without minimumReleaseAge → warns",
    expectedRuleKeys: [HARDENING_RULE_KEY],
    expectedSubstrings: ["minimumReleaseAge"],
    expectedFilePath: "bunfig.toml",
  },
  {
    name: "no-package-manager",
    description: "no lockfile or packageManager field → check is skipped entirely",
    expectedRuleKeys: [],
    expectedSubstrings: [],
  },
];

describe("checkInstallHardening (fixtures)", () => {
  for (const expectation of FIXTURE_EXPECTATIONS) {
    it(`${expectation.name}: ${expectation.description}`, () => {
      const fixtureDirectory = path.join(FIXTURES_DIRECTORY, expectation.name);
      const diagnostics = checkInstallHardening(fixtureDirectory);

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
        if (expectation.expectedFilePath !== undefined) {
          expect(diagnostic.filePath).toBe(expectation.expectedFilePath);
        }
        expect(diagnostic.help.length).toBeGreaterThan(0);
        expect(diagnostic.message.length).toBeGreaterThan(0);
      }
    });
  }

  it("reports the recommended 7-day (10080-minute) starting point in the help text for the missing-minimumReleaseAge diagnostic", () => {
    const diagnostics = checkInstallHardening(
      path.join(FIXTURES_DIRECTORY, "missing-all-settings"),
    );
    const minimumReleaseAgeDiagnostic = diagnostics.find((diagnostic) =>
      diagnostic.message.includes("minimumReleaseAge"),
    );
    expect(minimumReleaseAgeDiagnostic).toBeDefined();
    expect(minimumReleaseAgeDiagnostic?.help).toContain("10080");
    expect(minimumReleaseAgeDiagnostic?.help).toContain("7 days");
  });

  it("points at the actual line of `blockExoticSubdeps: false` when the key is present", () => {
    const diagnostics = checkInstallHardening(
      path.join(FIXTURES_DIRECTORY, "exotic-subdeps-allowed"),
    );
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
    const diagnostics = checkInstallHardening(
      path.join(FIXTURES_DIRECTORY, "trust-policy-weakened"),
    );
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
    const diagnostics = checkInstallHardening(
      path.join(FIXTURES_DIRECTORY, "missing-all-settings"),
    );
    for (const diagnostic of diagnostics) {
      expect(diagnostic.line).toBe(0);
      expect(diagnostic.column).toBe(0);
    }
  });
});

describe("checkInstallHardening (pnpm parser edge cases)", () => {
  let temporaryRoot: string;

  beforeEach(() => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-install-hardening-"));
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

    const diagnostics = checkInstallHardening(projectDirectory);

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

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(0);
  });

  it("recognises a trailing inline comment after the value", () => {
    const projectDirectory = writeWorkspaceFixture(
      "inline-comment",
      "minimumReleaseAge: 10080  # 7 days\nblockExoticSubdeps: true  # registry-only\ntrustPolicy: no-downgrade  # locked in\n",
    );

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(0);
  });

  it("treats `blockExoticSubdeps: false` with an inline comment as a violation", () => {
    const projectDirectory = writeWorkspaceFixture(
      "exotic-with-comment",
      "minimumReleaseAge: 10080\nblockExoticSubdeps: false  # we depend on a local tarball\ntrustPolicy: no-downgrade\n",
    );

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("blockExoticSubdeps");
  });

  it("does not crash on a workspace file containing only a multi-line list", () => {
    const projectDirectory = writeWorkspaceFixture(
      "list-only",
      "packages:\n  - apps/*\n  - packages/*\n",
    );

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(2);
  });

  it("returns no diagnostics when package.json is malformed and no other signal exists", () => {
    const projectDirectory = path.join(temporaryRoot, "broken-package-json");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(path.join(projectDirectory, "package.json"), "{ not json");

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(0);
  });

  it("returns no diagnostics for a missing project directory", () => {
    const diagnostics = checkInstallHardening(path.join(temporaryRoot, "does-not-exist"));

    expect(diagnostics).toHaveLength(0);
  });

  it("parses CRLF line endings identically to LF", () => {
    const crlfWorkspaceContents =
      'packages:\r\n  - "packages/*"\r\n\r\nminimumReleaseAge: 10080\r\nblockExoticSubdeps: true\r\ntrustPolicy: no-downgrade\r\n';
    const projectDirectory = writeWorkspaceFixture("crlf-line-endings", crlfWorkspaceContents);

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(0);
  });

  it("tolerates a UTF-8 BOM at the start of the file", () => {
    const bomWorkspaceContents =
      '\uFEFFpackages:\n  - "packages/*"\n\nminimumReleaseAge: 10080\nblockExoticSubdeps: true\ntrustPolicy: no-downgrade\n';
    const projectDirectory = writeWorkspaceFixture("bom-prefixed", bomWorkspaceContents);

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(0);
  });

  it("applies YAML last-wins semantics when the same key appears twice", () => {
    const duplicateKeyContents =
      "minimumReleaseAge: 60\nblockExoticSubdeps: false\ntrustPolicy: any\n\nminimumReleaseAge: 10080\nblockExoticSubdeps: true\ntrustPolicy: no-downgrade\n";
    const projectDirectory = writeWorkspaceFixture("duplicate-keys", duplicateKeyContents);

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(0);
  });

  it("flags `blockExoticSubdeps: False` (capitalised YAML 1.2 boolean) as a violation", () => {
    const projectDirectory = writeWorkspaceFixture(
      "exotic-capital-false",
      "minimumReleaseAge: 10080\nblockExoticSubdeps: False\ntrustPolicy: no-downgrade\n",
    );

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("blockExoticSubdeps");
  });

  it("flags `blockExoticSubdeps: FALSE` (all-caps YAML 1.2 boolean) as a violation", () => {
    const projectDirectory = writeWorkspaceFixture(
      "exotic-allcaps-false",
      "minimumReleaseAge: 10080\nblockExoticSubdeps: FALSE\ntrustPolicy: no-downgrade\n",
    );

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(1);
  });

  it("does NOT treat `no-downgrade#typo` as `no-downgrade` (no whitespace before #)", () => {
    const projectDirectory = writeWorkspaceFixture(
      "trust-policy-hash-typo",
      "minimumReleaseAge: 10080\nblockExoticSubdeps: true\ntrustPolicy: no-downgrade#typo\n",
    );

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("no-downgrade#typo");
  });

  it("does not treat `#` inside a single-quoted string as a comment start", () => {
    const projectDirectory = writeWorkspaceFixture(
      "trust-policy-hash-in-quotes",
      "minimumReleaseAge: 10080\nblockExoticSubdeps: true\ntrustPolicy: 'no-downgrade # not a comment'\n",
    );

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("no-downgrade # not a comment");
  });

  it("strips a real inline comment after whitespace from an unquoted scalar", () => {
    const projectDirectory = writeWorkspaceFixture(
      "trust-policy-hash-comment",
      "minimumReleaseAge: 10080\nblockExoticSubdeps: true\ntrustPolicy: no-downgrade #fixed policy\n",
    );

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(0);
  });
});

describe("checkInstallHardening (pnpm .npmrc fallback)", () => {
  let temporaryRoot: string;

  beforeEach(() => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-npmrc-hardening-"));
  });

  afterEach(() => {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  });

  const writePnpmNpmrcFixture = (caseName: string, npmrcContents: string): string => {
    const projectDirectory = path.join(temporaryRoot, caseName);
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(path.join(projectDirectory, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    fs.writeFileSync(path.join(projectDirectory, ".npmrc"), npmrcContents);
    return projectDirectory;
  };

  it("reads hardening settings from .npmrc when pnpm-workspace.yaml is absent", () => {
    const projectDirectory = writePnpmNpmrcFixture(
      "npmrc-all-set",
      "minimum-release-age=10080\nblock-exotic-subdeps=true\ntrust-policy=no-downgrade\n",
    );

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(0);
  });

  it("warns with .npmrc filePath when settings are missing from .npmrc", () => {
    const projectDirectory = writePnpmNpmrcFixture("npmrc-empty", "# nothing here\n");

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(2);
    for (const diagnostic of diagnostics) {
      expect(diagnostic.filePath).toBe(".npmrc");
    }
    const concatenatedMessages = diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(concatenatedMessages).toContain("minimum-release-age");
    expect(concatenatedMessages).toContain("trust-policy");
  });

  it("flags block-exotic-subdeps=false in .npmrc", () => {
    const projectDirectory = writePnpmNpmrcFixture(
      "npmrc-exotic-false",
      "minimum-release-age=10080\nblock-exotic-subdeps=false\ntrust-policy=no-downgrade\n",
    );

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].filePath).toBe(".npmrc");
    expect(diagnostics[0].message).toContain("block-exotic-subdeps");
  });

  it("flags a weakened trust-policy in .npmrc", () => {
    const projectDirectory = writePnpmNpmrcFixture(
      "npmrc-trust-any",
      "minimum-release-age=10080\nblock-exotic-subdeps=true\ntrust-policy=any\n",
    );

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].filePath).toBe(".npmrc");
    expect(diagnostics[0].message).toContain("trust-policy: any");
  });

  it("ignores .npmrc comment lines starting with # or ;", () => {
    const projectDirectory = writePnpmNpmrcFixture(
      "npmrc-comments",
      "# minimum-release-age=10080\n; block-exotic-subdeps=true\nminimum-release-age=10080\nblock-exotic-subdeps=true\ntrust-policy=no-downgrade\n",
    );

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(0);
  });

  it("strips trailing whitespace from .npmrc values", () => {
    const projectDirectory = writePnpmNpmrcFixture(
      "npmrc-trailing-ws",
      "minimum-release-age=10080   \nblock-exotic-subdeps=true   \ntrust-policy=no-downgrade   \n",
    );

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(0);
  });

  it("applies last-wins semantics for duplicate .npmrc keys", () => {
    const projectDirectory = writePnpmNpmrcFixture(
      "npmrc-duplicate",
      "trust-policy=any\nminimum-release-age=10080\nblock-exotic-subdeps=true\ntrust-policy=no-downgrade\n",
    );

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(0);
  });

  it("prefers pnpm-workspace.yaml over .npmrc when both exist", () => {
    const projectDirectory = path.join(temporaryRoot, "both-files");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(path.join(projectDirectory, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    fs.writeFileSync(
      path.join(projectDirectory, "pnpm-workspace.yaml"),
      "minimumReleaseAge: 10080\nblockExoticSubdeps: true\ntrustPolicy: no-downgrade\n",
    );
    fs.writeFileSync(path.join(projectDirectory, ".npmrc"), "# empty npmrc\n");

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(0);
  });

  it("reports .npmrc filePath when neither .npmrc nor pnpm-workspace.yaml exists", () => {
    const projectDirectory = path.join(temporaryRoot, "no-config-files");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(path.join(projectDirectory, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(2);
    for (const diagnostic of diagnostics) {
      expect(diagnostic.filePath).toBe(".npmrc");
    }
  });

  it("reports correct line numbers for .npmrc settings", () => {
    const projectDirectory = writePnpmNpmrcFixture(
      "npmrc-line-numbers",
      "# pnpm config\nminimum-release-age=10080\nblock-exotic-subdeps=false\ntrust-policy=no-downgrade\n",
    );

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].line).toBe(3);
    expect(diagnostics[0].column).toBe(1);
  });
});

describe("checkInstallHardening (npm)", () => {
  let temporaryRoot: string;

  beforeEach(() => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-npm-hardening-"));
  });

  afterEach(() => {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  });

  const writeNpmFixture = (caseName: string, npmrcContents?: string): string => {
    const projectDirectory = path.join(temporaryRoot, caseName);
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package-lock.json"),
      JSON.stringify({ lockfileVersion: 3 }),
    );
    if (npmrcContents !== undefined) {
      fs.writeFileSync(path.join(projectDirectory, ".npmrc"), npmrcContents);
    }
    return projectDirectory;
  };

  it("produces no warnings when min-release-age is set", () => {
    const projectDirectory = writeNpmFixture("hardened", "min-release-age=7\n");

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(0);
  });

  it("warns when min-release-age is missing", () => {
    const projectDirectory = writeNpmFixture("no-age", "# nothing\n");

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].filePath).toBe(".npmrc");
    expect(diagnostics[0].message).toContain("min-release-age");
    expect(diagnostics[0].help).toContain("min-release-age=7");
  });

  it("warns when .npmrc does not exist at all", () => {
    const projectDirectory = writeNpmFixture("no-npmrc");

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].filePath).toBe(".npmrc");
    expect(diagnostics[0].message).toContain("min-release-age");
  });

  it("does not produce pnpm-specific trustPolicy warnings for npm projects", () => {
    const projectDirectory = writeNpmFixture("npm-no-pnpm-extras");

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(1);
    const concatenatedMessages = diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(concatenatedMessages).not.toContain("trustPolicy");
    expect(concatenatedMessages).not.toContain("blockExoticSubdeps");
  });
});

describe("checkInstallHardening (yarn)", () => {
  let temporaryRoot: string;

  beforeEach(() => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-yarn-hardening-"));
  });

  afterEach(() => {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  });

  const writeYarnFixture = (caseName: string, yarnrcContents?: string): string => {
    const projectDirectory = path.join(temporaryRoot, caseName);
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({ name: caseName, packageManager: "yarn@4.10.0" }),
    );
    fs.writeFileSync(path.join(projectDirectory, "yarn.lock"), "__metadata:\n  version: 8\n");
    if (yarnrcContents !== undefined) {
      fs.writeFileSync(path.join(projectDirectory, ".yarnrc.yml"), yarnrcContents);
    }
    return projectDirectory;
  };

  it("produces no warnings when npmMinimalAgeGate is set", () => {
    const projectDirectory = writeYarnFixture("hardened", "npmMinimalAgeGate: 10080\n");

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(0);
  });

  it("warns when npmMinimalAgeGate is missing from .yarnrc.yml", () => {
    const projectDirectory = writeYarnFixture("no-age", "nodeLinker: node-modules\n");

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].filePath).toBe(".yarnrc.yml");
    expect(diagnostics[0].message).toContain("npmMinimalAgeGate");
    expect(diagnostics[0].help).toContain("npmMinimalAgeGate: 10080");
  });

  it("warns when .yarnrc.yml does not exist", () => {
    const projectDirectory = writeYarnFixture("no-yarnrc");

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].filePath).toBe(".yarnrc.yml");
  });

  it("does not produce pnpm-specific warnings for yarn projects", () => {
    const projectDirectory = writeYarnFixture("yarn-no-pnpm-extras");

    const diagnostics = checkInstallHardening(projectDirectory);

    const concatenatedMessages = diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(concatenatedMessages).not.toContain("trustPolicy");
    expect(concatenatedMessages).not.toContain("blockExoticSubdeps");
  });
});

describe("checkInstallHardening (bun)", () => {
  let temporaryRoot: string;

  beforeEach(() => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-bun-hardening-"));
  });

  afterEach(() => {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  });

  const writeBunFixture = (caseName: string, bunfigContents?: string): string => {
    const projectDirectory = path.join(temporaryRoot, caseName);
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "bun.lock"),
      JSON.stringify({ lockfileVersion: 0 }),
    );
    if (bunfigContents !== undefined) {
      fs.writeFileSync(path.join(projectDirectory, "bunfig.toml"), bunfigContents);
    }
    return projectDirectory;
  };

  it("produces no warnings when minimumReleaseAge is set in [install]", () => {
    const projectDirectory = writeBunFixture("hardened", "[install]\nminimumReleaseAge = 604800\n");

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(0);
  });

  it("warns when minimumReleaseAge is missing from bunfig.toml", () => {
    const projectDirectory = writeBunFixture("no-age", "[install]\n# nothing\n");

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].filePath).toBe("bunfig.toml");
    expect(diagnostics[0].message).toContain("minimumReleaseAge");
    expect(diagnostics[0].help).toContain("604800");
  });

  it("warns when bunfig.toml does not exist", () => {
    const projectDirectory = writeBunFixture("no-bunfig");

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].filePath).toBe("bunfig.toml");
  });

  it("ignores minimumReleaseAge outside [install] section", () => {
    const projectDirectory = writeBunFixture(
      "wrong-section",
      "minimumReleaseAge = 604800\n\n[install]\n# no age here\n",
    );

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("minimumReleaseAge");
  });

  it("handles bunfig.toml with inline comments", () => {
    const projectDirectory = writeBunFixture(
      "inline-comment",
      "[install]\nminimumReleaseAge = 604800 # 7 days\n",
    );

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(0);
  });

  it("detects bun via bun.lockb (binary lockfile)", () => {
    const projectDirectory = path.join(temporaryRoot, "bun-lockb");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(path.join(projectDirectory, "bun.lockb"), "binary content");

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].filePath).toBe("bunfig.toml");
  });
});

describe("checkInstallHardening (package manager detection)", () => {
  let temporaryRoot: string;

  beforeEach(() => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-pm-detection-"));
  });

  afterEach(() => {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  });

  it("detects npm via packageManager field", () => {
    const projectDirectory = path.join(temporaryRoot, "npm-via-field");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({ name: "npm-test", packageManager: "npm@11.10.0" }),
    );

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].filePath).toBe(".npmrc");
    expect(diagnostics[0].message).toContain("min-release-age");
  });

  it("detects bun via packageManager field", () => {
    const projectDirectory = path.join(temporaryRoot, "bun-via-field");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({ name: "bun-test", packageManager: "bun@1.2.0" }),
    );

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].filePath).toBe("bunfig.toml");
  });

  it("prefers packageManager field over lockfile heuristics", () => {
    const projectDirectory = path.join(temporaryRoot, "field-over-lock");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({ name: "conflict", packageManager: "yarn@4.10.0" }),
    );
    fs.writeFileSync(path.join(projectDirectory, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

    const diagnostics = checkInstallHardening(projectDirectory);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].filePath).toBe(".yarnrc.yml");
  });
});
