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
    const html = [
      "<!doctype html>",
      "<main>🙂</main>",
      '<script data-label="a > b" type="module">',
      '  import { WebGLRenderer } from "three";',
      "  const renderer = new WebGLRenderer();",
      "  renderer.setPixelRatio(window.devicePixelRatio);",
      "</script>",
      '<script type="module">',
      '  import * as THREE from "three";',
      "  const secondaryRenderer = new THREE.WebGLRenderer();",
      "  secondaryRenderer.setPixelRatio(window.devicePixelRatio);",
      "</script>",
    ].join("\n");
    fs.writeFileSync(path.join(rootDirectory, "index.html"), html);
    let coverage: RunOxlintFileCoverage | null = null;
    const progressUpdates: number[][] = [];

    const diagnostics = await runOxlint({
      rootDirectory,
      project: buildTestProject({ rootDirectory }),
      includePaths: ["index.html"],
      perFileLintCacheEnabled: false,
      onFileCoverage: (nextCoverage) => {
        coverage = nextCoverage;
      },
      onFileProgress: (scannedFileCount, totalFileCount) => {
        progressUpdates.push([scannedFileCount, totalFileCount]);
      },
    });

    const pixelRatioDiagnostics = diagnostics.filter(
      (diagnostic) => diagnostic.rule === "three-cap-device-pixel-ratio",
    );
    expect(pixelRatioDiagnostics).toHaveLength(2);
    expect(pixelRatioDiagnostics[0]).toMatchObject({
      filePath: "index.html",
      line: 6,
      offset: Buffer.from(html).indexOf("window.devicePixelRatio"),
    });
    expect(progressUpdates.at(-1)).toEqual([1, 1]);
    expect(progressUpdates.every(([, totalFileCount]) => totalFileCount === 1)).toBe(true);
    expect(coverage).toEqual({
      candidateFiles: ["index.html"],
      analyzedFiles: ["index.html"],
    });
  });

  it("skips non-executable script elements and still records complete coverage", async () => {
    fs.writeFileSync(
      path.join(rootDirectory, "index.html"),
      [
        '<script src="./main.js">',
        '  import { WebGLRenderer } from "three";',
        "  new WebGLRenderer().setPixelRatio(window.devicePixelRatio);",
        "</script>",
        '<script type="application/json">',
        '  import { WebGLRenderer } from "three";',
        "  new WebGLRenderer().setPixelRatio(window.devicePixelRatio);",
        "</script>",
        '<script type="importmap">{"imports": {"three": "./three.js"}}</script>',
        '<script type="x-shader/x-fragment">',
        '  import { WebGLRenderer } from "three";',
        "  new WebGLRenderer().setPixelRatio(window.devicePixelRatio);",
        "</script>",
        "<!--",
        '<script type="module">',
        '  import { WebGLRenderer } from "three";',
        "  new WebGLRenderer().setPixelRatio(window.devicePixelRatio);",
        "</script>",
        "-->",
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

  it("skips SSG frontmatter and inert template scripts", async () => {
    const html = [
      "---",
      "title: Three demo",
      'example: <script type="module">import "three";</script>',
      "---",
      "<template>",
      '  <script type="module">',
      '    import { WebGLRenderer } from "three";',
      "    new WebGLRenderer().setPixelRatio(window.devicePixelRatio);",
      "  </script>",
      "</template>",
      '<script type="module">',
      '  import { WebGLRenderer } from "three";',
      "  new WebGLRenderer().setPixelRatio(window.devicePixelRatio);",
      "</script>",
    ].join("\n");
    fs.writeFileSync(path.join(rootDirectory, "index.html"), html);

    const diagnostics = await runOxlint({
      rootDirectory,
      project: buildTestProject({ rootDirectory }),
      includePaths: ["index.html"],
      perFileLintCacheEnabled: false,
    });

    const pixelRatioDiagnostics = diagnostics.filter(
      (diagnostic) => diagnostic.rule === "three-cap-device-pixel-ratio",
    );
    expect(pixelRatioDiagnostics).toHaveLength(1);
    expect(pixelRatioDiagnostics[0]).toMatchObject({
      filePath: "index.html",
      line: 13,
      offset: Buffer.from(html).lastIndexOf("window.devicePixelRatio"),
    });
    expect(diagnostics.some((diagnostic) => diagnostic.rule === "parse-error")).toBe(false);
  });
});
