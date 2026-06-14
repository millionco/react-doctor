import * as path from "node:path";
import { isDirectory } from "../../project-info/index.js";
import type { Diagnostic } from "../../types/index.js";
import type { ExpoCheckContext } from "./expo-check-context.js";
import { buildExpoDiagnostic } from "./utils/build-expo-diagnostic.js";
import { findLocalModuleNativeFiles } from "./utils/find-local-module-native-files.js";
import { isPathGitIgnored } from "../../utils/is-path-git-ignored.js";

// Ported from expo-doctor's `ProjectSetupCheck`:
//   1. `.expo/` holds machine-specific dev-server state and MUST be
//      gitignored.
//   2. The native `ios` / `android` directories of local Expo modules
//      (`modules/<name>/…`) must NOT be gitignored — overly broad
//      `ios` / `android` ignore rules silently drop them.
// Both sub-checks skip when the ignore status is undetermined (no git
// checkout) to avoid false positives.
export const checkExpoGitignore = (context: ExpoCheckContext): Diagnostic[] => {
  const { rootDirectory } = context;
  const diagnostics: Diagnostic[] = [];

  const expoStateDirectory = path.join(rootDirectory, ".expo");
  if (
    isDirectory(expoStateDirectory) &&
    isPathGitIgnored(rootDirectory, expoStateDirectory) === false
  ) {
    diagnostics.push(
      buildExpoDiagnostic({
        rule: "expo-gitignore",
        message:
          "The `.expo` directory is not ignored by Git — it holds machine-specific device history and dev-server settings that should not be committed",
        help: "Add `.expo/` to your .gitignore",
      }),
    );
  }

  const ignoredNativeFile = findLocalModuleNativeFiles(rootDirectory).find(
    (nativeFilePath) => isPathGitIgnored(rootDirectory, nativeFilePath) === true,
  );
  if (ignoredNativeFile !== undefined) {
    diagnostics.push(
      buildExpoDiagnostic({
        rule: "expo-gitignore",
        message:
          "The native `ios`/`android` directories of a local Expo module under `modules/` are gitignored, so required native code can be missing from CI or teammate checkouts.",
        help: "Use anchored patterns like `/ios` and `/android` in .gitignore so only the top-level native directories are excluded, not those inside `modules/`",
      }),
    );
  }

  return diagnostics;
};
