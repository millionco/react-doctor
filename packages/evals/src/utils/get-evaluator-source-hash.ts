import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export interface GetEvaluatorSourceHashInput {
  sourceDirectory: string;
  packageManifestPath: string;
  lockfilePath: string;
}

const collectSourceFilePaths = (directory: string): ReadonlyArray<string> =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFilePaths(entryPath);
    return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : [];
  });

const defaultInput = (): GetEvaluatorSourceHashInput => {
  const sourceDirectory = fileURLToPath(new URL("..", import.meta.url));
  const packageDirectory = dirname(sourceDirectory);
  return {
    sourceDirectory,
    packageManifestPath: join(packageDirectory, "package.json"),
    lockfilePath: join(packageDirectory, "..", "..", "pnpm-lock.yaml"),
  };
};

export const getEvaluatorSourceHash = (
  input: GetEvaluatorSourceHashInput = defaultInput(),
): string => {
  const sourceFilePaths = collectSourceFilePaths(input.sourceDirectory);
  const fileEntries = [
    ...sourceFilePaths.map((filePath) => ({
      label: `src/${relative(input.sourceDirectory, filePath).replaceAll("\\", "/")}`,
      filePath,
    })),
    { label: "package.json", filePath: input.packageManifestPath },
    { label: "pnpm-lock.yaml", filePath: input.lockfilePath },
  ].sort((left, right) => left.label.localeCompare(right.label));
  const sourceHasher = createHash("sha256");
  for (const fileEntry of fileEntries) {
    sourceHasher.update(fileEntry.label);
    sourceHasher.update("\0");
    sourceHasher.update(readFileSync(fileEntry.filePath));
    sourceHasher.update("\0");
  }
  return sourceHasher.digest("hex");
};
