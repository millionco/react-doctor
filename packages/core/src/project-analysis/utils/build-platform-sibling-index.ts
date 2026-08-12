import type { DependencyGraph } from "../types.js";
import { PLATFORM_SUFFIXES } from "../constants.js";

const PLATFORM_DIRECTORY_NAMES = new Set([
  "web",
  "native",
  "ios",
  "android",
  "desktop",
  "windows",
  "macos",
]);

const stripPlatformSuffix = (
  filePath: string,
  platformSuffixes: ReadonlyArray<string>,
): string | undefined => {
  for (const suffix of platformSuffixes) {
    const extensionIndex = filePath.lastIndexOf(".");
    if (extensionIndex === -1) continue;

    const withoutExtension = filePath.slice(0, extensionIndex);
    if (withoutExtension.endsWith(suffix)) {
      return withoutExtension.slice(0, -suffix.length) + filePath.slice(extensionIndex);
    }
  }
  return undefined;
};

const stripPlatformDirectory = (filePath: string): string | undefined => {
  const segments = filePath.split("/");
  for (let segmentIndex = segments.length - 2; segmentIndex >= 0; segmentIndex--) {
    if (PLATFORM_DIRECTORY_NAMES.has(segments[segmentIndex])) {
      return [...segments.slice(0, segmentIndex), ...segments.slice(segmentIndex + 1)].join("/");
    }
  }
  return undefined;
};

export const buildPlatformSiblingIndex = (
  graph: DependencyGraph,
  additionalPlatformSuffixesForFile: (filePath: string) => ReadonlyArray<string> = () => [],
): Map<number, number[]> => {
  const platformSiblingGroups = new Map<string, Set<number>>();
  const addToSiblingGroup = (groupKey: string, moduleIndex: number): void => {
    const existingSiblings = platformSiblingGroups.get(groupKey);
    if (existingSiblings) {
      existingSiblings.add(moduleIndex);
    } else {
      platformSiblingGroups.set(groupKey, new Set([moduleIndex]));
    }
  };

  for (let moduleIndex = 0; moduleIndex < graph.modules.length; moduleIndex++) {
    const modulePath = graph.modules[moduleIndex].fileId.path;
    const basePathFromSuffix = stripPlatformSuffix(modulePath, [
      ...PLATFORM_SUFFIXES,
      ...additionalPlatformSuffixesForFile(modulePath),
    ]);
    if (basePathFromSuffix) {
      addToSiblingGroup(basePathFromSuffix, moduleIndex);
    }

    const basePathFromDirectory = stripPlatformDirectory(modulePath);
    if (basePathFromDirectory) {
      addToSiblingGroup(`dir:${basePathFromDirectory}`, moduleIndex);
    }
  }

  for (let moduleIndex = 0; moduleIndex < graph.modules.length; moduleIndex++) {
    const modulePath = graph.modules[moduleIndex].fileId.path;
    const declarationBasePath = modulePath.replace(/\.d(?=\.[^./]+$)/, "");
    for (const groupKey of [modulePath, declarationBasePath]) {
      if (platformSiblingGroups.has(groupKey)) {
        addToSiblingGroup(groupKey, moduleIndex);
      }
    }
  }

  const siblingIndex = new Map<number, number[]>();
  for (const siblingSet of platformSiblingGroups.values()) {
    const siblingIndices = [...siblingSet];
    if (siblingIndices.length < 2) continue;
    for (const siblingIndexKey of siblingIndices) {
      const existingSiblings = siblingIndex.get(siblingIndexKey);
      siblingIndex.set(
        siblingIndexKey,
        existingSiblings ? [...new Set([...existingSiblings, ...siblingIndices])] : siblingIndices,
      );
    }
  }

  return siblingIndex;
};
