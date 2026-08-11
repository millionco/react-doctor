import type { DependencyGraph } from "../types.js";
import { normalizeRegistryModulePath } from "../utils/normalize-registry-module-path.js";

interface RegistryModuleLookup {
  basenameToModuleIndex: Map<string, number | "ambiguous">;
  pathSuffixToModuleIndex: Map<string, number | "ambiguous">;
}

const basenameFromPath = (filePath: string): string => {
  const lastSlashIndex = filePath.lastIndexOf("/");
  return lastSlashIndex === -1 ? filePath : filePath.slice(lastSlashIndex + 1);
};

const recordUniqueModuleIndex = (
  moduleIndexByReference: Map<string, number | "ambiguous">,
  reference: string,
  moduleIndex: number,
): void => {
  const existingModuleIndex = moduleIndexByReference.get(reference);
  if (existingModuleIndex === undefined) {
    moduleIndexByReference.set(reference, moduleIndex);
  } else if (existingModuleIndex !== "ambiguous") {
    moduleIndexByReference.set(reference, "ambiguous");
  }
};

const buildRegistryModuleLookup = (moduleGraph: DependencyGraph): RegistryModuleLookup => {
  const basenameToModuleIndex = new Map<string, number | "ambiguous">();
  const pathSuffixToModuleIndex = new Map<string, number | "ambiguous">();
  const referencedPathSuffixes = new Set<string>();

  for (const module of moduleGraph.modules) {
    for (const referencedFilename of module.referencedFilenames) {
      if (referencedFilename.includes("/")) {
        referencedPathSuffixes.add(normalizeRegistryModulePath(referencedFilename));
      }
    }
  }

  for (const module of moduleGraph.modules) {
    recordUniqueModuleIndex(
      basenameToModuleIndex,
      basenameFromPath(module.fileId.path),
      module.fileId.index,
    );

    const extensionlessPath = normalizeRegistryModulePath(module.fileId.path);
    let slashIndex = extensionlessPath.indexOf("/");
    while (slashIndex !== -1) {
      const pathSuffix = extensionlessPath.slice(slashIndex + 1);
      slashIndex = extensionlessPath.indexOf("/", slashIndex + 1);
      if (referencedPathSuffixes.has(pathSuffix)) {
        recordUniqueModuleIndex(pathSuffixToModuleIndex, pathSuffix, module.fileId.index);
      }
    }
  }

  return { basenameToModuleIndex, pathSuffixToModuleIndex };
};

export const markFilenameRegistryEntries = (moduleGraph: DependencyGraph): void => {
  const { basenameToModuleIndex, pathSuffixToModuleIndex } = buildRegistryModuleLookup(moduleGraph);

  for (const module of moduleGraph.modules) {
    for (const referencedFilename of module.referencedFilenames) {
      const targetModuleIndex = referencedFilename.includes("/")
        ? pathSuffixToModuleIndex.get(normalizeRegistryModulePath(referencedFilename))
        : basenameToModuleIndex.get(referencedFilename);
      if (typeof targetModuleIndex !== "number") continue;

      const targetModule = moduleGraph.modules[targetModuleIndex];
      if (
        targetModule &&
        !targetModule.isEntryPoint &&
        targetModule.fileId.index !== module.fileId.index
      ) {
        targetModule.isEntryPoint = true;
      }
    }
  }
};
