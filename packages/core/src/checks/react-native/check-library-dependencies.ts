import * as path from "node:path";
import { readPackageJson } from "../../project-info/index.js";
import type { Diagnostic, PackageJson } from "../../types/index.js";

const BUILDER_BOB_PACKAGE = "react-native-builder-bob";

// `react`/`react-native` belong in a library's `peerDependencies`, never
// `dependencies` — bundling them installs a second copy in the consumer app
// and causes "Invalid hook call" (duplicate React) and duplicate-native-module
// crashes. We gate strictly on the bob *config block*
// (`"react-native-builder-bob": { ... }`), which only the library package
// declares. The `example/` app inside a library monorepo lists bob in its
// `devDependencies` (to build the local lib) but has NO config block, so
// gating on the config key — not the dependency — keeps example apps quiet.
const isBuilderBobLibrary = (packageJson: PackageJson): boolean => {
  // bob's config block isn't part of the typed PackageJson shape — read via
  // a cast and confirm it's an object literal (the config), not a stray value.
  const bobConfig = (packageJson as Record<string, unknown>)[BUILDER_BOB_PACKAGE];
  return typeof bobConfig === "object" && bobConfig !== null;
};

export const checkReactNativeLibraryDependencies = (rootDirectory: string): Diagnostic[] => {
  const packageJson = readPackageJson(path.join(rootDirectory, "package.json"));
  if (!isBuilderBobLibrary(packageJson)) return [];

  const misplaced = (["react", "react-native"] as const).filter(
    (name) => packageJson.dependencies?.[name] !== undefined,
  );
  if (misplaced.length === 0) return [];

  const quoted = misplaced.map((name) => `"${name}"`).join(" and ");
  return [
    {
      filePath: "package.json",
      plugin: "react-doctor",
      rule: "rn-library-react-in-dependencies",
      severity: "warning",
      message: `This react-native-builder-bob library lists ${quoted} in \`dependencies\` — that ships a second copy into consumer apps, causing "Invalid hook call" (duplicate React) and duplicate-native-module crashes.`,
      help: `Move ${quoted} to \`peerDependencies\` (keep ${misplaced.length === 1 ? "it" : "them"} in \`devDependencies\` for local development).`,
      line: 0,
      column: 0,
      category: "Correctness",
    },
  ];
};
