import { describe, expect, it } from "vitest";
import { diagnoseBrowser } from "../src/adapters/browser/diagnose-browser.js";
import type { Diagnostic, ProjectInfo } from "../src/types.js";

const minimalProject: ProjectInfo = {
  rootDirectory: "/virtual",
  projectName: "test-app",
  reactVersion: "18.0.0",
  framework: "vite",
  hasTypeScript: true,
  hasReactCompiler: false,
  sourceFileCount: 1,
};

const sampleDiagnostic: Diagnostic = {
  filePath: "src/App.tsx",
  plugin: "react",
  rule: "test-rule",
  severity: "warning",
  message: "example",
  help: "",
  line: 2,
  column: 0,
  category: "Test",
};

describe("diagnoseBrowser", () => {
  it("returns lint diagnostics when not suppressed", async () => {
    const result = await diagnoseBrowser(
      {
        rootDirectory: "/virtual",
        project: minimalProject,
        projectFiles: { "src/App.tsx": "export const App = () => null\n" },
        runOxlint: async () => [sampleDiagnostic],
      },
      { deadCode: false, lint: true, lintIncludePaths: ["src/App.tsx"] },
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].rule).toBe("test-rule");
    expect(result.score).not.toBeNull();
  });

  it("applies inline suppressions using projectFiles", async () => {
    const result = await diagnoseBrowser(
      {
        rootDirectory: "/virtual",
        project: minimalProject,
        projectFiles: {
          "src/App.tsx":
            "// react-doctor-disable-next-line react/test-rule\nexport const App = () => null\n",
        },
        runOxlint: async () => [sampleDiagnostic],
      },
      { deadCode: false, lint: true, lintIncludePaths: ["src/App.tsx"] },
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
