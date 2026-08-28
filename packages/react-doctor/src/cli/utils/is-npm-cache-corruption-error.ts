import { messageFromUnknown } from "@react-doctor/core";

interface ModuleNotFoundError extends Error {
  code: string;
  requireStack?: string[];
}

const isModuleNotFoundError = (error: unknown): error is ModuleNotFoundError =>
  error instanceof Error &&
  "code" in error &&
  error.code === "MODULE_NOT_FOUND";

const findNpmCacheCorruptionError = (error: unknown): ModuleNotFoundError | null => {
  const pendingErrors: unknown[] = [error];
  const visitedErrors = new Set<object>();

  while (pendingErrors.length > 0) {
    const currentError = pendingErrors.pop();
    if (typeof currentError !== "object" || currentError === null) continue;
    if (visitedErrors.has(currentError)) continue;
    visitedErrors.add(currentError);

    if (isModuleNotFoundError(currentError)) {
      const message = currentError.message;
      const requireStack = currentError.requireStack ?? [];
      const allPaths = [message, ...requireStack].join(" ");

      const isNpxCache = allPaths.includes("_npx") || allPaths.includes("npx");
      const normalizedPaths = allPaths.replaceAll("\\", "/");
      const isConfOrAjv = normalizedPaths.includes("/ajv/") || normalizedPaths.includes("/conf/");

      if (isNpxCache && isConfOrAjv) {
        return currentError;
      }
    }

    if (currentError instanceof Error && currentError.cause !== undefined) {
      pendingErrors.push(currentError.cause);
    }
  }

  return null;
};

export const isNpmCacheCorruptionError = (error: unknown): boolean =>
  findNpmCacheCorruptionError(error) !== null;

export const formatNpmCacheCorruptionError = (error: unknown): string => {
  const moduleError = findNpmCacheCorruptionError(error);
  if (!moduleError) return messageFromUnknown(error);

  const platform = process.platform;
  const clearCacheCommand =
    platform === "win32"
      ? 'rd /s /q "%LOCALAPPDATA%\\npm-cache\\_npx"'
      : "rm -rf ~/.npm/_npx";

  return [
    "The npx cache has an incomplete installation. This is a known issue with npm 12 + Node 26.",
    "",
    "To fix, clear the npx cache and try again:",
    `  ${clearCacheCommand}`,
    "  npm cache clean --force",
    "",
    "Or use an alternative package manager:",
    "  bunx react-doctor@latest",
    "  pnpm dlx react-doctor@latest",
    "",
    `Original error: ${moduleError.message}`,
  ].join("\n");
};
