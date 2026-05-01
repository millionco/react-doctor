import { describe, expect, it } from "vite-plus/test";
import { diagnose } from "../src/adapters/browser/diagnose.js";
import type { Diagnostic, ProjectInfo } from "../src/types.js";

const minimalProject: ProjectInfo = {
  rootDirectory: "/virtual",
  projectName: "app",
  reactVersion: "18.0.0",
  framework: "unknown",
  hasTypeScript: false,
  hasReactCompiler: false,
  hasTanStackQuery: false,
  sourceFileCount: 0,
};

const lintIssue: Diagnostic = {
  filePath: "a.tsx",
  plugin: "react",
  rule: "x",
  severity: "warning",
  message: "m",
  help: "",
  line: 1,
  column: 0,
  category: "Test",
};

describe("browser diagnose", () => {
  it("merges lint and optional dead-code diagnostics and shapes result like Node diagnose", async () => {
    const deadIssue: Diagnostic = {
      ...lintIssue,
      filePath: "b.tsx",
      plugin: "knip",
      rule: "files",
    };
    const result = await diagnose({
      rootDirectory: "/virtual",
      project: minimalProject,
      projectFiles: {},
      lintDiagnostics: [lintIssue],
      deadCodeDiagnostics: [deadIssue],
    });
    expect(result.project).toEqual(minimalProject);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.score).not.toBeNull();
    expect(result.elapsedMilliseconds).toBeGreaterThanOrEqual(0);
  });

  it("rejects project without reactVersion", async () => {
    await expect(
      diagnose({
        rootDirectory: "/virtual",
        project: { ...minimalProject, reactVersion: null },
        projectFiles: {},
        lintDiagnostics: [],
      }),
    ).rejects.toThrow(/No React dependency/);
  });
});
