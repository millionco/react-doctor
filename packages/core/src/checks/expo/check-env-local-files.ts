import * as path from "node:path";
import { isFile } from "../../project-info/index.js";
import type { Diagnostic } from "../../types/index.js";
import type { ExpoCheckContext } from "./expo-check-context.js";
import { buildExpoDiagnostic } from "./utils/build-expo-diagnostic.js";
import { isPathGitIgnored } from "./utils/is-path-git-ignored.js";

// `.env*.local` files are per-developer overrides that should never be
// committed (they leak secrets and impose local settings on others).
// Ported from expo-doctor's `EnvLocalFilesCheck`. The local-mode env file
// names come from `@expo/env`'s `KNOWN_MODES`.
const LOCAL_ENV_FILE_NAMES: ReadonlyArray<string> = [
  ".env.local",
  ".env.development.local",
  ".env.production.local",
  ".env.test.local",
];

export const checkExpoEnvLocalFiles = (context: ExpoCheckContext): Diagnostic[] => {
  const { rootDirectory } = context;
  const committedEnvFiles = LOCAL_ENV_FILE_NAMES.filter((fileName) => {
    const filePath = path.join(rootDirectory, fileName);
    if (!isFile(filePath)) return false;
    // Skip when the ignore status is undetermined (no git checkout) to
    // avoid false positives, matching expo-doctor's behavior.
    return isPathGitIgnored(rootDirectory, filePath) === false;
  });

  if (committedEnvFiles.length === 0) return [];

  return [
    buildExpoDiagnostic({
      rule: "expo-env-local-not-gitignored",
      category: "Security",
      message: `Local environment ${committedEnvFiles.length === 1 ? "file" : "files"} (${committedEnvFiles.join(", ")}) ${committedEnvFiles.length === 1 ? "is" : "are"} not ignored by Git — committing \`.env*.local\` risks leaking secrets and overriding committed defaults for everyone who clones the project`,
      help: `Add \`.env*.local\` to your .gitignore. If already committed, untrack with \`git rm --cached ${committedEnvFiles.join(" ")}\``,
    }),
  ];
};
