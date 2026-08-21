import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { parseOxlintOutput } from "../src/runners/oxlint/parse-output.js";
import { prepareLintSources } from "../src/utils/prepare-lint-sources.js";
import { buildProject } from "./helpers/oxlint-parse-harness.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

describe("HTML diagnostic mapping", () => {
  it("drops a code-less Astro diagnostic without crashing", () => {
    const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-astro-map-"));
    temporaryDirectories.push(rootDirectory);
    fs.mkdirSync(path.join(rootDirectory, "src"));
    fs.writeFileSync(path.join(rootDirectory, "src", "page.astro"), "<main>Hello</main>");
    const preparedSources = prepareLintSources(rootDirectory, path.join(rootDirectory, "tmp"), [
      "src/page.astro",
    ]);
    const lintPath = preparedSources.lintFiles.find((filePath) => filePath.endsWith(".tsx"));
    if (lintPath === undefined) throw new Error("Expected a virtual Astro lint source");
    const stdout = JSON.stringify({
      diagnostics: [
        {
          message: "Unexpected token",
          severity: "error",
          filename: lintPath,
          labels: [],
        },
      ],
      number_of_files: 1,
      number_of_rules: 1,
    });

    expect(
      parseOxlintOutput(
        stdout,
        buildProject({ rootDirectory }),
        rootDirectory,
        preparedSources.sourcePathByLintPath,
        preparedSources.sourceMapByLintPath,
      ),
    ).toEqual([]);
  });

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
    const preparedSources = prepareLintSources(rootDirectory, temporaryDirectory, ["index.html"]);
    expect(preparedSources.lintFiles).toHaveLength(1);
    const [lintPath] = preparedSources.lintFiles;
    if (lintPath === undefined) throw new Error("Expected a virtual HTML lint source");
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
    expect(lintBuffer.equals(Buffer.from(html))).toBe(true);
    expect(preparedSources.sizeByLintPath.get(lintPath)).toBe(Buffer.byteLength(html));
  });

  it("detects Three imports only in executable inline scripts", () => {
    const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-html-three-"));
    temporaryDirectories.push(rootDirectory);
    fs.writeFileSync(
      path.join(rootDirectory, "inert.html"),
      [
        '<p>import "three";</p>',
        '<!-- <script>import "three";</script> -->',
        '<script src="./main.js">import "three";</script>',
        '<script type="application/json">{"module":"three"}</script>',
        '<script type="x-shader/x-fragment">import "three";</script>',
        '<script type="module">import "other";</script>',
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(rootDirectory, "active.html"),
      '<script type="module">import "three";</script>',
    );

    const inertSources = prepareLintSources(rootDirectory, path.join(rootDirectory, "tmp-inert"), [
      "inert.html",
    ]);
    const activeSources = prepareLintSources(
      rootDirectory,
      path.join(rootDirectory, "tmp-active"),
      ["active.html"],
    );

    expect(inertSources.hasThreeModuleImport).toBe(false);
    expect(activeSources.hasThreeModuleImport).toBe(true);
  });
});
