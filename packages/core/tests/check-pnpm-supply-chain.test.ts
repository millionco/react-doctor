import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { checkPnpmSupplyChain } from "@react-doctor/core";

const writeFile = (filePath: string, contents: string): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
};

const writeJson = (filePath: string, contents: unknown): void => {
  writeFile(filePath, JSON.stringify(contents, null, 2));
};

const HARDENED_WORKSPACE_YAML = `packages:
  - "packages/*"

minimumReleaseAge: 10080
blockExoticSubdeps: true
trustPolicy: no-downgrade
`;

describe("checkPnpmSupplyChain", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-pnpm-"));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const givenPnpmProject = (caseId: string): string => {
    const projectDirectory = path.join(tempRoot, caseId);
    fs.mkdirSync(projectDirectory, { recursive: true });
    writeJson(path.join(projectDirectory, "package.json"), {
      name: caseId,
      dependencies: { react: "^19.0.0" },
    });
    writeFile(path.join(projectDirectory, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    return projectDirectory;
  };

  it("returns no diagnostics when the project does not use pnpm", () => {
    const projectDirectory = path.join(tempRoot, "non-pnpm-project");
    fs.mkdirSync(projectDirectory, { recursive: true });
    writeJson(path.join(projectDirectory, "package.json"), {
      name: "non-pnpm-project",
      dependencies: { react: "^19.0.0" },
    });

    const diagnostics = checkPnpmSupplyChain(projectDirectory);

    expect(diagnostics).toHaveLength(0);
  });

  it("returns no diagnostics when pnpm-workspace.yaml has hardened supply-chain settings", () => {
    const projectDirectory = givenPnpmProject("hardened");
    writeFile(path.join(projectDirectory, "pnpm-workspace.yaml"), HARDENED_WORKSPACE_YAML);

    const diagnostics = checkPnpmSupplyChain(projectDirectory);

    expect(diagnostics).toHaveLength(0);
  });

  it("treats any custom minimumReleaseAge value as acceptable (does not error when below 7 days)", () => {
    const projectDirectory = givenPnpmProject("short-release-age");
    writeFile(
      path.join(projectDirectory, "pnpm-workspace.yaml"),
      `minimumReleaseAge: 1440\nblockExoticSubdeps: true\ntrustPolicy: no-downgrade\n`,
    );

    const diagnostics = checkPnpmSupplyChain(projectDirectory);

    expect(diagnostics).toHaveLength(0);
  });

  it("recommends a 7-day minimumReleaseAge when the key is missing", () => {
    const projectDirectory = givenPnpmProject("missing-release-age");
    writeFile(
      path.join(projectDirectory, "pnpm-workspace.yaml"),
      `blockExoticSubdeps: true\ntrustPolicy: no-downgrade\n`,
    );

    const diagnostics = checkPnpmSupplyChain(projectDirectory);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      rule: "require-pnpm-supply-chain-hardening",
      filePath: "pnpm-workspace.yaml",
      severity: "warning",
      category: "Security",
    });
    expect(diagnostics[0].help).toContain("10080");
  });

  it("flags blockExoticSubdeps: false but not blockExoticSubdeps: true or omission", () => {
    const blockingProject = givenPnpmProject("blocks-exotic");
    writeFile(
      path.join(blockingProject, "pnpm-workspace.yaml"),
      `minimumReleaseAge: 10080\nblockExoticSubdeps: true\ntrustPolicy: no-downgrade\n`,
    );
    expect(checkPnpmSupplyChain(blockingProject)).toHaveLength(0);

    const omittedProject = givenPnpmProject("omits-exotic");
    writeFile(
      path.join(omittedProject, "pnpm-workspace.yaml"),
      `minimumReleaseAge: 10080\ntrustPolicy: no-downgrade\n`,
    );
    expect(checkPnpmSupplyChain(omittedProject)).toHaveLength(0);

    const allowingProject = givenPnpmProject("allows-exotic");
    writeFile(
      path.join(allowingProject, "pnpm-workspace.yaml"),
      `minimumReleaseAge: 10080\nblockExoticSubdeps: false\ntrustPolicy: no-downgrade\n`,
    );
    const diagnostics = checkPnpmSupplyChain(allowingProject);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("blockExoticSubdeps");
  });

  it("flags a missing or non-no-downgrade trustPolicy", () => {
    const missingProject = givenPnpmProject("missing-trust");
    writeFile(
      path.join(missingProject, "pnpm-workspace.yaml"),
      `minimumReleaseAge: 10080\nblockExoticSubdeps: true\n`,
    );
    const missingDiagnostics = checkPnpmSupplyChain(missingProject);
    expect(missingDiagnostics).toHaveLength(1);
    expect(missingDiagnostics[0].message).toContain("trustPolicy");
    expect(missingDiagnostics[0].help).toContain("no-downgrade");

    const wrongValueProject = givenPnpmProject("wrong-trust");
    writeFile(
      path.join(wrongValueProject, "pnpm-workspace.yaml"),
      `minimumReleaseAge: 10080\nblockExoticSubdeps: true\ntrustPolicy: any\n`,
    );
    const wrongValueDiagnostics = checkPnpmSupplyChain(wrongValueProject);
    expect(wrongValueDiagnostics).toHaveLength(1);
    expect(wrongValueDiagnostics[0].message).toContain("`trustPolicy: any`");
  });

  it("emits diagnostics when pnpm-workspace.yaml is missing entirely", () => {
    const projectDirectory = givenPnpmProject("no-workspace-file");

    const diagnostics = checkPnpmSupplyChain(projectDirectory);

    expect(diagnostics).toHaveLength(2);
    const ruleKeys = new Set(diagnostics.map((diagnostic) => diagnostic.rule));
    expect(ruleKeys).toEqual(new Set(["require-pnpm-supply-chain-hardening"]));
    const messages = diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("minimumReleaseAge");
    expect(messages).toContain("trustPolicy");
  });

  it("detects pnpm via packageManager field when neither lockfile nor workspace exists", () => {
    const projectDirectory = path.join(tempRoot, "package-manager-only");
    fs.mkdirSync(projectDirectory, { recursive: true });
    writeJson(path.join(projectDirectory, "package.json"), {
      name: "package-manager-only",
      packageManager: "pnpm@10.29.1",
      dependencies: { react: "^19.0.0" },
    });

    const diagnostics = checkPnpmSupplyChain(projectDirectory);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].rule).toBe("require-pnpm-supply-chain-hardening");
  });

  it("reports accurate line numbers for diagnostics pointing at existing keys", () => {
    const projectDirectory = givenPnpmProject("with-line-numbers");
    const workspaceYaml = `# pnpm workspace

packages:
  - "packages/*"

minimumReleaseAge: 10080
blockExoticSubdeps: false
trustPolicy: any
`;
    writeFile(path.join(projectDirectory, "pnpm-workspace.yaml"), workspaceYaml);

    const diagnostics = checkPnpmSupplyChain(projectDirectory);

    const blockExoticDiagnostic = diagnostics.find((diagnostic) =>
      diagnostic.message.includes("blockExoticSubdeps"),
    );
    const trustPolicyDiagnostic = diagnostics.find((diagnostic) =>
      diagnostic.message.includes("`trustPolicy: any`"),
    );
    expect(blockExoticDiagnostic).toBeDefined();
    expect(trustPolicyDiagnostic).toBeDefined();
    expect(blockExoticDiagnostic?.line).toBe(7);
    expect(trustPolicyDiagnostic?.line).toBe(8);
  });

  it("ignores supply-chain keys nested inside other YAML blocks", () => {
    const projectDirectory = givenPnpmProject("nested-keys-ignored");
    const workspaceYaml = `packages:
  - "packages/*"

catalog:
  minimumReleaseAge: "1440"
  trustPolicy: "no-downgrade"
`;
    writeFile(path.join(projectDirectory, "pnpm-workspace.yaml"), workspaceYaml);

    const diagnostics = checkPnpmSupplyChain(projectDirectory);

    const ruleKeys = new Set(diagnostics.map((diagnostic) => diagnostic.rule));
    expect(ruleKeys).toEqual(new Set(["require-pnpm-supply-chain-hardening"]));
    expect(diagnostics.length).toBe(2);
    const messages = diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("minimumReleaseAge");
    expect(messages).toContain("trustPolicy");
  });

  it("strips inline comments and surrounding quotes when reading values", () => {
    const projectDirectory = givenPnpmProject("with-inline-comments");
    const workspaceYaml = `minimumReleaseAge: 1440  # 1 day starting point
blockExoticSubdeps: "true"  # explicit
trustPolicy: 'no-downgrade'  # locked in
`;
    writeFile(path.join(projectDirectory, "pnpm-workspace.yaml"), workspaceYaml);

    const diagnostics = checkPnpmSupplyChain(projectDirectory);

    expect(diagnostics).toHaveLength(0);
  });
});
