import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { defineProjectAnalysisConfig } from "../src/project-analysis/config.js";
import { detectStalePackages } from "../src/project-analysis/report/packages.js";
import type { DependencyGraph } from "../src/project-analysis/types.js";
import { isConfigFile } from "../src/project-analysis/utils/is-config-file.js";

const temporaryDirectories: string[] = [];

const emptyGraph: DependencyGraph = {
  modules: [],
  edges: [],
  reverseEdges: new Map(),
  fileIdMap: new Map(),
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const createProject = (
  files: Readonly<Record<string, string>>,
  dependencies: Readonly<Record<string, string>>,
  scripts: Readonly<Record<string, string>> = {},
): string => {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-packages-"));
  temporaryDirectories.push(rootDirectory);
  fs.writeFileSync(
    path.join(rootDirectory, "package.json"),
    JSON.stringify({ dependencies, scripts }),
  );
  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = path.join(rootDirectory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, source);
  }
  return fs.realpathSync(rootDirectory);
};

const collectUnusedDependencyNames = (rootDirectory: string): string[] =>
  detectStalePackages(emptyGraph, defineProjectAnalysisConfig({ rootDir: rootDirectory }))
    .unusedDependencies.map((dependency) => dependency.name)
    .sort();

describe("detectStalePackages", () => {
  it.each(["js", "ts", "mjs", "cjs"])(
    "credits Gatsby plugin strings in gatsby-config.%s",
    (extension) => {
      const rootDirectory = createProject(
        {
          [`gatsby-config.${extension}`]: `
            export default {
              plugins: [
                "gatsby-plugin-image",
                { resolve: "gatsby-source-filesystem" },
              ],
            };
          `,
        },
        {
          "gatsby-plugin-image": "1.0.0",
          "gatsby-source-filesystem": "1.0.0",
          "unused-package": "1.0.0",
        },
      );

      expect(isConfigFile(path.join(rootDirectory, `gatsby-config.${extension}`))).toBe(true);
      expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["unused-package"]);
    },
  );

  it("does not credit package names from comments or strings in unrelated files", () => {
    const rootDirectory = createProject(
      {
        "gatsby-config.txt": "gatsby-plugin-image",
        "src/notes.ts": `
          // gatsby-source-filesystem
          export const packageName = "gatsby-plugin-sharp";
        `,
      },
      {
        "gatsby-plugin-image": "1.0.0",
        "gatsby-plugin-sharp": "1.0.0",
        "gatsby-source-filesystem": "1.0.0",
      },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual([
      "gatsby-plugin-image",
      "gatsby-plugin-sharp",
      "gatsby-source-filesystem",
    ]);
  });

  it("credits package imports in statically linked build scripts", () => {
    const rootDirectory = createProject(
      {
        "build/build.js": `
          require("direct-build-package");
          require("./webpack.prod.conf");
        `,
        "build/webpack.prod.conf.js": `
          import plugin from "transitive-build-package";
          const baseConfig = { entry: { app: "./src/client" } };
          baseConfig.entry.app = ["./build/dev-client"].concat(baseConfig.entry.app);
          export default plugin;
        `,
        "build/dev-client.js": `require("webpack-entry-package");`,
        "src/client.js": `require("root-webpack-entry-package");`,
        "build/dormant.js": `require("dormant-build-package");`,
      },
      {
        "direct-build-package": "1.0.0",
        "transitive-build-package": "1.0.0",
        "webpack-entry-package": "1.0.0",
        "root-webpack-entry-package": "1.0.0",
        "dormant-build-package": "1.0.0",
      },
      { build: "node build/build.js" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["dormant-build-package"]);
  });

  it("does not follow dynamic build-script imports or package-name text", () => {
    const rootDirectory = createProject(
      {
        "build/build.js": `
          const packageName = "text-only-package";
          const configName = process.env.CONFIG;
          require("./" + configName);
          const config = { template: "./production" };
          console.log(packageName, config);
        `,
        "build/production.js": `require("dynamic-build-package");`,
      },
      {
        "text-only-package": "1.0.0",
        "dynamic-build-package": "1.0.0",
      },
      { build: "node build/build.js" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual([
      "dynamic-build-package",
      "text-only-package",
    ]);
  });

  it("credits Sass compiled from programmatic Parcel HTML entries", () => {
    const rootDirectory = createProject(
      {
        "src/build.js": `
          const Bundler = require("parcel-bundler");
          const entryFiles = path.join(__dirname, "./html/*.html");
          new Bundler(entryFiles, {});
        `,
        "src/html/index.html": '<link rel="stylesheet" href="../styles/app.scss">',
        "src/styles/app.scss": "$color: red;",
      },
      { "parcel-bundler": "1.0.0", sass: "1.0.0" },
      { build: "node src/build.js" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual([]);
  });

  it("does not credit Sass from an unconsumed Parcel HTML path", () => {
    const rootDirectory = createProject(
      {
        "src/build.js": `
          const Bundler = require("parcel-bundler");
          const dormantEntry = path.join(__dirname, "./html/*.html");
          console.log(Bundler, dormantEntry);
        `,
        "src/html/index.html": '<link rel="stylesheet" href="../styles/app.scss">',
        "src/styles/app.scss": "$color: red;",
      },
      { "parcel-bundler": "1.0.0", sass: "1.0.0" },
      { build: "node src/build.js" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["sass"]);
  });
});
