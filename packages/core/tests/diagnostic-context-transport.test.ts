import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { getDiagnosticContextPath } from "oxlint-plugin-react-doctor/core";
import type { DiagnosticContextRange } from "oxlint-plugin-react-doctor/core";
import { parseOxlintOutput } from "../src/runners/oxlint/parse-output.js";
import { buildProject, buildOxlintStdout } from "./helpers/oxlint-parse-harness.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

describe("oxlint ownership records", () => {
  it.each<[string, string | undefined, ReadonlyArray<DiagnosticContextRange> | undefined]>([
    ["valid", '[{"offset":0,"length":12}]', [{ offset: 0, length: 12 }]],
    ["corrupt", "{", undefined],
    ["invalid", '[{"offset":-1,"length":12}]', undefined],
    ["missing", undefined, undefined],
  ])(
    "reads %s records without changing the primary location",
    (_artifactState, contents, expectedRanges) => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-context-read-"));
      directories.push(directory);
      const message = "Missing dependency";
      const filename = path.join(directory, "src/components/widget.tsx");
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.writeFileSync(filename, "export const Widget = () => <div />;");
      const contextPath = getDiagnosticContextPath({
        directory,
        filename,
        rule: "exhaustive-deps",
        offset: 0,
        message,
      });
      if (contents !== undefined) fs.writeFileSync(contextPath, contents);
      const [diagnostic] = parseOxlintOutput(
        buildOxlintStdout("react-doctor(exhaustive-deps)", message),
        buildProject({ rootDirectory: directory }),
        directory,
        undefined,
        undefined,
        directory,
      );
      expect(diagnostic).toMatchObject({ line: 12, column: 3, offset: 0, length: 1, message });
      expect(diagnostic.contextRanges).toEqual(expectedRanges);
    },
  );

  it("uses the same record for a symlinked checkout", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-context-symlink-"));
    directories.push(directory);
    const filename = path.join(directory, "app.tsx");
    fs.writeFileSync(filename, "export const App = () => <div />;");
    const linkedDirectory = path.join(directory, "linked");
    fs.symlinkSync(directory, linkedDirectory, "junction");
    const identity = { directory, rule: "exhaustive-deps", offset: 0, message: "Finding" };
    expect(getDiagnosticContextPath({ ...identity, filename })).toBe(
      getDiagnosticContextPath({ ...identity, filename: path.join(linkedDirectory, "app.tsx") }),
    );
  });
});
