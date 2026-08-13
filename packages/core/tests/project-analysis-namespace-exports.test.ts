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

const createProject = (files: Readonly<Record<string, string>>): string => {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-namespace-exports-"));
  temporaryDirectories.push(rootDirectory);
  fs.writeFileSync(path.join(rootDirectory, "package.json"), "{}");
  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = path.join(rootDirectory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, source);
  }
  return fs.realpathSync(rootDirectory);
};

describe("namespace export usage", () => {
  it("preserves every member exposed through an entry-point namespace object", async () => {
    const rootDirectory = createProject({
      "src/index.ts": `
        import { REASONS } from "./reasons";
        import * as internal from "./internal";
        console.log(REASONS.open, internal.used);
      `,
      "src/reasons.ts": `
        import * as REASONS from "./reason-parts";
        export { REASONS };
      `,
      "src/reason-parts.ts": `
        export const open = "open";
        export const externallySelected = "externally-selected";
      `,
      "src/internal.ts": `
        export const used = true;
        export const stale = false;
      `,
      "src/public-api.ts": `export * as Library from "./library";`,
      "src/library.ts": `
        export const firstPublicMember = true;
        export const secondPublicMember = true;
      `,
    });

    const result = await analyzeProject({
      rootDirectory,
      entryPatterns: ["src/index.ts", "src/reasons.ts", "src/public-api.ts"],
    });
    const unusedExports = result.unusedExports.map((unusedExport) => ({
      path: path.relative(rootDirectory, unusedExport.path).replaceAll("\\", "/"),
      name: unusedExport.name,
    }));

    expect(unusedExports).toEqual([{ path: "src/internal.ts", name: "stale" }]);
  });

  it("does not credit named re-exports from unrelated namespace targets", async () => {
    const rootDirectory = createProject({
      "src/index.ts": `
        import { Library } from "./public-api";
        console.log(Library.firstPublicMember);
      `,
      "src/public-api.ts": `
        export * as Library from "./library";
        export { unrelatedPublicMember } from "./unrelated";
      `,
      "src/library.ts": `
        export const firstPublicMember = true;
        export const secondPublicMember = true;
      `,
      "src/unrelated.ts": `export const unrelatedPublicMember = true;`,
    });

    const result = await analyzeProject({
      rootDirectory,
      entryPatterns: ["src/index.ts"],
    });
    const unusedExports = result.unusedExports.map((unusedExport) => ({
      path: path.relative(rootDirectory, unusedExport.path).replaceAll("\\", "/"),
      name: unusedExport.name,
    }));

    expect(unusedExports).toEqual([{ path: "src/unrelated.ts", name: "unrelatedPublicMember" }]);
  });
});
