import * as fs from "node:fs";
import * as path from "node:path";
import { buildStressSourceFile } from "./build-stress-source-file.ts";
import {
  STRESS_FILE_INDEX_CHARACTER_COUNT,
  STRESS_PROJECT_MARKER_CONTENT,
  STRESS_PROJECT_MARKER_FILENAME,
  STRESS_SUPPORT_SOURCE_FILE_COUNT,
  STRESS_VALUE_MODULUS,
} from "./constants.ts";
import { hasValidFileMarker } from "./has-valid-file-marker.ts";
import { isPathWithin } from "./is-path-within.ts";
import type { CreateStressProjectInput, StressProjectMetadata } from "./types.ts";

export const createStressProject = (input: CreateStressProjectInput): StressProjectMetadata => {
  if (!Number.isSafeInteger(input.fileCount) || input.fileCount < 1) {
    throw new Error("Stress file count must be a positive integer");
  }
  if (!Number.isSafeInteger(input.componentsPerFileCount) || input.componentsPerFileCount < 1) {
    throw new Error("Stress components per file must be a positive integer");
  }

  const projectDirectory = path.resolve(input.directory);
  if (isPathWithin(projectDirectory, process.cwd())) {
    throw new Error(
      `Stress project directory cannot contain the working directory: ${projectDirectory}`,
    );
  }
  const markerPath = path.join(projectDirectory, STRESS_PROJECT_MARKER_FILENAME);
  if (fs.existsSync(projectDirectory)) {
    const projectStats = fs.lstatSync(projectDirectory);
    if (!projectStats.isDirectory() || projectStats.isSymbolicLink()) {
      throw new Error(`Stress project path must be a directory: ${projectDirectory}`);
    }
    const projectEntries = fs.readdirSync(projectDirectory);
    if (projectEntries.length > 0) {
      if (!hasValidFileMarker(markerPath, STRESS_PROJECT_MARKER_CONTENT)) {
        throw new Error(
          `Refusing to replace unmarked stress project directory: ${projectDirectory}`,
        );
      }
    }
  }

  fs.rmSync(projectDirectory, { recursive: true, force: true });
  const sourceDirectory = path.join(projectDirectory, "src");
  fs.mkdirSync(sourceDirectory, { recursive: true });
  fs.writeFileSync(markerPath, STRESS_PROJECT_MARKER_CONTENT);
  fs.writeFileSync(
    path.join(projectDirectory, "package.json"),
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
    path.join(projectDirectory, "tsconfig.json"),
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
    directory: projectDirectory,
    generatedSourceFileCount: input.fileCount + STRESS_SUPPORT_SOURCE_FILE_COUNT,
    componentCount: input.fileCount * input.componentsPerFileCount,
  };
};
