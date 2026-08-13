import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../src/project-analysis/analyze-project.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const createProject = (
  files: Readonly<Record<string, string>>,
  packageJson: Readonly<Record<string, unknown>> = {},
): string => {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-webpack-context-"));
  temporaryDirectories.push(rootDirectory);
  fs.writeFileSync(path.join(rootDirectory, "package.json"), JSON.stringify(packageJson));
  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = path.join(rootDirectory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, source);
  }
  return fs.realpathSync(rootDirectory);
};

const relativeUnusedPaths = (
  rootDirectory: string,
  unusedFiles: ReadonlyArray<{ readonly path: string }>,
): string[] =>
  unusedFiles.map((unusedFile) =>
    path.relative(rootDirectory, unusedFile.path).replaceAll("\\", "/"),
  );

describe("legacy Webpack registries", () => {
  it("resolves Vite alias-array entries", async () => {
    const rootDirectory = createProject(
      {
        "vite.config.ts": `
          import path from "node:path";
          export default {
            resolve: {
              alias: [{ find: "@", replacement: path.resolve(__dirname, "src") }],
            },
          };
        `,
        "src/index.ts": 'import { value } from "@/lib"; console.log(value);',
        "src/lib.ts": "export const value = 1; export const unused = 2;",
      },
      { devDependencies: { vite: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativeUnusedPaths(rootDirectory, result.unusedFiles)).not.toContain("src/lib.ts");
    expect(result.unusedExports.map((unusedExport) => unusedExport.name)).toEqual(["unused"]);
  });

  it("resolves aliases declared through local path helpers in build configs", async () => {
    const rootDirectory = createProject(
      {
        "build/webpack.base.conf.js": `
          const path = require("path");
          require("../config/settings");
          function resolve(directory) { return path.join(__dirname, "..", directory); }
          module.exports = {
            entry: { app: "./src/index.jsx" },
            resolve: { alias: { "@": resolve("src") } },
          };
        `,
        "src/index.jsx": `import routes from "./routes"; console.log(routes);`,
        "src/routes.jsx": `import Home from "@/views/Home"; export default Home;`,
        "src/views/Home.jsx": `import Card from "@/components/Card"; export default Card;`,
        "src/components/Card.jsx": "export default null;",
        "config/settings.js": "module.exports = {};",
        "src/orphan.jsx": "export default null;",
      },
      { devDependencies: { webpack: "2.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativeUnusedPaths(rootDirectory, result.unusedFiles)).toEqual(["src/orphan.jsx"]);
  });

  it("discovers Webpack entries assigned by invoked Gulp builds", async () => {
    const rootDirectory = createProject(
      {
        "gulpfile.js": `
          const webpack = require("webpack");
          const config = require("./webpack.config");
          config.entry = { app: "./js/index.jsx" };
          gulp.task("build", () => webpack(config));
        `,
        "webpack.config.js": "module.exports = {};",
        "js/index.jsx": `import Controller from "./controller"; export default Controller;`,
        "js/controller.jsx": "export default null;",
        "js/customize-preview.js": "export const preview = true;",
        "functions.php": `wp_enqueue_script(
          "theme-preview",
          get_template_directory_uri() . "/js/customize-preview.js",
          array("jquery")
        );`,
        "js/orphan.jsx": "export default null;",
      },
      {
        scripts: { build: "NODE_ENV=production gulp" },
        devDependencies: { gulp: "3.0.0", webpack: "1.0.0" },
      },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativeUnusedPaths(rootDirectory, result.unusedFiles)).toEqual(["js/orphan.jsx"]);
  });

  it("resolves ancestor modulesDirectories and applies the exact require.context filter", async () => {
    const rootDirectory = createProject(
      {
        "webpack/prod/webpack.config.js": `
          const commonResolve = { modulesDirectories: ["shared", "node_modules"] };
          module.exports = [
            { entry: { app: ["./lib/client/app.js"] }, resolve: commonResolve },
          ];
        `,
        "lib/client/app.js": 'import elements from "elements"; console.log(elements);',
        "lib/shared/elements/index.js": `
          const context = require.context(".", true, /^\\.\\/[a-z\\-]+?\\/index\\.(js|jsx)$/);
          export default context.keys();
        `,
        "lib/shared/elements/text-box/index.jsx": 'import "./detail"; export default null;',
        "lib/shared/elements/text-box/detail.js": "export const detail = true;",
        "lib/shared/elements/custom-card/index.js": "export default null;",
        "lib/shared/elements/not-matched/index.ts": "export default null;",
        "lib/shared/elements/nested/card/index.js": "export default null;",
        "shared/elements/index.js": "export default 'wrong root';",
      },
      { devDependencies: { webpack: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativeUnusedPaths(rootDirectory, result.unusedFiles)).toEqual([
      "lib/shared/elements/nested/card/index.js",
      "lib/shared/elements/not-matched/index.ts",
      "shared/elements/index.js",
    ]);
  });

  it("honors non-recursive contexts without widening their regex", async () => {
    const rootDirectory = createProject({
      "src/index.js": `require.context("./items", false, /^\\.\\/[^/]+\\.js$/);`,
      "src/items/direct.js": "export default null;",
      "src/items/direct.ts": "export default null;",
      "src/items/nested/child.js": "export default null;",
    });

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.js"] });

    expect(relativeUnusedPaths(rootDirectory, result.unusedFiles)).toEqual([
      "src/items/direct.ts",
      "src/items/nested/child.js",
    ]);
  });

  it("uses Webpack defaults when recursive and regex arguments are omitted", async () => {
    const rootDirectory = createProject({
      "src/index.js": `require.context("./items");`,
      "src/items/direct.js": "export default null;",
      "src/items/nested/child.js": "export default null;",
      "src/orphan.js": "export default null;",
    });

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.js"] });

    expect(relativeUnusedPaths(rootDirectory, result.unusedFiles)).toEqual(["src/orphan.js"]);
  });

  it("does not expand require.context calls with dynamic traversal arguments", async () => {
    const rootDirectory = createProject({
      "src/index.js": `
        const isRecursive = true;
        require.context("./items", isRecursive, /^\\.\\/[^/]+\\.js$/);
      `,
      "src/items/dormant.js": "export default null;",
    });

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.js"] });

    expect(relativeUnusedPaths(rootDirectory, result.unusedFiles)).toEqual([
      "src/items/dormant.js",
    ]);
  });
});
