import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { KNIP_TOTAL_ATTEMPTS } from "../src/constants.js";
import { runKnip } from "../src/core/run-knip.js";

interface CapturedKnipOptions {
  cwd: string;
  workspace?: string;
}

interface MockKnipState {
  capturedKnipCalls: CapturedKnipOptions[];
  parsedConfig: Record<string, unknown>;
  mainCallCount: number;
  mainImplementation: (() => Promise<unknown>) | null;
}

const EMPTY_KNIP_RESULT = {
  issues: {
    files: new Set<string>(),
    dependencies: {},
    devDependencies: {},
    unlisted: {},
    exports: {},
    types: {},
    duplicates: {},
  },
  counters: {},
};

const mockKnipState = vi.hoisted<MockKnipState>(() => ({
  capturedKnipCalls: [],
  parsedConfig: {},
  mainCallCount: 0,
  mainImplementation: null,
}));

vi.mock("knip", () => ({
  main: async () => {
    mockKnipState.mainCallCount += 1;
    if (mockKnipState.mainImplementation) {
      return mockKnipState.mainImplementation();
    }
    return EMPTY_KNIP_RESULT;
  },
}));

vi.mock("knip/session", () => ({
  createOptions: async (options: { cwd: string; workspace?: string }) => {
    mockKnipState.capturedKnipCalls.push({ cwd: options.cwd, workspace: options.workspace });
    return { parsedConfig: mockKnipState.parsedConfig };
  },
}));

const resetMockKnipState = (): void => {
  mockKnipState.capturedKnipCalls.length = 0;
  mockKnipState.parsedConfig = {};
  mockKnipState.mainCallCount = 0;
  mockKnipState.mainImplementation = null;
};

const writeJson = (filePath: string, contents: unknown): void => {
  fs.writeFileSync(filePath, JSON.stringify(contents));
};

