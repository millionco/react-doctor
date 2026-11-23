import * as fs from "node:fs";
import * as path from "node:path";
import {
  buildSourceProjectIndex,
  readSelectedTypedSourceClosure,
  type SourceProjectTypedEdgeReader,
} from "./build-source-project-index.js";
import { isProbeRecorderActive } from "./cross-file-probe-recorder.js";
import { getReactDoctorStringSetting } from "./get-react-doctor-setting.js";
import {
  hasExpectedNpmLauncher,
  hasStockNodeNpmCompilerEnvironment,
} from "./has-stock-node-npm-compiler-environment.js";
import { isPathInside } from "./is-path-inside.js";
import { readPhysicalImplicitJsxProgram } from "./read-physical-implicit-jsx-program.js";
import type { RuleContext } from "./rule-context.js";
import { readProviderMember } from "./stock-vite-providers/resolve-stock-physical-entry.js";
import { verifyStockNpmCompilerSnapshot } from "./verify-stock-npm-compiler-snapshot.js";

const STOCK_CRA_NPM_SNAPSHOT = {
  packages: 1318,
  members: 73_617,
  contentDigest: "14517683b7f7979e0b6230542b137239561700fa4f28493218c202942b6b8383",
} as const;

// Stock CRA 5 uses this JS source resolution order without a tsconfig.
const JAVASCRIPT_EXTENSIONS = [".web.mjs", ".mjs", ".web.js", ".js", ".json", ".web.jsx", ".jsx"];
const ENTRY_EXTENSIONS = [...JAVASCRIPT_EXTENSIONS, ".web.ts", ".ts", ".web.tsx", ".tsx"];
const stockSnapshotByRoot = new Map<string, boolean>();
let useManagedSnapshotCache = false;

export const resetStockCraCompilerCache = (): void => {
  stockSnapshotByRoot.clear();
  useManagedSnapshotCache = true;
};

const hasVerifiedCraSnapshot = (root: string): boolean => {
  if (!useManagedSnapshotCache || isProbeRecorderActive()) {
    return verifyStockNpmCompilerSnapshot(root, STOCK_CRA_NPM_SNAPSHOT);
  }
  const cached = stockSnapshotByRoot.get(root);
  if (cached !== undefined) return cached;
  const verified = verifyStockNpmCompilerSnapshot(root, STOCK_CRA_NPM_SNAPSHOT);
  stockSnapshotByRoot.set(root, verified);
  return verified;
};
const STOCK_SCRIPTS: Readonly<Record<string, string>> = {
  build: "react-scripts build",
  start: "react-scripts start",
  test: "react-scripts test",
  eject: "react-scripts eject",
};
const PROJECT_OVERRIDES = [
  ".pnp.js",
  ".pnp.cjs",
  ".pnp.loader.mjs",
  ".env",
  ".env.local",
  ".env.production",
  ".env.production.local",
  ".env.development",
  ".env.development.local",
  ".env.test",
  ".env.test.local",
  "jsconfig.json",
  "tsconfig.json",
  "tailwind.config.js",
  "webpack.config.js",
  "config-overrides.js",
  "craco.config.js",
  "src/setupProxy.js",
];

const ESLINT_CONFIG_NAMES = [
  ".eslintrc",
  ".eslintrc.json",
  ".eslintrc.yml",
  ".eslintrc.yaml",
  ".eslintrc.js",
  ".eslintrc.cjs",
];

const stat = (filename: string): fs.Stats | undefined =>
  fs.lstatSync(filename, { throwIfNoEntry: false });
const exists = (filename: string): boolean => stat(filename) !== undefined;

const hasLocalEslintConfig = (directory: string): boolean =>
  ESLINT_CONFIG_NAMES.some((name) => exists(path.join(directory, name)));

