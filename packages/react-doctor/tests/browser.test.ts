import { describe, expect, it, vi } from "vitest";
import { diagnoseBrowser } from "../src/browser.js";
import { buildDiagnoseResult } from "../src/core/build-diagnose-result.js";
import { calculateScoreLocally } from "../src/core/calculate-score-locally.js";
import { calculateScore as calculateScoreBrowser } from "../src/utils/calculate-score-browser.js";
import { calculateScore as calculateScoreNode } from "../src/utils/calculate-score-node.js";
import type { Diagnostic, ProjectInfo } from "../src/types.js";

const sampleProject: ProjectInfo = {
  rootDirectory: "/virtual",
  projectName: "demo",
  reactVersion: "19.0.0",
  framework: "vite",
  hasTypeScript: true,
  hasReactCompiler: false,
  sourceFileCount: 3,
};

const sampleDiagnostics: Diagnostic[] = [
  {
    filePath: "src/App.tsx",
    plugin: "react-doctor",
    rule: "example-rule",
    severity: "error",
    message: "Example",
    help: "",
    line: 1,
    column: 1,
    category: "performance",
  },
];

describe("browser entrypoint", () => {
  it("diagnoseBrowser returns buildDiagnoseResult-shaped output with local scoring when lint is off", async () => {
    const result = await diagnoseBrowser(
      {
        rootDirectory: "/virtual",
        project: sampleProject,
        projectFiles: {},
        runOxlint: async () => [],
      },
      { lint: false, deadCode: false },
    );

    const expectedScore = calculateScoreLocally([]);
    expect(result.score).toEqual(expectedScore);
    expect(result.diagnostics).toEqual([]);
    expect(result.project).toEqual(sampleProject);
    expect(result.elapsedMilliseconds).toBeGreaterThanOrEqual(0);
  });

  it("matches buildDiagnoseResult shaping for the same score", () => {
    const score = calculateScoreLocally(sampleDiagnostics);
    const fromBuilder = buildDiagnoseResult({
      diagnostics: sampleDiagnostics,
      project: sampleProject,
      elapsedMilliseconds: 0,
      score,
    });

    expect(fromBuilder.score).toEqual(score);
    expect(fromBuilder.diagnostics).toEqual(sampleDiagnostics);
    expect(fromBuilder.project).toEqual(sampleProject);
  });

  it("uses the same local score fallback as the Node scorer when the score API is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network unavailable");
      }),
    );

    try {
      const expected = calculateScoreLocally(sampleDiagnostics);
      const browserScore = await calculateScoreBrowser(sampleDiagnostics);
      const nodeScore = await calculateScoreNode(sampleDiagnostics);
      expect(browserScore).toEqual(expected);
      expect(nodeScore).toEqual(expected);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
