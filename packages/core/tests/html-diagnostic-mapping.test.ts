import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { parseOxlintOutput } from "../src/runners/oxlint/parse-output.js";
import { prepareHtmlLintSources } from "../src/utils/prepare-html-lint-sources.js";
import { buildProject } from "./helpers/oxlint-parse-harness.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

describe("HTML diagnostic mapping", () => {
  it("maps a virtual script diagnostic back to the HTML path and source position", () => {
    const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-html-map-"));
    temporaryDirectories.push(rootDirectory);
    const htmlPath = path.join(rootDirectory, "index.html");
    const html = [
      "<!doctype html>",
      '<main data-label="🙂"><script type="module">',
      "  debugger;",
      "</script></main>",
    ].join("\n");
    fs.writeFileSync(htmlPath, html);
    const temporaryDirectory = path.join(rootDirectory, "tmp");
    const preparedSources = prepareHtmlLintSources(rootDirectory, temporaryDirectory, [
      "index.html",
    ]);
    const [lintPath] = preparedSources.lintFiles;
    if (lintPath === undefined) throw new Error("Expected an extracted HTML script");
    const lintBuffer = fs.readFileSync(lintPath);
    const offset = lintBuffer.indexOf("debugger");
    const stdout = JSON.stringify({
      diagnostics: [
        {
          message: "Unexpected debugger statement",
          code: "eslint(no-debugger)",
          severity: "error",
          causes: [],
          url: "",
          help: "",
          filename: lintPath,
          labels: [{ label: "", span: { offset, length: 8, line: 3, column: 3 } }],
          related: [],
        },
      ],
      number_of_files: 1,
      number_of_rules: 1,
    });

    const [diagnostic] = parseOxlintOutput(
      stdout,
      buildProject({ rootDirectory }),
      rootDirectory,
      preparedSources.sourcePathByLintPath,
    );

    expect(diagnostic).toMatchObject({
      filePath: "index.html",
      line: 3,
      column: 3,
      offset,
      length: 8,
    });
  });
});
