import * as path from "node:path";
import { isDirectory } from "../../../project-info/utils/is-directory.js";
import { isFile } from "../../../project-info/utils/is-file.js";
import { readDirectoryEntries } from "../../../project-info/utils/read-directory-entries.js";

// Representative native files for a local Expo module: the iOS podspec and
// the Android Gradle build script. expo-doctor globs
// `modules/**/ios/*.podspec` and `modules/**/android/build.gradle`; we walk
// one level of module directories (`modules/<name>/…`), which covers the
// canonical `npx create-expo-module --local` layout without an unbounded
// recursive glob.
export const findLocalModuleNativeFiles = (rootDirectory: string): string[] => {
  const modulesDirectory = path.join(rootDirectory, "modules");
  if (!isDirectory(modulesDirectory)) return [];

  const nativeFilePaths: string[] = [];
  for (const moduleEntry of readDirectoryEntries(modulesDirectory)) {
    if (!moduleEntry.isDirectory()) continue;
    const moduleDirectory = path.join(modulesDirectory, moduleEntry.name);

    const gradlePath = path.join(moduleDirectory, "android", "build.gradle");
    if (isFile(gradlePath)) nativeFilePaths.push(gradlePath);

    const iosDirectory = path.join(moduleDirectory, "ios");
    if (isDirectory(iosDirectory)) {
      for (const iosEntry of readDirectoryEntries(iosDirectory)) {
        if (iosEntry.isFile() && iosEntry.name.endsWith(".podspec")) {
          nativeFilePaths.push(path.join(iosDirectory, iosEntry.name));
        }
      }
    }
  }
  return nativeFilePaths;
};
