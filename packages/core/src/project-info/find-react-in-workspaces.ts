import * as path from "node:path";
import type { DependencyInfo, PackageJson } from "../types/index.js";
import { EMPTY_DEPENDENCY_INFO, extractDependencyInfo } from "./extract-dependency-info.js";
import { getDependencyDeclaration } from "./utils/get-dependency-declaration.js";
import { getWorkspacePatterns } from "./get-workspace-patterns.js";
import { parseReactMajor } from "./parse-react-major.js";
import { readPackageJson } from "./read-package-json.js";
import { resolveCatalogVersion } from "./resolve-catalog-version.js";
import { resolveWorkspaceDirectories } from "./resolve-workspace-directories.js";

interface ResolveWorkspaceDependencyVersionOptions {
  concreteVersion: string | null;
  packageName: string;
  rootDirectory: string;
  rootPackageJson: PackageJson;
  sections: ReadonlyArray<"dependencies" | "peerDependencies" | "devDependencies">;
  workspaceDirectory: string;
  workspacePackageJson: PackageJson;
}

const resolveWorkspaceDependencyVersion = ({
  concreteVersion,
  packageName,
  rootDirectory,
  rootPackageJson,
  sections,
  workspaceDirectory,
  workspacePackageJson,
}: ResolveWorkspaceDependencyVersionOptions): string | null => {
  const dependencyDeclaration = getDependencyDeclaration({
    packageJson: workspacePackageJson,
    packageName,
    sections,
  });
  if (!dependencyDeclaration.hasDeclaration) return null;

  return (
    concreteVersion ??
    resolveCatalogVersion(
      workspacePackageJson,
      packageName,
      workspaceDirectory,
      dependencyDeclaration.catalogReference,
    ) ??
    resolveCatalogVersion(
      rootPackageJson,
      packageName,
      rootDirectory,
      dependencyDeclaration.catalogReference,
    )
  );
};

const shouldReplaceReactVersion = (currentVersion: string | null, nextVersion: string): boolean => {
  if (!currentVersion) return true;

  const currentMajor = parseReactMajor(currentVersion);
  const nextMajor = parseReactMajor(nextVersion);

  if (currentMajor === null) return nextMajor !== null;
  if (nextMajor === null) return false;
  return nextMajor < currentMajor;
};

export const findReactInWorkspaces = (
  rootDirectory: string,
  packageJson: PackageJson,
): DependencyInfo => {
  const patterns = getWorkspacePatterns(rootDirectory, packageJson);
  const result: DependencyInfo = { ...EMPTY_DEPENDENCY_INFO };

  for (const pattern of patterns) {
    const directories = resolveWorkspaceDirectories(rootDirectory, pattern);

    for (const workspaceDirectory of directories) {
      const workspacePackageJson = readPackageJson(path.join(workspaceDirectory, "package.json"));
      const info = extractDependencyInfo(workspacePackageJson);
      const reactVersion = resolveWorkspaceDependencyVersion({
        concreteVersion: info.reactVersion,
        packageName: "react",
        rootDirectory,
        rootPackageJson: packageJson,
        sections: ["dependencies", "peerDependencies", "devDependencies"],
        workspaceDirectory,
        workspacePackageJson,
      });
      const tailwindVersion = resolveWorkspaceDependencyVersion({
        concreteVersion: info.tailwindVersion,
        packageName: "tailwindcss",
        rootDirectory,
        rootPackageJson: packageJson,
        sections: ["dependencies", "devDependencies", "peerDependencies"],
        workspaceDirectory,
        workspacePackageJson,
      });
      const zodVersion = resolveWorkspaceDependencyVersion({
        concreteVersion: info.zodVersion,
        packageName: "zod",
        rootDirectory,
        rootPackageJson: packageJson,
        sections: ["dependencies", "devDependencies", "peerDependencies"],
        workspaceDirectory,
        workspacePackageJson,
      });

      if (reactVersion && shouldReplaceReactVersion(result.reactVersion, reactVersion)) {
        result.reactVersion = reactVersion;
      }
      if (tailwindVersion && !result.tailwindVersion) {
        result.tailwindVersion = tailwindVersion;
      }
      if (zodVersion && !result.zodVersion) {
        result.zodVersion = zodVersion;
      }
      if (info.framework !== "unknown" && result.framework === "unknown") {
        result.framework = info.framework;
      }

      const resultReactMajor = parseReactMajor(result.reactVersion);
      if (
        result.reactVersion &&
        result.tailwindVersion &&
        result.framework !== "unknown" &&
        resultReactMajor !== null &&
        resultReactMajor <= 17
      ) {
        return result;
      }
    }
  }

  return result;
};
