import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { analyzeProjectForWorker as analyzeProject } from "../src/project-analysis/analyze-project.js";

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
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-issue-1665-"));
  temporaryDirectories.push(rootDirectory);
  fs.writeFileSync(path.join(rootDirectory, "package.json"), JSON.stringify(packageJson));
  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = path.join(rootDirectory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, source);
  }
  return fs.realpathSync(rootDirectory);
};

const unusedFilePaths = (
  rootDirectory: string,
  unusedFiles: ReadonlyArray<{ readonly path: string }>,
): string[] =>
  unusedFiles.map((unusedFile) =>
    path.relative(rootDirectory, unusedFile.path).replaceAll("\\", "/"),
  );

describe("issue #1665: implicit sub-project entries with workspace patterns", () => {
  it("should not report files as unused when implicit sub-project declares entry points", async () => {
    const rootDirectory = createProject(
      {
        "index.js": "console.log('root');",
        "packages/real/package.json": JSON.stringify({ name: "real", main: "index.js" }),
        "packages/real/index.js": "export const a = 1;",
        "sub/package.json": JSON.stringify({ name: "sub", main: "cli.js" }),
        "sub/cli.js": "const { helper } = require('./helper');\nconsole.log(helper());",
        "sub/helper.js": "module.exports.helper = () => 'hi';",
      },
      {
        name: "root",
        workspaces: ["packages/*"],
        main: "index.js",
      },
    );

    const result = await analyzeProject({ rootDirectory });

    const unused = unusedFilePaths(rootDirectory, result.unusedFiles);
    expect(unused).not.toContain("sub/cli.js");
    expect(unused).not.toContain("sub/helper.js");
  });

  it("should extract entries when no workspace patterns are declared", async () => {
    const rootDirectory = createProject(
      {
        "index.js": "console.log('root');",
        "sub/package.json": JSON.stringify({ name: "sub", main: "cli.js" }),
        "sub/cli.js": "const { helper } = require('./helper');\nconsole.log(helper());",
        "sub/helper.js": "module.exports.helper = () => 'hi';",
      },
      {
        name: "root",
        main: "index.js",
      },
    );

    const result = await analyzeProject({ rootDirectory });

    const unused = unusedFilePaths(rootDirectory, result.unusedFiles);
    expect(unused).not.toContain("sub/cli.js");
    expect(unused).not.toContain("sub/helper.js");
  });
});
