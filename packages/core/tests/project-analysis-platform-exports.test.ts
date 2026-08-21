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
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-platform-exports-"));
  temporaryDirectories.push(rootDirectory);
  fs.writeFileSync(
    path.join(rootDirectory, "package.json"),
    JSON.stringify({ dependencies: { react: "1.0.0", "react-native": "1.0.0" } }),
  );
  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = path.join(rootDirectory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, source);
  }
  return fs.realpathSync(rootDirectory);
};

const platformSuffixes = ["", ".web", ".native", ".ios", ".android", ".rn"];

describe("platform sibling export usage", () => {
  it("credits only imported exports across React Native platform variants", async () => {
    const sourceFiles: Record<string, string> = {
      "src/index.ts": `
        import theme, { shared } from "./theme";
        import * as icons from "./icons";
        import { reExported } from "./public";
        console.log(theme, shared, icons.usedMember, reExported);
      `,
      "src/public.ts": `export { reExported } from "./re-exported";`,
    };

    for (const platformSuffix of platformSuffixes) {
      const variantName = platformSuffix || ".base";
      sourceFiles[`src/theme${platformSuffix}.ts`] = `
        export default "${variantName}";
        export const shared = "${variantName}";
        export const themeOnly = "${variantName}";
      `;
      sourceFiles[`src/icons${platformSuffix}.ts`] = `
        export const usedMember = "${variantName}";
        export const iconOnly = "${variantName}";
      `;
      sourceFiles[`src/re-exported${platformSuffix}.ts`] = `
        export const reExported = "${variantName}";
        export const reExportOnly = "${variantName}";
      `;
    }

    const rootDirectory = createProject(sourceFiles);
    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const findings = result.unusedExports.map((finding) => ({
      path: path.relative(rootDirectory, finding.path).replaceAll("\\", "/"),
      name: finding.name,
    }));

    expect(
      findings.filter((finding) =>
        ["default", "shared", "usedMember", "reExported"].includes(finding.name),
      ),
    ).toEqual([]);
    expect(findings).toHaveLength(platformSuffixes.length * 3);
    for (const platformSuffix of platformSuffixes) {
      expect(findings).toEqual(
        expect.arrayContaining([
          { path: `src/theme${platformSuffix}.ts`, name: "themeOnly" },
          { path: `src/icons${platformSuffix}.ts`, name: "iconOnly" },
          { path: `src/re-exported${platformSuffix}.ts`, name: "reExportOnly" },
        ]),
      );
    }
  });
});
