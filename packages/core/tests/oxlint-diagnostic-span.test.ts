import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { parseOxlintOutput } from "../src/runners/oxlint/parse-output.js";
import { buildProject } from "./helpers/oxlint-parse-harness.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

describe("parseOxlintOutput primary spans", () => {
  it("derives the inclusive end line from an oxlint UTF-8 byte span", () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-span-"));
    temporaryDirectories.push(temporaryDirectory);
    const filename = path.join(temporaryDirectory, "App.tsx");
    const source = [
      "export const App = () => (",
      "  <button",
      '    className="primary"',
      "    disabled",
      "  >Save</button>",
      ");",
    ].join("\n");
    fs.writeFileSync(filename, source);
    const spanStart = Buffer.byteLength(source.slice(0, source.indexOf("<button")));
    const spanEnd = Buffer.byteLength(source.slice(0, source.indexOf(">Save") + 1));
    const stdout = JSON.stringify({
      diagnostics: [
        {
          message: "Button is missing an explicit type",
          code: "react-doctor(button-has-type)",
          severity: "error",
          causes: [],
          url: "",
          help: "",
          filename,
          labels: [
            {
              label: "",
              span: {
                offset: spanStart,
                length: spanEnd - spanStart,
                line: 2,
                column: 3,
              },
            },
          ],
          related: [],
        },
      ],
      number_of_files: 1,
      number_of_rules: 1,
    });

    const [diagnostic] = parseOxlintOutput(
      stdout,
      buildProject({ rootDirectory: temporaryDirectory }),
      temporaryDirectory,
    );

    expect(diagnostic).toMatchObject({ line: 2, endLine: 5, offset: spanStart });
  });
});