const hasUnambiguousParentConfiguration = (root: string): boolean => {
  for (let directory = path.dirname(root); ; directory = path.dirname(directory)) {
    if (
      hasLocalEslintConfig(directory) ||
      ["package.json", ".pnp.js", ".pnp.cjs", ".pnp.loader.mjs"].some((name) =>
        exists(path.join(directory, name)),
      )
    ) {
      return false;
    }
    if (path.dirname(directory) === directory) return true;
  }
};

const isStockBrowserSelection = (browserslist: unknown): boolean => {
  const environments = jsonObject(browserslist);
  if (!environments || Object.keys(environments).length !== 2) return false;
  return (
    JSON.stringify(environments.production) === '[">0.2%","not dead","not op_mini all"]' &&
    JSON.stringify(environments.development) ===
      '["last 1 chrome version","last 1 firefox version","last 1 safari version"]'
  );
};

const jsonObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const readsStockProjectManifest = (root: string): boolean => {
  const bytes = readProviderMember(path.join(root, "package.json"));
  if (!bytes || bytes.length > 64 * 1024) return false;
  const manifest = jsonObject(JSON.parse(bytes.toString("utf8")));
  if (!manifest) return false;
  const scripts = jsonObject(manifest.scripts);
  const dependencies = jsonObject(manifest.dependencies);
  const eslintConfig = jsonObject(manifest.eslintConfig);
  return Boolean(
    dependencies?.["react-scripts"] === "5.0.1" &&
    (dependencies.react === "^18.2.0" || dependencies.react === "18.2.0") &&
    scripts?.build === STOCK_SCRIPTS.build &&
    isStockBrowserSelection(manifest.browserslist) &&
    !hasLocalEslintConfig(root) &&
    !exists(path.join(root, ".browserslistrc")) &&
    !exists(path.join(root, "browserslist")) &&
    Object.entries(scripts).every(
      ([name, definition]) =>
        Object.hasOwn(STOCK_SCRIPTS, name) && STOCK_SCRIPTS[name] === definition,
    ) &&
    !["browser", "workspaces", "jest", "svgr"].some((key) => Object.hasOwn(manifest, key)) &&
    (!Object.hasOwn(manifest, "eslintConfig") ||
      (eslintConfig &&
        Object.keys(eslintConfig).length === 1 &&
        JSON.stringify(eslintConfig.extends) === '["react-app","react-app/jest"]')),
  );
};

const hasPhysicalAppTemplate = (root: string): boolean => {
  const filename = path.join(root, "public", "index.html");
  const info = stat(filename);
  if (!info?.isFile() || info.size > 128 * 1024) return false;
  const bytes = readProviderMember(filename);
  return Boolean(bytes?.length && !bytes.includes("<%"));
};

const hasStockCraEnvironment = (root: string): boolean =>
  hasStockNodeNpmCompilerEnvironment(root) &&
  !Object.entries(process.env).some(
    ([name, value]) =>
      value &&
      (name === "DISABLE_NEW_JSX_TRANSFORM" ||
        name === "TSC_COMPILE_ON_ERROR" ||
        name.startsWith("BROWSERSLIST") ||
        name.startsWith("YARN_") ||
        name.startsWith("DOTENV_CONFIG_") ||
        /^npm_config_(?:workspace|workspaces|global|include_workspace_root)$/iu.test(name)),
  );

const selectSource = (candidate: string): string | null => {
  const primary = stat(candidate);
  if (primary?.isSymbolicLink()) return null;
  const possible = JAVASCRIPT_EXTENSIONS.map((extension) => candidate + extension);
  if (primary?.isDirectory()) {
    possible.push(
      ...JAVASCRIPT_EXTENSIONS.map((extension) => path.join(candidate, "index" + extension)),
    );
  } else if (primary) {
    possible.push(candidate);
  }
  const matches = possible.filter(exists);
  if (
    matches.length !== 1 ||
    !stat(matches[0])?.isFile() ||
    fs.realpathSync(matches[0]) !== matches[0]
  ) {
    return null;
  }
  return matches[0];
};

