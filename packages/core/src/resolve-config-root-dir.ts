import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import path from "node:path";
import { isDirectory } from "@react-doctor/project-info";
import type { ReactDoctorConfig } from "@react-doctor/types";

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

  if (!isDirectory(resolvedRootDir)) {
    Effect.runSync(
      Console.warn(
        `react-doctor config "rootDir" points to "${rawRootDir}" (resolved to ${resolvedRootDir}), which is not a directory. Ignoring.`,
      ),
    );
    return null;
  }

  return resolvedRootDir;
};
