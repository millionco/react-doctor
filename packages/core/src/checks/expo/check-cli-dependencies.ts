import path from "node:path";
import { readPackageJson } from "../../project-info/index.js";
import type { Diagnostic } from "../../types/index.js";
import { buildExpoDiagnostic } from "./utils/build-expo-diagnostic.js";
import { getDirectDependencyNames } from "./utils/get-direct-dependency-names.js";

interface CliDependency {
  readonly packageName: string;
  readonly message: string;
  readonly help: string;
}

// Ported from expo-doctor's `GlobalPackageInstalledLocallyCheck`.
const CLI_DEPENDENCIES: ReadonlyArray<CliDependency> = [
  {
    packageName: "expo-cli",
    message:
      "`expo-cli` (the legacy global CLI) is a project dependency — the CLI now ships inside the `expo` package, and keeping `expo-cli` causes failures such as `unknown option --fix` when running `npx expo install --fix`",
    help: "Remove `expo-cli` from your dependencies and use the bundled CLI via `npx expo`",
  },
  {
    packageName: "eas-cli",
    message:
      "`eas-cli` is a project dependency — pinning it in package.json drifts from the latest EAS CLI and bloats installs",
    help: "Remove `eas-cli` from your dependencies and run it on demand with `npx eas-cli` (or install it globally)",
  },
];

export const checkExpoCliDependencies = (rootDirectory: string): Diagnostic[] => {
  const packageJson = readPackageJson(path.join(rootDirectory, "package.json"));
  const directDependencyNames = getDirectDependencyNames(packageJson);
  return CLI_DEPENDENCIES.filter((cliDependency) =>
    directDependencyNames.has(cliDependency.packageName),
  ).map((cliDependency) =>
    buildExpoDiagnostic({
      rule: "expo-no-cli-dependencies",
      message: cliDependency.message,
      help: cliDependency.help,
    }),
  );
};
