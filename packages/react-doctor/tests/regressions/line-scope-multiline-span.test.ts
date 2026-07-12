import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runOxlint } from "@react-doctor/core";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { buildTestProject, setupReactProject } from "./_helpers.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

describe("line-scoped multiline diagnostics", () => {
  it("carries the complete multiline button span into the parsed diagnostic", async () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-line-scope-"));
    temporaryDirectories.push(temporaryDirectory);
    const projectDirectory = setupReactProject(temporaryDirectory, "multiline-button", {
      files: {
        "src/App.tsx": [
          "export const App = () => (",
          "  <button",
          '    className="primary"',
          "    disabled",
          "  >",
          "    Save",
          "  </button>",
          ");",
        ].join("\n"),
      },
    });
    const diagnostics = await runOxlint({
      rootDirectory: projectDirectory,
      project: buildTestProject({ rootDirectory: projectDirectory }),
      userConfig: { rules: { "react-doctor/button-has-type": "error" } },
    });

    expect(diagnostics.find((diagnostic) => diagnostic.rule === "button-has-type")).toMatchObject({
      line: 2,
      endLine: 5,
    });
  });
});
