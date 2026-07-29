import { fileURLToPath } from "node:url";

/**
 * Resolves the absolute path to read for a diagnostic's `filePath`,
 * accounting for the various shapes oxlint emits:
 *
 * - `file://` URL — decode to an absolute filesystem path.
 * - Absolute POSIX (`/abs/path/file.tsx`) — pass through.
 * - Absolute Windows (`C:/...` or `C:\...`) — pass through.
 * - `./relative` or bare relative — join against `rootDirectory`.
 *
 * Shared between the streaming diagnostic pipeline and the legacy
 * array-shaped `mergeAndFilterDiagnostics` wrapper so file-line lookups
 * use one canonical resolution path.
 */
export const resolveCandidateReadPath = (rootDirectory: string, filePath: string): string => {
  if (filePath.startsWith("file://")) return fileURLToPath(filePath);

  const normalizedFile = filePath.replace(/\\/g, "/");
  if (
    normalizedFile.startsWith("/") ||
    /^[a-zA-Z]:\//.test(normalizedFile) ||
    /^[a-zA-Z]:\\/.test(filePath)
  ) {
    return filePath;
  }
  const root = rootDirectory.replace(/\\/g, "/").replace(/\/$/, "");
  return `${root}/${normalizedFile.replace(/^\.\//, "")}`;
};
