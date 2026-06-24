import fs from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * Map repo-root-relative changed-file paths (from `git diff --name-only` or the
 * GitHub `pulls.listFiles` API) to the SCAN-relative paths the CLI's
 * `--changed-files-from` expects. The CLI resolves changed-file entries relative
 * to the scanned `directory` (its diff detection runs `git diff --relative`), so
 * strip the `directory` prefix and drop files outside it — otherwise a
 * subdirectory scan (`directory: UI`) doubles up to `UI/UI/src/...`, misses every
 * base read, and reports pre-existing issues as newly introduced.
 *
 * Shared by the action's local-`git diff` path (the cheap default) and its
 * GitHub-API fallback so the two derive the same set from one implementation.
 *
 * @param {ReadonlyArray<string>} files repo-root-relative changed-file paths
 * @param {string | undefined} directory the scanned `directory` input
 * @returns {string[]} scan-relative paths
 */
export const normalizeChangedFiles = (files, directory) => {
  const directoryPrefix = String(directory ?? ".")
    .replace(/^\.\/?/, "")
    .replace(/\/$/, "");
  return files
    .map((file) => String(file).trim())
    .filter(Boolean)
    .flatMap((filename) => {
      if (!directoryPrefix) return [filename];
      const scopedPrefix = `${directoryPrefix}/`;
      return filename.startsWith(scopedPrefix) ? [filename.slice(scopedPrefix.length)] : [];
    });
};

// CLI: read newline-separated repo-root paths on stdin (from `git diff
// --name-only`), write the scan-relative set to argv[3] (or stdout). argv[2] is
// the scanned directory.
const main = () => {
  const directory = process.argv[2];
  const rawInput = fs.readFileSync(0, "utf8");
  const normalized = normalizeChangedFiles(rawInput.split("\n"), directory);
  const rendered = normalized.length > 0 ? `${normalized.join("\n")}\n` : "";
  const outputPath = process.argv[3];
  if (outputPath) {
    fs.writeFileSync(outputPath, rendered);
  } else {
    process.stdout.write(rendered);
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
