import * as fs from "node:fs";
import * as path from "node:path";
import {
  STRESS_BRANCH_MODULUS,
  STRESS_FILE_INDEX_CHARACTER_COUNT,
  STRESS_HELPER_INDEX_CHARACTER_COUNT,
  STRESS_HELPER_MODULES_PER_IMPORT,
  STRESS_PROJECT_MARKER_CONTENT,
  STRESS_PROJECT_MARKER_FILENAME,
  STRESS_SUPPORT_SOURCE_FILE_COUNT,
  STRESS_VALUE_MODULUS,
  STRESS_VALUES_PER_COMPONENT_COUNT,
} from "./constants.ts";
import { hasValidFileMarker } from "./has-valid-file-marker.ts";
import { isPathWithin } from "./is-path-within.ts";
import type { CreateStressProjectInput, StressProjectMetadata } from "./types.ts";

const helperName = (helperIndex: number): string =>
  `stressHelper${String(helperIndex).padStart(STRESS_HELPER_INDEX_CHARACTER_COUNT, "0")}`;

// Every helper a file imports is applied to the seed, so the imports are live
// bindings that the cross-file rules resolve rather than unused specifiers.
const buildSeedExpression = (helperNames: ReadonlyArray<string>): string =>
  helperNames.reduce((expression, name) => `${name}(${expression})`, "seed");

const buildStressComponentSource = (
  fileIndexLabel: string,
  componentIndex: number,
  helperNames: ReadonlyArray<string>,
): string => {
  const componentName = `StressComponent${fileIndexLabel}_${componentIndex}`;
  return `export const ${componentName} = ({ seed }: StressProps) => {
  const [selectedValue, setSelectedValue] = useState(${buildSeedExpression(helperNames)});
  const values = useMemo(
    () =>
      Array.from(
        { length: ${STRESS_VALUES_PER_COMPONENT_COUNT} },
        (_, valueIndex) => normalizeStressValue(seed + valueIndex),
      ),
    [seed],
  );
  const total = useMemo(() => {
    let calculatedTotal = 0;
    for (const value of values) {
      if (value % ${STRESS_BRANCH_MODULUS} === 0) {
        calculatedTotal += value * ${STRESS_VALUE_MODULUS};
      } else {
        calculatedTotal += value;
      }
    }
    return calculatedTotal;
  }, [values]);

  useEffect(() => {
    const controller = new AbortController();
    const selectNextValue = () => {
      setSelectedValue((currentValue) => normalizeStressValue(currentValue + 1));
    };
    window.addEventListener("stress-update", selectNextValue, { signal: controller.signal });
    return () => controller.abort();
  }, []);

  return (
    <section aria-label="${componentName}" data-total={total}>
      <button type="button" onClick={() => setSelectedValue(total)}>
        Select calculated value
      </button>
      <output>{selectedValue}</output>
      {values.map((value, index) => (
        <div key={index}>{value}</div>
      ))}
    </section>
  );
};`;
};

const buildStressSourceFile = (
  fileIndexLabel: string,
  componentsPerFileCount: number,
  helperNames: ReadonlyArray<string>,
): string => {
  const components = Array.from({ length: componentsPerFileCount }, (_, componentIndex) =>
    buildStressComponentSource(fileIndexLabel, componentIndex, helperNames),
  );
  const helperImport =
    helperNames.length === 0 ? "" : `import { ${helperNames.join(", ")} } from "./helpers";\n`;
  return `import { useEffect, useMemo, useState } from "react";
import { normalizeStressValue } from "./shared-values";
${helperImport}
interface StressProps {
  readonly seed: number;
}

${components.join("\n\n")}
`;
};

// File `fileIndex` imports a sliding window of the helper pool, so neighbouring
// files share most dependencies (like a real feature directory) while the pool
// as a whole is several times wider than any one file's import list.
const selectHelperNames = (
  fileIndex: number,
  importsPerFileCount: number,
  helperModuleCount: number,
): string[] =>
  Array.from({ length: importsPerFileCount }, (_, importIndex) =>
    helperName((fileIndex + importIndex) % helperModuleCount),
  );

const writeHelperModules = (sourceDirectory: string, helperModuleCount: number): void => {
  if (helperModuleCount === 0) return;
  const helpersDirectory = path.join(sourceDirectory, "helpers");
  fs.mkdirSync(helpersDirectory, { recursive: true });
  const barrelExports: string[] = [];
  for (let helperIndex = 0; helperIndex < helperModuleCount; helperIndex += 1) {
    const name = helperName(helperIndex);
    fs.writeFileSync(
      path.join(helpersDirectory, `${name}.ts`),
      `export const ${name} = (value: number): number => value + ${helperIndex};\n`,
    );
    barrelExports.push(`export { ${name} } from "./${name}";`);
  }
  fs.writeFileSync(path.join(helpersDirectory, "index.ts"), `${barrelExports.join("\n")}\n`);
};

export const createStressProject = (input: CreateStressProjectInput): StressProjectMetadata => {
  if (!Number.isSafeInteger(input.fileCount) || input.fileCount < 1) {
    throw new Error("Stress file count must be a positive integer");
  }
  if (!Number.isSafeInteger(input.componentsPerFileCount) || input.componentsPerFileCount < 1) {
    throw new Error("Stress components per file must be a positive integer");
  }
  const importsPerFileCount = input.importsPerFileCount ?? 0;
  if (!Number.isSafeInteger(importsPerFileCount) || importsPerFileCount < 0) {
    throw new Error("Stress imports per file must be a non-negative integer");
  }
  const helperModuleCount = importsPerFileCount * STRESS_HELPER_MODULES_PER_IMPORT;

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

  writeHelperModules(sourceDirectory, helperModuleCount);

  const indexExports: string[] = [];
  for (let fileIndex = 0; fileIndex < input.fileCount; fileIndex += 1) {
    const fileIndexLabel = String(fileIndex).padStart(STRESS_FILE_INDEX_CHARACTER_COUNT, "0");
    const sourceFilename = `component-${fileIndexLabel}.tsx`;
    fs.writeFileSync(
      path.join(sourceDirectory, sourceFilename),
      buildStressSourceFile(
        fileIndexLabel,
        input.componentsPerFileCount,
        selectHelperNames(fileIndex, importsPerFileCount, helperModuleCount),
      ),
    );
    indexExports.push(`export * from "./component-${fileIndexLabel}";`);
  }
  fs.writeFileSync(path.join(sourceDirectory, "index.ts"), `${indexExports.join("\n")}\n`);

  const helperSourceFileCount = helperModuleCount === 0 ? 0 : helperModuleCount + 1;
  return {
    directory: projectDirectory,
    generatedSourceFileCount:
      input.fileCount + STRESS_SUPPORT_SOURCE_FILE_COUNT + helperSourceFileCount,
    componentCount: input.fileCount * input.componentsPerFileCount,
    helperModuleCount,
  };
};
