import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../src/project-analysis/analyze-project.js";
import { extractKarmaConfigPackageReferences } from "../src/project-analysis/utils/extract-karma-config-package-references.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const createProject = (files: Readonly<Record<string, string>>): string => {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-karma-config-"));
  temporaryDirectories.push(rootDirectory);
  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = path.join(rootDirectory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, source);
  }
  return fs.realpathSync(rootDirectory);
};

describe("Karma config dependencies", () => {
  it("credits packages selected through Karma semantic tokens", () => {
    const declaredPackageNames = new Set([
      "karma-babel-preprocessor",
      "karma-chai",
      "karma-chai-plugins",
      "karma-chrome-launcher",
      "karma-coverage",
      "karma-coveralls",
      "karma-firefox-launcher",
      "karma-mocha",
      "karma-mocha-reporter",
      "karma-phantomjs-launcher",
      "karma-sourcemap-loader",
      "karma-webpack",
    ]);

    const references = extractKarmaConfigPackageReferences(
      `
        let reporters;
        if (process.env.CI) reporters = ["coverage", "coveralls"];
        else reporters = ["mocha"];
        module.exports = config => config.set({
          frameworks: ["mocha", "chai", "sinon-chai"],
          browsers: ["ChromeHeadless", "Firefox", "PhantomJS"],
          reporters,
          preprocessors: { "src/**/*.js": ["babel", "webpack", "sourcemap"] },
        });
      `,
      declaredPackageNames,
    );

    expect(new Set(references)).toEqual(declaredPackageNames);
  });

  it("does not credit comments, unrelated strings, property keys, or undeclared packages", () => {
    const references = extractKarmaConfigPackageReferences(
      `
        // frameworks: ["mocha"]
        const documentation = "ChromeHeadless";
        module.exports = config => config.set({
          files: ["coverage", "karma-webpack"],
          preprocessors: { mocha: ["unknown"] },
          browsers: ["Safari"],
        });
      `,
      new Set(["karma-mocha", "karma-chrome-launcher", "karma-coverage", "karma-webpack"]),
    );

    expect(references).toEqual([]);
  });

  it("keeps semantically selected plugins out of unused dependency findings", async () => {
    const devDependencies = {
      karma: "1.0.0",
      "karma-chrome-launcher": "1.0.0",
      "karma-mocha": "1.0.0",
      "karma-webpack": "1.0.0",
      "unused-tool": "1.0.0",
    };
    const rootDirectory = createProject({
      "package.json": JSON.stringify({
        scripts: { test: "karma start" },
        devDependencies,
      }),
      "package-lock.json": JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": { devDependencies },
          ...Object.fromEntries(
            Object.entries(devDependencies).map(([dependencyName, version]) => [
              `node_modules/${dependencyName}`,
              { version },
            ]),
          ),
        },
      }),
      "src/index.ts": "console.log('application');",
      "karma.config.js": `
        module.exports = config => config.set({
          frameworks: ["mocha"],
          browsers: ["ChromeHeadless"],
          preprocessors: { "src/**/*.js": ["webpack"] },
        });
      `,
    });

    const result = await analyzeProject({ rootDirectory });
    const unusedPackageNames = result.unusedDependencies.map((dependency) => dependency.name);

    expect(unusedPackageNames).toEqual(["unused-tool"]);
  });
});