const createMonorepoFixture = (
  workspaceLocalKnipConfig: boolean,
  rootKnipConfig: boolean,
): { monorepoRoot: string; workspaceDirectory: string } => {
  const monorepoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "run-knip-monorepo-"));
  fs.writeFileSync(path.join(monorepoRoot, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n');
  writeJson(path.join(monorepoRoot, "package.json"), { name: "monorepo", private: true });
  fs.mkdirSync(path.join(monorepoRoot, "node_modules"));

  if (rootKnipConfig) {
    writeJson(path.join(monorepoRoot, "knip.json"), {});
  }

  const workspaceDirectory = path.join(monorepoRoot, "packages", "foo");
  fs.mkdirSync(workspaceDirectory, { recursive: true });
  writeJson(path.join(workspaceDirectory, "package.json"), { name: "foo" });

  if (workspaceLocalKnipConfig) {
    writeJson(path.join(workspaceDirectory, "knip.json"), {});
  }

  return { monorepoRoot, workspaceDirectory };
};

describe("runKnip", () => {
  let monorepoFixtureRoot: string | null = null;

  beforeEach(() => {
    resetMockKnipState();
    monorepoFixtureRoot = null;
  });

  afterEach(() => {
    if (monorepoFixtureRoot) {
      fs.rmSync(monorepoFixtureRoot, { recursive: true, force: true });
    }
  });

  it("runs knip from the workspace directory when the workspace owns a knip config", async () => {
    const fixture = createMonorepoFixture(true, false);
    monorepoFixtureRoot = fixture.monorepoRoot;

    await runKnip(fixture.workspaceDirectory);

    expect(mockKnipState.capturedKnipCalls).toHaveLength(1);
    expect(mockKnipState.capturedKnipCalls[0].cwd).toBe(fixture.workspaceDirectory);
    expect(mockKnipState.capturedKnipCalls[0].workspace).toBeUndefined();
  });

  it("prefers workspace-local config even when a root knip config exists", async () => {
    const fixture = createMonorepoFixture(true, true);
    monorepoFixtureRoot = fixture.monorepoRoot;

    await runKnip(fixture.workspaceDirectory);

    expect(mockKnipState.capturedKnipCalls).toHaveLength(1);
    expect(mockKnipState.capturedKnipCalls[0].cwd).toBe(fixture.workspaceDirectory);
  });

  it("runs knip from the monorepo root with --workspace when no workspace-local config exists", async () => {
    const fixture = createMonorepoFixture(false, true);
    monorepoFixtureRoot = fixture.monorepoRoot;

    await runKnip(fixture.workspaceDirectory);

    expect(mockKnipState.capturedKnipCalls).toHaveLength(1);
    expect(mockKnipState.capturedKnipCalls[0].cwd).toBe(fixture.monorepoRoot);
    expect(mockKnipState.capturedKnipCalls[0].workspace).toBe("foo");
  });

  it("returns no diagnostics when dependencies are not installed", async () => {
    const standaloneRoot = fs.mkdtempSync(path.join(os.tmpdir(), "run-knip-standalone-"));
    try {
      writeJson(path.join(standaloneRoot, "package.json"), { name: "standalone" });

      const diagnostics = await runKnip(standaloneRoot);

      expect(diagnostics).toEqual([]);
      expect(mockKnipState.capturedKnipCalls).toHaveLength(0);
    } finally {
      fs.rmSync(standaloneRoot, { recursive: true, force: true });
    }
  });

  describe("retry behavior on plugin failures", () => {
    let standaloneRoot: string;

    beforeEach(() => {
      standaloneRoot = fs.mkdtempSync(path.join(os.tmpdir(), "run-knip-retry-"));
      writeJson(path.join(standaloneRoot, "package.json"), { name: "standalone" });
      fs.mkdirSync(path.join(standaloneRoot, "node_modules"));
    });

    afterEach(() => {
      fs.rmSync(standaloneRoot, { recursive: true, force: true });
    });

    it("disables a recognized plugin and succeeds on retry", async () => {
      mockKnipState.parsedConfig = { vite: true, next: true };
      let attemptCount = 0;
      mockKnipState.mainImplementation = async () => {
        attemptCount += 1;
        if (attemptCount === 1) {
          throw new Error("Error loading /repo/vite.config.ts", {
            cause: new Error("Cannot find module './missing'"),
          });
        }
        return EMPTY_KNIP_RESULT;
      };

      const diagnostics = await runKnip(standaloneRoot);

      expect(diagnostics).toEqual([]);
      expect(mockKnipState.mainCallCount).toBe(2);
      expect(mockKnipState.parsedConfig.vite).toBe(false);
      expect(mockKnipState.parsedConfig.next).toBe(true);
    });

    it("ignores plugin names that are not part of the knip config", async () => {
      mockKnipState.parsedConfig = { next: true };
      const error = new Error("Error loading /repo/local.config.json");
      mockKnipState.mainImplementation = async () => {
        throw error;
      };

      await expect(runKnip(standaloneRoot)).rejects.toBe(error);

      expect(mockKnipState.mainCallCount).toBe(1);
      expect(mockKnipState.parsedConfig.next).toBe(true);
    });

    it("only disables each plugin once even if the same error repeats", async () => {
      mockKnipState.parsedConfig = { vite: true };
      const error = new Error("Error loading /repo/vite.config.ts");
      mockKnipState.mainImplementation = async () => {
        throw error;
      };

      await expect(runKnip(standaloneRoot)).rejects.toBe(error);

      expect(mockKnipState.mainCallCount).toBe(2);
      expect(mockKnipState.parsedConfig.vite).toBe(false);
    });

    it("rethrows the original error when no plugin can be extracted", async () => {
      const error = new Error("Knip exploded");
      mockKnipState.mainImplementation = async () => {
        throw error;
      };

      await expect(runKnip(standaloneRoot)).rejects.toBe(error);

      expect(mockKnipState.mainCallCount).toBe(1);
    });

    it("strips empty pattern strings from parsedConfig before calling knip (issue #149)", async () => {
      mockKnipState.parsedConfig = {
        entry: ["src/index.ts", "", "src/main.ts"],
        ignore: "",
        vite: { config: ["", "vite.config.ts"] },
      };

      await runKnip(standaloneRoot);

      expect(mockKnipState.parsedConfig).toEqual({
        entry: ["src/index.ts", "src/main.ts"],
        vite: { config: ["vite.config.ts"] },
      });
      expect(mockKnipState.mainCallCount).toBe(1);
    });

    it("rethrows the most recent error after exhausting retries instead of `Unreachable`", async () => {
      const sequencedErrors = [
        new Error("Error loading /repo/vite.config.ts"),
        new Error("Error loading /repo/next.config.ts"),
        new Error("Error loading /repo/jest.config.ts"),
        new Error("Error loading /repo/tailwind.config.ts"),
        new Error("Error loading /repo/playwright.config.ts"),
        new Error("Error loading /repo/cypress.config.ts"),
      ];
      mockKnipState.parsedConfig = {
        vite: true,
        next: true,
        jest: true,
        tailwind: true,
        playwright: true,
        cypress: true,
      };
      let attemptIndex = 0;
      mockKnipState.mainImplementation = async () => {
        const sequencedError = sequencedErrors[attemptIndex];
        attemptIndex += 1;
        throw sequencedError;
      };

      const lastSequencedError = sequencedErrors[sequencedErrors.length - 1];
      await expect(runKnip(standaloneRoot)).rejects.toBe(lastSequencedError);
      expect(mockKnipState.mainCallCount).toBe(KNIP_TOTAL_ATTEMPTS);
    });
  });
});
