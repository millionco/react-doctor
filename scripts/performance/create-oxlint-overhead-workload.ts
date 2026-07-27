import * as fs from "node:fs";
import * as path from "node:path";
import type { CreatedOxlintOverheadWorkload, OxlintOverheadWorkloadDefinition } from "./types.ts";

const buildSource = (
  workloadId: string,
  fileIndex: number,
  callExpressionsPerFile: number,
): string =>
  `${Array.from(
    { length: callExpressionsPerFile },
    (_, callExpressionIndex) => `safeCall("${workloadId}", ${fileIndex}, ${callExpressionIndex});`,
  ).join("\n")}\neval("benchmark");\n`;

export const createOxlintOverheadWorkload = (
  rootDirectory: string,
  definition: OxlintOverheadWorkloadDefinition,
): CreatedOxlintOverheadWorkload => {
  if (!Number.isSafeInteger(definition.sourceFileCount) || definition.sourceFileCount < 1) {
    throw new Error("Oxlint overhead source file count must be a positive integer");
  }
  if (
    !Number.isSafeInteger(definition.sourceDirectoryCount) ||
    definition.sourceDirectoryCount < 1 ||
    definition.sourceDirectoryCount > definition.sourceFileCount
  ) {
    throw new Error(
      "Oxlint overhead source directory count must be between one and the source file count",
    );
  }
  if (
    !Number.isSafeInteger(definition.callExpressionsPerFile) ||
    definition.callExpressionsPerFile < 1
  ) {
    throw new Error("Oxlint overhead call expression count must be a positive integer");
  }
  const sourceDirectory = path.join(rootDirectory, `workload-${definition.id}`);
  fs.mkdirSync(sourceDirectory, { recursive: true });
  let sourceByteCount = 0;
  for (let fileIndex = 0; fileIndex < definition.sourceFileCount; fileIndex += 1) {
    const nestedDirectory = path.join(
      sourceDirectory,
      `source-${fileIndex % definition.sourceDirectoryCount}`,
    );
    fs.mkdirSync(nestedDirectory, { recursive: true });
    const source = buildSource(definition.id, fileIndex, definition.callExpressionsPerFile);
    fs.writeFileSync(path.join(nestedDirectory, `file-${fileIndex}.ts`), source);
    sourceByteCount += Buffer.byteLength(source);
  }
  return {
    metadata: {
      ...definition,
      sourceByteCount,
      totalCallExpressionCount: definition.sourceFileCount * definition.callExpressionsPerFile,
    },
    sourceDirectory,
  };
};
