import { existsSync, readFileSync } from "node:fs";
import fg from "fast-glob";
import { findMonorepoRoot } from "../utils/find-monorepo-root.js";

const MUI_DOCS_INFRA_PACKAGE = "@mui/internal-docs-infra";
const MUI_DOCS_METADATA_PATTERN = "**/*{DataAttributes,CssVars}.{ts,tsx}";

const packageJsonHasMuiDocsInfra = (packageJsonPath: string): boolean => {
  if (!existsSync(packageJsonPath)) return false;
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    return Boolean(
      packageJson.dependencies?.[MUI_DOCS_INFRA_PACKAGE] ??
      packageJson.devDependencies?.[MUI_DOCS_INFRA_PACKAGE] ??
      packageJson.optionalDependencies?.[MUI_DOCS_INFRA_PACKAGE],
    );
  } catch {
    return false;
  }
};

export const extractMuiDocsMetadataEntries = (projectRoot: string): string[] => {
  const monorepoRoot = findMonorepoRoot(projectRoot);
  const dependencySearchRoot = monorepoRoot ?? projectRoot;
  const hasMuiDocsInfra = fg
    .sync(["package.json", "**/package.json"], {
      cwd: dependencySearchRoot,
      absolute: true,
      onlyFiles: true,
      ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
    })
    .some(packageJsonHasMuiDocsInfra);
  if (!hasMuiDocsInfra) return [];
  return fg.sync(MUI_DOCS_METADATA_PATTERN, {
    cwd: projectRoot,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
  });
};