const createCraEdgeReader =
  (sourceDirectory: string): SourceProjectTypedEdgeReader =>
  (module, _node, request) => {
    if (request === null) return null;
    if (/[!?#:\\]/u.test(request) || /(?:^|[./])macro(?:$|[./])/iu.test(request)) {
      return { kind: "opaque" };
    }
    if (!/^\.{1,2}\//u.test(request)) {
      return /^[\w@][\w@./-]*$/u.test(request) ? { kind: "external" } : { kind: "opaque" };
    }
    const target = path.resolve(path.dirname(module.filePath), request);
    if (!isPathInside(target, sourceDirectory)) return { kind: "opaque" };
    const source = selectSource(target);
    if (source && /\.(?:mjs|js|jsx)$/u.test(source)) return { kind: "file", filename: source };
    if (source?.endsWith(".json")) return { kind: "data", filenames: [source] };
    return { kind: "opaque" };
  };

const hasStockSourceSelection = (
  sourceDirectory: string,
  filename: string,
  context: RuleContext,
): boolean => {
  const program = readPhysicalImplicitJsxProgram(context, filename);
  const entryCandidates = ENTRY_EXTENSIONS.map((extension) =>
    path.join(sourceDirectory, "index" + extension),
  ).filter(exists);
  const entrypoint = entryCandidates.length === 1 ? entryCandidates[0] : undefined;
  if (!program || !entrypoint) return false;
  const index = buildSourceProjectIndex({
    rootDirectory: sourceDirectory,
    currentFilePath: filename,
    currentProgramNode: program,
    currentScopes: context.scopes,
    includeTestlikeSources: true,
    javascriptAllowsJsx: true,
    readTypedRuntimeEdge: createCraEdgeReader(sourceDirectory),
  });
  if (!index || index.hasOpaqueRuntimeConsumerSurface || index.hasOpaqueMdxConsumerSurface) {
    return false;
  }
  const reachable = readSelectedTypedSourceClosure(index, [entrypoint]);
  if (!reachable?.reachable.has(filename)) return false;
  // A different nested manifest changes JavaScript module and browser
  // resolution. A file in a skipped directory is never admissible input.
  return [...index.modulesByFilePath.keys()].every((moduleFilename) => {
    for (
      let directory = path.dirname(moduleFilename);
      isPathInside(directory, sourceDirectory) || directory === sourceDirectory;
      directory = path.dirname(directory)
    ) {
      if (exists(path.join(directory, "package.json")) || hasLocalEslintConfig(directory))
        return false;
    }
    return /\.(?:mjs|js|jsx)$/u.test(moduleFilename);
  });
};

export const hasAutomaticStockCraJsx = (context: RuleContext): boolean => {
  const projectRoot = getReactDoctorStringSetting(context.settings, "rootDirectory");
  if (!projectRoot || !path.isAbsolute(projectRoot) || !context.filename?.endsWith(".jsx")) {
    return false;
  }
  const root = path.resolve(projectRoot);
  const filename = path.resolve(root, context.filename);
  const sourceDirectory = path.join(root, "src");
  if (!isPathInside(filename, sourceDirectory)) return false;
  try {
    if (
      fs.realpathSync(root) !== root ||
      !readsStockProjectManifest(root) ||
      !hasUnambiguousParentConfiguration(root) ||
      !hasPhysicalAppTemplate(root) ||
      PROJECT_OVERRIDES.some((name) => exists(path.join(root, name))) ||
      !hasStockCraEnvironment(root) ||
      exists(path.join(root, "node_modules", ".cache")) ||
      !hasExpectedNpmLauncher(
        path.join(root, "node_modules", ".bin", "react-scripts"),
        "../react-scripts/bin/react-scripts.js",
      ) ||
      !hasStockSourceSelection(sourceDirectory, filename, context)
    ) {
      return false;
    }
    return hasVerifiedCraSnapshot(root);
  } catch {
    return false;
  }
};
