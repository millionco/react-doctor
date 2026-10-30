import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { parseOxlintOutput } from "../src/runners/oxlint/parse-output.js";
import { buildProject } from "./helpers/oxlint-parse-harness.js";

const temporaryDirectories: string[] = [];

const rawRegionDiagnostic = {
  message: "Check region",
  code: "react-doctor(region-has-accessible-name)",
  severity: "warning",
  causes: [],
  url: "https://example.com/span",
  help: "Keep span stable",
  related: [],
};

const expectedRegionDiagnostic = {
  plugin: "react-doctor",
  rule: "region-has-accessible-name",
  severity: "warning",
  title: "Region has no naming attribute",
  message: "Check region",
  help: "Keep span stable",
  url: "https://example.com/span",
  category: "Accessibility",
  matchByOccurrence: true,
};

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

  it("preserves complete unmapped attribute spans and supplied related coordinates", () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-span-"));
    temporaryDirectories.push(temporaryDirectory);
    const filename = path.join(temporaryDirectory, "App.tsx");
    const source = "// 🦄 café\r\nconst region = 'name';\r\n";
    fs.writeFileSync(filename, source);
    const offset = Buffer.byteLength(source.slice(0, source.indexOf("region")));
    const stdout = JSON.stringify({
      diagnostics: [
        {
          ...rawRegionDiagnostic,
          filename,
          labels: [
            { label: "", span: { offset, length: 6, line: 2, column: 7 } },
            { label: "external coordinate", span: { offset: 0, length: 2, line: 17, column: 9 } },
          ],
        },
      ],
      number_of_files: 1,
      number_of_rules: 1,
    });
    const diagnostics = parseOxlintOutput(
      stdout,
      buildProject({ rootDirectory: temporaryDirectory }),
      temporaryDirectory,
    );
    expect(diagnostics).toEqual([
      {
        ...expectedRegionDiagnostic,
        filePath: filename.replaceAll("\\", "/"),
        line: 2,
        column: 7,
        offset,
        length: 6,
        endLine: 2,
        relatedLocations: [
          {
            filePath: filename.replaceAll("\\", "/"),
            line: 17,
            column: 9,
            offset: 0,
            length: 2,
            message: "external coordinate",
          },
        ],
      },
    ]);
  });

  it("preserves mapped primary, end and related lines for unordered Unicode CRLF spans", () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-span-"));
    temporaryDirectories.push(temporaryDirectory);
    const filename = path.join(temporaryDirectory, "App.tsx");
    const virtualFilename = path.join(temporaryDirectory, "shadow.tsx");
    const source = '// 🦄 café\r\n<section role="region">\r\n  😀tail\r\n</section>\r\n';
    fs.writeFileSync(filename, source);
    const regionOffset = Buffer.byteLength(source.slice(0, source.indexOf("role=")));
    const tailOffset = Buffer.byteLength(source.slice(0, source.indexOf("tail")));
    const regionLength = tailOffset + Buffer.byteLength("tail") - regionOffset;
    const stdout = JSON.stringify({
      diagnostics: [
        {
          ...rawRegionDiagnostic,
          filename: virtualFilename,
          labels: [
            { label: "", span: { offset: tailOffset, length: 4, line: 99, column: 99 } },
            {
              label: "region source",
              span: { offset: regionOffset, length: 13, line: 99, column: 99 },
            },
          ],
        },
        {
          ...rawRegionDiagnostic,
          filename: virtualFilename,
          labels: [
            {
              label: "",
              span: { offset: regionOffset, length: regionLength, line: 99, column: 99 },
            },
            { label: "tail source", span: { offset: tailOffset, length: 4, line: 99, column: 99 } },
          ],
        },
      ],
      number_of_files: 1,
      number_of_rules: 1,
    });
    const diagnostics = parseOxlintOutput(
      stdout,
      buildProject({ rootDirectory: temporaryDirectory }),
      temporaryDirectory,
      new Map([[path.normalize(virtualFilename), filename]]),
    );
    const normalizedFilename = filename.replaceAll("\\", "/");
    expect(diagnostics).toEqual([
      {
        ...expectedRegionDiagnostic,
        filePath: normalizedFilename,
        line: 3,
        column: 5,
        offset: tailOffset,
        length: 4,
        endLine: 3,
        relatedLocations: [
          {
            filePath: normalizedFilename,
            line: 2,
            column: 10,
            offset: regionOffset,
            length: 13,
            message: "region source",
          },
        ],
      },
      {
        ...expectedRegionDiagnostic,
        filePath: normalizedFilename,
        line: 2,
        column: 10,
        offset: regionOffset,
        length: regionLength,
        endLine: 3,
        relatedLocations: [
          {
            filePath: normalizedFilename,
            line: 3,
            column: 5,
            offset: tailOffset,
            length: 4,
            message: "tail source",
          },
        ],
      },
    ]);
  });

  it("refreshes a changed source buffer in a new parser invocation", () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-span-"));
    temporaryDirectories.push(temporaryDirectory);
    const filename = path.join(temporaryDirectory, "App.tsx");
    const virtualFilename = path.join(temporaryDirectory, "shadow.tsx");
    const sourcePathByLintPath = new Map([[path.normalize(virtualFilename), filename]]);
    const project = buildProject({ rootDirectory: temporaryDirectory });
    const stdout = JSON.stringify({
      diagnostics: [
        {
          ...rawRegionDiagnostic,
          filename: virtualFilename,
          labels: [{ label: "", span: { offset: 2, length: 1, line: 99, column: 99 } }],
        },
      ],
      number_of_files: 1,
      number_of_rules: 1,
    });
    fs.writeFileSync(filename, "a\nbb");
    expect(parseOxlintOutput(stdout, project, temporaryDirectory, sourcePathByLintPath)).toEqual([
      {
        ...expectedRegionDiagnostic,
        filePath: filename.replaceAll("\\", "/"),
        line: 2,
        column: 1,
        offset: 2,
        length: 1,
        endLine: 2,
      },
    ]);
    fs.writeFileSync(filename, "\n\nbb");
    expect(parseOxlintOutput(stdout, project, temporaryDirectory, sourcePathByLintPath)).toEqual([
      {
        ...expectedRegionDiagnostic,
        filePath: filename.replaceAll("\\", "/"),
        line: 3,
        column: 1,
        offset: 2,
        length: 1,
        endLine: 3,
      },
    ]);
  });
});
