import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { PACKAGE_JSON_FILENAME } from "../constants.js";
import type { RootValidationResult } from "../types.js";

export const validateRootDirectory = (root: string): RootValidationResult => {
  const resolvedPath = resolve(root);

  if (!existsSync(resolvedPath)) {
    return {
      isValid: false,
      resolvedPath,
      errorMessage: `Project root does not exist: ${resolvedPath}`,
      missingPackageJson: false,
    };
  }

  const fileStat = statSync(resolvedPath);
  if (!fileStat.isDirectory()) {
    return {
      isValid: false,
      resolvedPath,
      errorMessage: `Project root is not a directory: ${resolvedPath}`,
      missingPackageJson: false,
    };
  }

  const packageJsonPath = join(resolvedPath, PACKAGE_JSON_FILENAME);
  return {
    isValid: true,
    resolvedPath,
    missingPackageJson: !existsSync(packageJsonPath),
  };
};
