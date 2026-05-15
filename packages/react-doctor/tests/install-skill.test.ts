import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runInstallSkill } from "../src/cli/install-skill.js";
import { setLoggerSilent } from "@react-doctor/core";
import { setSpinnerSilent } from "../src/cli/spinner.js";

interface InstallSkillFixture {
  projectRoot: string;
  sourceDir: string;
  cleanup: () => void;
}

const setupFixture = (): InstallSkillFixture => {
  const root = mkdtempSync(path.join(tmpdir(), "react-doctor-install-skill-"));
  const projectRoot = path.join(root, "project");
  const sourceDir = path.join(root, "source");
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(sourceDir, { recursive: true });
  return {
    projectRoot,
    sourceDir,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
};

const writeValidSkill = (sourceDir: string): void => {
  writeFileSync(
    path.join(sourceDir, "SKILL.md"),
    "---\nname: react-doctor\ndescription: Test skill for install fixtures\n---\n# react-doctor\n",
  );
};

describe("runInstallSkill", () => {
  let fixture: InstallSkillFixture;
  let originalExitCode: number | string | undefined;

  beforeEach(() => {
    fixture = setupFixture();
    originalExitCode = process.exitCode;
    process.exitCode = 0;
    setLoggerSilent(true);
    setSpinnerSilent(true);
  });

  afterEach(() => {
    fixture.cleanup();
    process.exitCode = originalExitCode;
    setLoggerSilent(false);
    setSpinnerSilent(false);
  });

  it("exits with code 1 when the bundled SKILL.md is missing", async () => {
    await runInstallSkill({
      yes: true,
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      detectedAgents: ["cursor"],
    });
    expect(process.exitCode).toBe(1);
  });

  it("exits with code 1 when no agents are detected", async () => {
    writeValidSkill(fixture.sourceDir);
    await runInstallSkill({
      yes: true,
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      detectedAgents: [],
    });
    expect(process.exitCode).toBe(1);
    expect(existsSync(path.join(fixture.projectRoot, ".agents"))).toBe(false);
  });

  it("throws when SKILL.md exists but has no parseable frontmatter (H1 silent-success regression guard)", async () => {
    // HACK: agent-install's discoverSkills returns an empty array for
    // SKILL.md without `name:` / `description:` frontmatter. Before the
    // fix, our wrapper only checked `failed.length > 0` and reported
    // success even though zero files were written.
    writeFileSync(
      path.join(fixture.sourceDir, "SKILL.md"),
      "# Just a heading, no frontmatter\nNothing here.\n",
    );
    await expect(
      runInstallSkill({
        yes: true,
        sourceDir: fixture.sourceDir,
        projectRoot: fixture.projectRoot,
        detectedAgents: ["cursor"],
      }),
    ).rejects.toThrow(/Could not parse SKILL\.md/);
  });

  it("throws when frontmatter is missing the required `description` field (H1 regression guard)", async () => {
    writeFileSync(
      path.join(fixture.sourceDir, "SKILL.md"),
      "---\nname: react-doctor\n---\n# react-doctor\n",
    );
    await expect(
      runInstallSkill({
        yes: true,
        sourceDir: fixture.sourceDir,
        projectRoot: fixture.projectRoot,
        detectedAgents: ["cursor"],
      }),
    ).rejects.toThrow(/Could not parse SKILL\.md/);
  });

  it("--dry-run writes nothing, even with valid SKILL.md and detected agents", async () => {
    writeValidSkill(fixture.sourceDir);
    await runInstallSkill({
      yes: true,
      dryRun: true,
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      detectedAgents: ["cursor", "claude-code"],
    });
    expect(existsSync(path.join(fixture.projectRoot, ".agents"))).toBe(false);
    expect(existsSync(path.join(fixture.projectRoot, ".claude"))).toBe(false);
    expect(existsSync(path.join(fixture.projectRoot, ".factory"))).toBe(false);
  });

  it("installs the skill into the universal .agents/skills directory for a universal agent", async () => {
    writeValidSkill(fixture.sourceDir);
    await runInstallSkill({
      yes: true,
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      detectedAgents: ["cursor"],
    });
    expect(existsSync(path.join(fixture.projectRoot, ".agents/skills/react-doctor/SKILL.md"))).toBe(
      true,
    );
  });

  it("installs the skill into a vendor-specific directory for a non-universal agent", async () => {
    writeValidSkill(fixture.sourceDir);
    await runInstallSkill({
      yes: true,
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      detectedAgents: ["claude-code"],
    });
    expect(existsSync(path.join(fixture.projectRoot, ".claude/skills/react-doctor/SKILL.md"))).toBe(
      true,
    );
  });

  it("installs the skill into .factory/skills for the droid agent (upstream agent-install@0.0.3)", async () => {
    writeValidSkill(fixture.sourceDir);
    await runInstallSkill({
      yes: true,
      sourceDir: fixture.sourceDir,
      projectRoot: fixture.projectRoot,
      detectedAgents: ["droid"],
    });
    expect(
      existsSync(path.join(fixture.projectRoot, ".factory/skills/react-doctor/SKILL.md")),
    ).toBe(true);
  });
});
