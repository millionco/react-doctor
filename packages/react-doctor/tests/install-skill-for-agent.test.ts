import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { toSkillDir } from "../src/utils/detect-agents.js";
import { installSkillForAgent } from "../src/utils/install-skill-for-agent.js";

const SKILL_NAME = "react-doctor";

describe("installSkillForAgent", () => {
  let workspaceRoot: string;
  let skillSourceDirectory: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(path.join(tmpdir(), "react-doctor-install-"));
    skillSourceDirectory = path.join(workspaceRoot, "source", SKILL_NAME);
    mkdirSync(skillSourceDirectory, { recursive: true });
    writeFileSync(path.join(skillSourceDirectory, "SKILL.md"), "# react-doctor skill\n");
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("copies the skill directory into the agent's skill folder", () => {
    const projectRoot = path.join(workspaceRoot, "project");
    mkdirSync(projectRoot, { recursive: true });

    const installedDirectory = installSkillForAgent(
      projectRoot,
      "claude",
      skillSourceDirectory,
      SKILL_NAME,
    );

    expect(installedDirectory).toBe(path.join(projectRoot, toSkillDir("claude"), SKILL_NAME));
    const installedSkillFile = path.join(installedDirectory, "SKILL.md");
    expect(existsSync(installedSkillFile)).toBe(true);
    expect(readFileSync(installedSkillFile, "utf8")).toBe("# react-doctor skill\n");
  });

  it("creates the skill directory tree when it does not yet exist", () => {
    const projectRoot = path.join(workspaceRoot, "fresh-project");
    mkdirSync(projectRoot, { recursive: true });

    installSkillForAgent(projectRoot, "copilot", skillSourceDirectory, SKILL_NAME);

    expect(existsSync(path.join(projectRoot, ".agents/skills/react-doctor/SKILL.md"))).toBe(true);
  });

  it("overwrites an existing skill installation", () => {
    const projectRoot = path.join(workspaceRoot, "stale-project");
    const staleSkillDirectory = path.join(projectRoot, toSkillDir("codex"), SKILL_NAME);
    mkdirSync(staleSkillDirectory, { recursive: true });
    writeFileSync(path.join(staleSkillDirectory, "SKILL.md"), "stale content");
    writeFileSync(path.join(staleSkillDirectory, "leftover.md"), "should be removed");

    installSkillForAgent(projectRoot, "codex", skillSourceDirectory, SKILL_NAME);

    expect(readFileSync(path.join(staleSkillDirectory, "SKILL.md"), "utf8")).toBe(
      "# react-doctor skill\n",
    );
    expect(existsSync(path.join(staleSkillDirectory, "leftover.md"))).toBe(false);
  });

  it("isolates installs across different agents", () => {
    const projectRoot = path.join(workspaceRoot, "multi-agent");
    mkdirSync(projectRoot, { recursive: true });

    installSkillForAgent(projectRoot, "claude", skillSourceDirectory, SKILL_NAME);
    installSkillForAgent(projectRoot, "cursor", skillSourceDirectory, SKILL_NAME);

    expect(existsSync(path.join(projectRoot, ".claude/skills/react-doctor/SKILL.md"))).toBe(true);
    expect(existsSync(path.join(projectRoot, ".agents/skills/react-doctor/SKILL.md"))).toBe(true);
  });

  it("shares a single .agents/skills install across agents that support the standard", () => {
    const projectRoot = path.join(workspaceRoot, "shared-agents-dir");
    mkdirSync(projectRoot, { recursive: true });

    const codexDirectory = installSkillForAgent(
      projectRoot,
      "codex",
      skillSourceDirectory,
      SKILL_NAME,
    );
    const cursorDirectory = installSkillForAgent(
      projectRoot,
      "cursor",
      skillSourceDirectory,
      SKILL_NAME,
      new Set([codexDirectory]),
    );

    expect(codexDirectory).toBe(path.join(projectRoot, ".agents/skills/react-doctor"));
    expect(cursorDirectory).toBe(codexDirectory);
    expect(existsSync(path.join(codexDirectory, "SKILL.md"))).toBe(true);
  });
});
