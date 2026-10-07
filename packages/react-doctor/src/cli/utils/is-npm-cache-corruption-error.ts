import { messageFromUnknown } from "@react-doctor/core";

interface ModuleNotFoundError extends Error {
  code: string;
  requireStack?: unknown;
}

interface NpmCacheCorruptionMatch {
  cacheKey: string;
  moduleNotFoundError: ModuleNotFoundError;
}

const MISSING_AJV_META_SCHEMA_MESSAGES = new Set([
  "Cannot find module './meta/unevaluated.json'",
  "Cannot find module './meta/validation.json'",
]);
const NPX_AJV_META_SCHEMA_REQUIRE_PATH_PATTERN =
  /(?:^|\/)_npx\/(?<cacheKey>[a-f0-9]{16})\/node_modules\/ajv\/dist\/refs\/json-schema-2020-12\/index\.js$/;

const isModuleNotFoundError = (error: unknown): error is ModuleNotFoundError =>
  error instanceof Error && "code" in error && error.code === "MODULE_NOT_FOUND";

const findNpmCacheCorruptionError = (error: unknown): NpmCacheCorruptionMatch | null => {
  const pendingErrors: unknown[] = [error];
  const visitedErrors = new Set<object>();

  while (pendingErrors.length > 0) {
    const currentError = pendingErrors.pop();
    if (typeof currentError !== "object" || currentError === null) continue;
    if (visitedErrors.has(currentError)) continue;
    visitedErrors.add(currentError);

    if (isModuleNotFoundError(currentError)) {
      const [message] = currentError.message.split("\n");
      if (message && MISSING_AJV_META_SCHEMA_MESSAGES.has(message)) {
        const requireStack = Array.isArray(currentError.requireStack)
          ? currentError.requireStack
          : [];
        for (const requirePath of requireStack) {
          if (typeof requirePath !== "string") continue;
          const match = requirePath
            .replaceAll("\\", "/")
            .match(NPX_AJV_META_SCHEMA_REQUIRE_PATH_PATTERN);
          const cacheKey = match?.groups?.cacheKey;
          if (cacheKey !== undefined) {
            return { cacheKey, moduleNotFoundError: currentError };
          }
        }
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
  const corruptionMatch = findNpmCacheCorruptionError(error);
  if (!corruptionMatch) return messageFromUnknown(error);

  return [
    "The npx cache has an incomplete Ajv installation.",
    "",
    "Remove this cache entry, then run React Doctor again:",
    `  npm cache npx rm ${corruptionMatch.cacheKey}`,
    "  npx react-doctor@latest",
    "",
    `Original error: ${corruptionMatch.moduleNotFoundError.message}`,
  ].join("\n");
};
