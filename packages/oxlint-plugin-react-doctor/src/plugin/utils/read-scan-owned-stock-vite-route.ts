import * as fs from "node:fs";
import * as path from "node:path";
import { readDeclaredViteDefaultBuild } from "./read-declared-vite-default-build.js";
import { readLocalLiteralTestIdTransform } from "./read-local-literal-testid-transform.js";
import { readDeclaredViteSelection } from "./read-vite-project-selection.js";
import { readStockVite6CompilerPackages } from "./stock-vite-providers/read-stock-vite6-compiler-packages.js";
import { readStockVite6NativeBundlers } from "./stock-vite-providers/read-stock-vite6-native-bundlers.js";
import { readsVerifiedPackageLauncher } from "./stock-vite-providers/reads-verified-package-launcher.js";
import { confirmsInertModuleReplacement } from "./read-declared-inert-vite-package-shim.js";
import {
  recordContentProbe,
  recordExistenceProbe,
  recordRealpathProbe,
} from "./cross-file-probe-recorder.js";
import { parseSourceFile } from "./parse-source-file.js";
import { walkAst } from "./walk-ast.js";
import { isNodeOfType } from "./is-node-of-type.js";

const disabledOptionalCompilers = [
  "rollup-plugin-visualizer",
  "vite-plugin-istanbul",
  "vite-plugin-total-bundle-size",
] as const;
const providerSpecifiers = ["react", "react-dom", "@testing-library/react"];
// Config bundles and ordinary module loading accept different inferred
// extensions. A competing candidate with either interpretation is unknown.
const possibleConfigExtensions = [
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
  ".mts",
  ".mjs",
  ".cts",
  ".cjs",
  ".json",
  ".css",
];

export const resolveOnlyLocalCompiler = (
  configFilename: string,
  specifier: string,
): string | null => {
  if (!/^\.\/[A-Za-z0-9_-]+(?:\.[cm]?[jt]s)?$/u.test(specifier)) return null;
  const filename = path.resolve(path.dirname(configFilename), specifier);
  const names = path.extname(filename)
    ? [filename]
    : [filename, ...possibleConfigExtensions.map((extension) => filename + extension)];
  const found: string[] = [];
  for (const name of names) {
    recordExistenceProbe(name);
    const entry = fs.lstatSync(name, { throwIfNoEntry: false });
    if (!entry) continue;
    recordRealpathProbe(name);
    if (!entry.isFile() || fs.realpathSync(name) !== name) return null;
    found.push(name);
  }
  return found.length === 1 ? found[0] : null;
};

export const readScanOwnedStockViteRoute = (input: {
  readonly filename: string;
  readonly targetDirectory: string;
  readonly relevantSources: readonly string[];
  readonly runtime: {
    readonly platform: string;
    readonly architecture: string;
    readonly libc: "glibc" | "musl" | "unknown";
    readonly esbuildBinaryOverride: boolean;
  };
}) => {
  try {
    const result = readDeclaredViteSelection(input.filename);
    for (const name of result.inputs.existence) recordExistenceProbe(name);
    for (const name of result.inputs.content) recordContentProbe(name);
    const selected = result.selection;
    if (!selected || selected.projectDirectory !== input.targetDirectory) return null;
    recordRealpathProbe(selected.configFile);
    if (fs.realpathSync(selected.configFile) !== selected.configFile) return null;
    const program = parseSourceFile(selected.configFile);
    if (!isNodeOfType(program, "Program")) return null;

    // Support the inert browser fallback for Protobuf's optional Node loader.
    // Discover its replacement path from this config, then require the full
    // declaration parser to recognize the actual effective alias.
    const shimReplacements = new Set<string>();
    const localImports: { specifier: string; exportedName: string }[] = [];
    walkAst(program, (node) => {
      if (
        isNodeOfType(node, "Literal") &&
        typeof node.value === "string" &&
        /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.cjs$/u.test(node.value) &&
        confirmsInertModuleReplacement(input.targetDirectory, node.value)
      )
        shimReplacements.add(node.value);
    });
    for (const statement of program.body) {
      if (
        !isNodeOfType(statement, "ImportDeclaration") ||
        typeof statement.source.value !== "string"
      )
        continue;
      if (!statement.source.value.startsWith("./")) continue;
      for (const specifier of statement.specifiers) {
        if (
          isNodeOfType(specifier, "ImportSpecifier") &&
          isNodeOfType(specifier.imported, "Identifier")
        ) {
          localImports.push({
            specifier: statement.source.value,
            exportedName: specifier.imported.name,
          });
        }
      }
    }
    const selectedShims = [
      undefined,
      ...[...shimReplacements].map((relativeReplacement) => ({
        find: "@protobufjs/inquire",
        relativeReplacement,
      })),
    ];
    for (const packageShimAlias of selectedShims) {
      const projectionInput = { packageShimAlias };
      const transform = localImports.length
        ? readLocalLiteralTestIdTransform({
            projectRoot: input.targetDirectory,
            configFilename: selected.configFile,
            sources: input.relevantSources.map((filename) => {
              recordContentProbe(filename);
              return { filename, sourceText: fs.readFileSync(filename, "utf8") };
            }),
            projectionInputs: projectionInput,
            resolveLocalPlugin: resolveOnlyLocalCompiler,
          })
        : null;
      if (localImports.length && !transform) continue;
      const localTransform = transform
        ? localImports.find(
            ({ exportedName, specifier }) =>
              exportedName === transform.exportedName &&
              resolveOnlyLocalCompiler(selected.configFile, specifier) === transform.pluginFilename,
          )
        : undefined;
      if (transform && !localTransform) continue;
      const profile = readDeclaredViteDefaultBuild(selected.configFile, {
        ...projectionInput,
        localTransform,
      });
      if (
        !profile ||
        profile.root !== input.targetDirectory ||
        profile.aliases.some(({ find }) =>
          providerSpecifiers.some(
            (provider) =>
              find === provider ||
              provider.startsWith(find + "/") ||
              find.startsWith(provider + "/"),
          ),
        )
      )
        continue;
      const modules = readStockVite6CompilerPackages({
        projectRoot: input.targetDirectory,
        configurationDirectory: path.dirname(selected.configFile),
        usesSvgr: profile.effects.includes("svg-components"),
        eagerOptionalImports: disabledOptionalCompilers.filter((name) =>
          profile.externalProviders.includes(name),
        ),
      });
      const vite = modules?.get("vite");
      if (
        !vite ||
        !modules ||
        !readsVerifiedPackageLauncher({
          projectRoot: input.targetDirectory,
          projectDirectory: selected.projectDirectory,
          packageDirectory: vite.packageDirectory,
          binary: "vite",
        })
      )
        continue;
      const native = readStockVite6NativeBundlers({
        projectRoot: input.targetDirectory,
        installedCompiler: modules,
        runtime: input.runtime,
      });
      if (!native) continue;
      return { selected, profile, modules, transform, projectionInput };
    }
    return null;
  } catch {
    return null;
  }
};
