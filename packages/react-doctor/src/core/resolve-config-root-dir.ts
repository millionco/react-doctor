import fs from "node:fs";
import path from "node:path";
import type { ReactDoctorConfig } from "../types/config.js";
import { logger } from "./logger.js";

export const resolveConfigRootDir = (
  config: ReactDoctorConfig | null,
  configSourceDirectory: string | null,
): string | null => {
  if (!config || !configSourceDirectory) return null;

  const rawRootDir = config.rootDir;
  if (typeof rawRootDir !== "string") return null;

  const trimmedRootDir = rawRootDir.trim();
  if (trimmedRootDir.length === 0) return null;

  const resolvedRootDir = path.isAbsolute(trimmedRootDir)
    ? trimmedRootDir
    : path.resolve(configSourceDirectory, trimmedRootDir);

  if (resolvedRootDir === configSourceDirectory) return null;

  if (!fs.existsSync(resolvedRootDir) || !fs.statSync(resolvedRootDir).isDirectory()) {
    logger.warn(
      `react-doctor config "rootDir" points to "${rawRootDir}" (resolved to ${resolvedRootDir}), which is not a directory. Ignoring.`,
    );
    return null;
  }

  return resolvedRootDir;
};
