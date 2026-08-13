import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import fg from "fast-glob";

const DOCUSAURUS_PACKAGE_NAMES = ["@docusaurus/core", "@docusaurus/preset-classic"];
const DOCUSAURUS_MARKDOWN_GLOBS = ["docs/**/*.md", "blog/**/*.md", "versioned_docs/**/*.md"];

export const collectExecutableMarkdownFilePaths = (
  rootDirectory: string,
  ignorePatterns: string[] = ["**/node_modules/**"],
): string[] => {
  const packageJsonPath = join(rootDirectory, "package.json");
  if (!existsSync(packageJsonPath)) return [];

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    const dependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
      ...packageJson.optionalDependencies,
    };
    if (!DOCUSAURUS_PACKAGE_NAMES.some((packageName) => packageName in dependencies)) return [];
    return fg.sync(DOCUSAURUS_MARKDOWN_GLOBS, {
      cwd: rootDirectory,
      absolute: true,
      onlyFiles: true,
      ignore: ignorePatterns,
    });
  } catch {
    return [];
  }
};
