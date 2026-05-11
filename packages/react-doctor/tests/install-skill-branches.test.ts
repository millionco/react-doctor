import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { SkillAgentType } from "agent-install";

const state = vi.hoisted(() => ({
  doesManifestExist: true,
  detectedAgents: ["cursor"] as SkillAgentType[],
  selectedAgents: ["cursor"] as SkillAgentType[],
  installSkills: [{ name: "react-doctor" }],
  failedInstalls: [] as { agent: SkillAgentType; error: string }[],
  installError: undefined as Error | undefined,
  spinnerFailures: [] as string[],
}));

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return {
    ...original,
    existsSync: () => state.doesManifestExist,
  };
});

vi.mock("agent-install", () => ({
  SKILL_MANIFEST_FILE: "SKILL.md",
  getSkillAgentConfig: (agent: SkillAgentType) => ({
    displayName: agent === "cursor" ? "Cursor" : agent,
  }),
  installSkillsFromSource: async () => {
    if (state.installError) throw state.installError;
    return {
      skills: state.installSkills,
      failed: state.failedInstalls,
    };
  },
}));

vi.mock("../src/utils/detect-agents.js", () => ({
  detectAvailableAgents: async () => state.detectedAgents,
}));

vi.mock("../src/utils/prompts.js", () => ({
  prompts: async () => ({ agents: state.selectedAgents }),
}));

vi.mock("../src/utils/spinner.js", () => ({
  spinner: () => ({
    start: () => ({
      succeed: () => {},
      fail: (message: string) => state.spinnerFailures.push(message),
    }),
  }),
}));

vi.mock("../src/utils/logger.js", () => ({
  logger: {
    error: () => {},
    dim: () => {},
    log: () => {},
  },
}));

const { runInstallSkill } = await import("../src/install-skill.js");

describe("runInstallSkill prompt and failure branches", () => {
  let originalIsTty: boolean | undefined;

  beforeEach(() => {
    state.doesManifestExist = true;
    state.detectedAgents = ["cursor"];
    state.selectedAgents = ["cursor"];
    state.installSkills = [{ name: "react-doctor" }];
    state.failedInstalls = [];
    state.installError = undefined;
    state.spinnerFailures = [];
    originalIsTty = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: originalIsTty });
    vi.restoreAllMocks();
  });

  it("uses bundled source, detects agents, and returns when prompt selects none", async () => {
    state.selectedAgents = [];

    await runInstallSkill({ projectRoot: "/project" });

    expect(state.spinnerFailures).toEqual([]);
  });

  it("throws failed install details from agent-install", async () => {
    state.failedInstalls = [{ agent: "cursor", error: "permission denied" }];

    await expect(runInstallSkill({ projectRoot: "/project" })).rejects.toThrow(
      "Cursor: permission denied",
    );
    expect(state.spinnerFailures).toEqual(["Failed to install react-doctor skill."]);
  });

  it("fails spinner and rethrows unexpected install errors", async () => {
    state.installError = new Error("disk full");

    await expect(runInstallSkill({ projectRoot: "/project" })).rejects.toThrow("disk full");
    expect(state.spinnerFailures).toEqual(["Failed to install react-doctor skill."]);
  });
});
