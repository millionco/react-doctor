import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type { RunOxlintFileCoverage } from "@react-doctor/core";
import { runOxlint } from "@react-doctor/core";
import { buildTestProject } from "../regressions/_helpers.js";

describe("runOxlint HTML support", () => {
  let rootDirectory: string;

  beforeEach(() => {
    rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-html-"));
  });

  afterEach(() => {
    fs.rmSync(rootDirectory, { recursive: true, force: true });
  });

  it("reports Three.js diagnostics from inline module scripts at HTML locations", async () => {
    fs.writeFileSync(
      path.join(rootDirectory, "index.html"),
      [
        "<!doctype html>",
        '<script type="module">',
        '  import { WebGLRenderer } from "three";',
        "  const renderer = new WebGLRenderer();",
        "  renderer.setPixelRatio(window.devicePixelRatio);",
        "</script>",
      ].join("\n"),
    );
    let coverage: RunOxlintFileCoverage | null = null;

    const diagnostics = await runOxlint({
      rootDirectory,
      project: buildTestProject({ rootDirectory }),
      includePaths: ["index.html"],
      perFileLintCacheEnabled: false,
      onFileCoverage: (nextCoverage) => {
        coverage = nextCoverage;
      },
    });

    expect(
      diagnostics.find((diagnostic) => diagnostic.rule === "three-cap-device-pixel-ratio"),
    ).toMatchObject({
      filePath: "index.html",
      line: 5,
    });
    expect(coverage).toEqual({
      candidateFiles: ["index.html"],
      analyzedFiles: ["index.html"],
    });
  });

  it("treats HTML without inline JavaScript as successfully analyzed", async () => {
    fs.writeFileSync(
      path.join(rootDirectory, "index.html"),
      [
        '<script src="./main.js"></script>',
        '<script type="importmap">{"imports": {}}</script>',
        '<script type="x-shader/x-fragment">void main() {}</script>',
      ].join("\n"),
    );
    let coverage: RunOxlintFileCoverage | null = null;

    const diagnostics = await runOxlint({
      rootDirectory,
      project: { ...buildTestProject({ rootDirectory }), hasThree: true },
      includePaths: ["index.html"],
      perFileLintCacheEnabled: false,
      onFileCoverage: (nextCoverage) => {
        coverage = nextCoverage;
      },
    });

    expect(diagnostics).toEqual([]);
    expect(coverage).toEqual({
      candidateFiles: ["index.html"],
      analyzedFiles: ["index.html"],
    });
  });
});
