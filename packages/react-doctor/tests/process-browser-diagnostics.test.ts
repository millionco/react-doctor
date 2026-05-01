import { describe, expect, it } from "vite-plus/test";
import { processBrowserDiagnostics } from "../src/adapters/browser/process-browser-diagnostics.js";
import type { Diagnostic, ReactDoctorConfig } from "../src/types.js";

const rootDirectory = "/virtual";

const sampleDiagnostic: Diagnostic = {
  filePath: "src/App.tsx",
  plugin: "react",
  rule: "no-danger",
  severity: "warning",
  message: "x",
  help: "",
  line: 1,
  column: 0,
  category: "Test",
};

describe("processBrowserDiagnostics", () => {
  it("uses caller score when provided", async () => {
    const overrideScore = { score: 42, label: "Custom" };
    const result = await processBrowserDiagnostics({
      rootDirectory,
      projectFiles: {},
      diagnostics: [sampleDiagnostic],
      score: overrideScore,
    });
    expect(result.score).toEqual(overrideScore);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("applies config ignore rules", async () => {
    const config: ReactDoctorConfig = {
      ignore: { rules: ["react/no-danger"] },
    };
    const result = await processBrowserDiagnostics({
      rootDirectory,
      projectFiles: {},
      diagnostics: [sampleDiagnostic],
      userConfig: config,
    });
    expect(result.diagnostics).toHaveLength(0);
  });

  it("strips inline suppressions from projectFiles", async () => {
    const result = await processBrowserDiagnostics({
      rootDirectory,
      projectFiles: {
        "src/App.tsx":
          "// react-doctor-disable-next-line react/no-danger\nexport const App = () => null\n",
      },
      diagnostics: [{ ...sampleDiagnostic, line: 2 }],
    });
    expect(result.diagnostics).toHaveLength(0);
  });
});
