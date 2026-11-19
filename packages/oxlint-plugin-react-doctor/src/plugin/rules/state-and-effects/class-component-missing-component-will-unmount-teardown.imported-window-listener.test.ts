import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { classComponentMissingComponentWillUnmountTeardown } from "./class-component-missing-component-will-unmount-teardown.js";

const RULE_ID = "class-component-missing-component-will-unmount-teardown";
const SOURCE = `import { Component } from "react";
import readWindow from "./receiver-window";

export class Panel extends Component {
  componentDidMount() { this.start(); }
  componentWillUnmount() { this.stop(); }

  start() {
    readWindow().addEventListener("resize", this.update);
    readWindow().addEventListener("scroll", this.update);
  }

  stop() {
    readWindow().removeEventListener("resize", this.update);
    readWindow().removeEventListener("scroll", this.update);
  }

  update = () => this.forceUpdate();

  render() { return null; }
}
`;

let directory: string;
let filename: string;

beforeEach(() => {
  resetFilesystemCaches();
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-class-window-listeners-"));
  filename = path.join(directory, "panel.tsx");
  fs.writeFileSync(path.join(directory, "receiver-window.ts"), "export default () => window;");
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
  resetFilesystemCaches();
});

const reportedLines = (sourceText: string) => {
  const result = runRule(classComponentMissingComponentWillUnmountTeardown, sourceText, {
    filename,
    includeLocations: true,
  });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics.map((diagnostic) => diagnostic.line);
};

describe("imported window listener teardown", () => {
  it("matches both removals through the same native window getter", () => {
    expect(reportedLines(SOURCE)).toEqual([]);
  });

  it("reports the second registration when only the first has cleanup", () => {
    expect(
      reportedLines(
        SOURCE.replace('    readWindow().removeEventListener("scroll", this.update);\n', ""),
      ),
    ).toEqual([10]);
  });

  it.each([
    SOURCE.replace(
      'removeEventListener("resize", this.update)',
      'removeEventListener("resize", this.update, true)',
    ),
    SOURCE.replace(
      "componentWillUnmount() { this.stop(); }",
      "componentWillUnmount() { mayThrow(); this.stop(); }",
    ),
    SOURCE.replace("  stop() {", "  stop() {\n    [this.update] = [replacement];"),
    SOURCE.replace("  stop() {", "  stop() {\n    delete this.update;"),
    SOURCE.replace(
      "  stop() {",
      "  stop() {\n    this.frame.ownerDocument.defaultView.removeEventListener = noop;",
    ),
    SOURCE.replace("  stop() {", "  stop() {\n    const key = pick(); this.frame[key] = noop;"),
  ])("reports an unproven cleanup", (sourceText) => {
    expect(reportedLines(sourceText)).toEqual([9]);
  });

  it("reads provider changes even when the component source is unchanged", () => {
    expect(reportedLines(SOURCE)).toEqual([]);
    fs.writeFileSync(
      path.join(directory, "receiver-window.ts"),
      "export default () => new EventTarget();",
    );
    expect(reportedLines(SOURCE)).toEqual([9]);
  });

  it("records content and the competing paths that can change resolution", () => {
    const input = { absoluteFilePath: filename, sourceText: SOURCE, ruleIds: [RULE_ID] };
    const provider = path.join(directory, "receiver-window.ts");
    const competing = path.join(directory, "receiver-window.js");
    const pathWithoutExtension = path.join(directory, "receiver-window");
    const trace = collectCrossFileDependencyProbes(input);
    expect(trace?.contentPaths.has(provider)).toBe(true);
    expect(trace?.existencePaths.has(competing)).toBe(true);
    expect(trace?.existencePaths.has(pathWithoutExtension)).toBe(true);

    fs.writeFileSync(competing, "export default () => new EventTarget();");
    resetFilesystemCaches();
    expect(reportedLines(SOURCE)).toEqual([9]);
    expect(collectCrossFileDependencyProbes(input)?.contentPaths.has(provider)).toBe(false);
  });
});
