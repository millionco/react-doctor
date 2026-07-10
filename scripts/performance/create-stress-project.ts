import * as fs from "node:fs";
import * as path from "node:path";
import { buildStressSourceFile } from "./build-stress-source-file.ts";
import {
  STRESS_FILE_INDEX_CHARACTER_COUNT,
  STRESS_SUPPORT_SOURCE_FILE_COUNT,
  STRESS_VALUE_MODULUS,
} from "./constants.ts";
import type { CreateStressProjectInput, StressProjectMetadata } from "./types.ts";

export const createStressProject = (input: CreateStressProjectInput): StressProjectMetadata => {
  if (!Number.isSafeInteger(input.fileCount) || input.fileCount < 1) {
    throw new Error("Stress file count must be a positive integer");
  }
  if (!Number.isSafeInteger(input.componentsPerFileCount) || input.componentsPerFileCount < 1) {
    throw new Error("Stress components per file must be a positive integer");
  }

  fs.rmSync(input.directory, { recursive: true, force: true });
  const sourceDirectory = path.join(input.directory, "src");
  fs.mkdirSync(sourceDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(input.directory, "package.json"),
    `${JSON.stringify(
      {
        name: "react-doctor-stress-project",
        private: true,
        version: "1.0.0",
        dependencies: {
          react: "^19.0.0",
        },
      },
      null,
      2,
    )}\n`,
  );
  fs.writeFileSync(
    path.join(input.directory, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          jsx: "react-jsx",
          strict: true,
          target: "ES2022",
        },
        include: ["src"],
      },
      null,
      2,
    )}\n`,
  );
  fs.writeFileSync(
    path.join(sourceDirectory, "shared-values.ts"),
    `export const normalizeStressValue = (value: number): number => value % ${STRESS_VALUE_MODULUS};\n`,
  );

  const indexExports: string[] = [];
  for (let fileIndex = 0; fileIndex < input.fileCount; fileIndex += 1) {
    const fileIndexLabel = String(fileIndex).padStart(STRESS_FILE_INDEX_CHARACTER_COUNT, "0");
    const sourceFilename = `component-${fileIndexLabel}.tsx`;
    fs.writeFileSync(
      path.join(sourceDirectory, sourceFilename),
      buildStressSourceFile(fileIndexLabel, input.componentsPerFileCount),
    );
    indexExports.push(`export * from "./component-${fileIndexLabel}";`);
  }
  fs.writeFileSync(path.join(sourceDirectory, "index.ts"), `${indexExports.join("\n")}\n`);

  return {
    directory: input.directory,
    generatedSourceFileCount: input.fileCount + STRESS_SUPPORT_SOURCE_FILE_COUNT,
    componentCount: input.fileCount * input.componentsPerFileCount,
  };
};
