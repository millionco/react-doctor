import { hasClosedKeyboardModuleInitialization } from "./has-closed-keyboard-module-initialization.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { CROSS_FILE_BARREL_FOLLOW_DEPTH } from "../constants/thresholds.js";
import { recordExistenceProbe, recordRealpathProbe } from "./cross-file-probe-recorder.js";
import { getRuntimeStaticDependencySource } from "./get-runtime-static-dependency-source.js";
import { getReactDoctorStringSetting } from "./get-react-doctor-setting.js";
import {
  hasExpectedNpmLauncher,
  hasStockNodeNpmCompilerEnvironment,
} from "./has-stock-node-npm-compiler-environment.js";
import { readDeclaredVite8KeyboardLibrary } from "./read-declared-vite8-keyboard-library.js";
import { isDeferredHotkeysRegistrationExport } from "./is-deferred-hotkeys-registration-export.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isPathInside } from "./is-path-inside.js";
import { parseSourceText } from "./parse-source-file.js";
import { parseTsconfigJson } from "./resolve-tsconfig-alias.js";
import type { RuleContext } from "./rule-context.js";
import { STOCK_VITE8_KEYBOARD_REGISTRATION_PROFILE } from "./stock-vite8-keyboard-registration-profile.js";
import {
  readProviderMember,
  resolveStockPhysicalEntry,
} from "./stock-vite-providers/resolve-stock-physical-entry.js";
import { verifyStockNpmCompilerPackages } from "./verify-stock-npm-compiler-packages.js";

const CONFIG_NAME = "vite.config.mts";
const DECLARATION_CONFIG = "tsconfig.build.json";
const BUILD_SCRIPT = "vite build && tsc -p " + DECLARATION_CONFIG;
const COMPILER_PACKAGES = [
  "vite",
  "typescript",
  "@vitejs/plugin-react",
  "vite-plugin-css-injected-by-js",
];
const MAX_REACHABLE_LIBRARY_MODULES = 64;
const VITE_CONFIG_EXTENSIONS = ["js", "ts", "mjs", "mts", "cjs", "cts"];

const stat = (filename: string): fs.Stats | undefined => {
  recordExistenceProbe(filename);
  return fs.lstatSync(filename, { throwIfNoEntry: false });
};

const readSource = (filename: string): string | null => {
  const entry = stat(filename);
  return entry?.isFile() ? (readProviderMember(filename)?.toString("utf8") ?? null) : null;
};

const isPhysicalDirectory = (directory: string): boolean => {
  recordRealpathProbe(directory);
  return Boolean(stat(directory)?.isDirectory() && fs.realpathSync(directory) === directory);
};

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const readManifest = (directory: string): Readonly<Record<string, unknown>> | null => {
  const source = readSource(path.join(directory, "package.json"));
  return source ? asRecord(JSON.parse(source)) : null;
};

const isSourceFile = (directory: string, filename: string): boolean =>
  isPathInside(filename, path.join(directory, "src")) &&
  !path.relative(directory, filename).split(path.sep).includes("node_modules");

const findHotkeysHelper = (project: string, filename: string, specifier: string): string | null => {
  if (!/^\.\/(?:[\w-]+\/)*[\w.-]+\.js$/u.test(specifier)) return null;
  const emitted = path.resolve(path.dirname(filename), specifier);
  const provider = emitted.slice(0, -3) + ".ts";
  if (!isSourceFile(project, provider) || stat(emitted) || !stat(provider)?.isFile()) {
    return null;
  }
  return provider;
};

const rootHasNpmWorkspace = (root: string, project: string): boolean => {
  if (!isPhysicalDirectory(root)) return false;
  const manifest = readManifest(root);
  return Boolean(
    manifest &&
    typeof manifest.packageManager === "string" &&
    /^npm@11\.\d+\.\d+$/u.test(manifest.packageManager) &&
    Array.isArray(manifest.workspaces) &&
    (manifest.workspaces.includes(path.relative(root, project)) ||
      manifest.workspaces.includes("packages/*")) &&
    stat(path.join(root, "package-lock.json"))?.isFile(),
  );
};

const readLibraryEntry = (project: string): string | null => {
  const manifest = readManifest(project);
  const scripts = asRecord(manifest?.scripts);
  const exports = asRecord(manifest?.exports);
  const entry = asRecord(exports?.["."]);
  if (
    !manifest ||
    manifest.type !== "module" ||
    manifest.main !== "./dist/index.js" ||
    manifest.module !== manifest.main ||
    entry?.default !== manifest.main ||
    entry.import !== manifest.main ||
    scripts?.build !== BUILD_SCRIPT ||
    Object.hasOwn(scripts, "prebuild") ||
    Object.hasOwn(scripts, "postbuild") ||
    Object.hasOwn(manifest, "browser") ||
    Object.hasOwn(manifest, "imports")
  ) {
    return null;
  }
  if (
    VITE_CONFIG_EXTENSIONS.some((extension) => {
      const candidate = "vite.config." + extension;
      return candidate !== CONFIG_NAME && stat(path.join(project, candidate));
    })
  )
    return null;
  const configFilename = path.join(project, CONFIG_NAME);
  const config = readSource(configFilename);
  const declarations = readSource(path.join(project, DECLARATION_CONFIG));
  if (!config || !declarations) return null;
  const typescript = parseTsconfigJson(declarations);
  if (asRecord(typescript?.compilerOptions)?.emitDeclarationOnly !== true) return null;
  const library = readDeclaredVite8KeyboardLibrary(configFilename, config);
  return library &&
    path.join(library.outDirectory, library.outputFileName + ".js") === "dist/index.js"
    ? path.join(project, library.entry)
    : null;
};

const selectViteModule = (project: string, importer: string, source: string): string | null => {
  if (!/^(?:\.\/|\.\.\/)+(?:[\w-]+\/)*[\w.-]+\.js$/u.test(source)) return null;
  const emitted = path.resolve(path.dirname(importer), source);
  if (!isSourceFile(project, emitted)) return null;
  const stem = emitted.slice(0, -3);
  for (const filename of [emitted, stem + ".ts", stem + ".tsx"]) {
    const info = stat(filename);
    if (info) return info.isFile() ? filename : null;
  }
  return null;
};

const entryReachesSource = (project: string, entry: string, focal: string): boolean => {
  const queued = new Set([entry]);
  const pending = [{ filename: entry, depth: 0 }];
  for (const { filename, depth } of pending) {
    if (filename === focal) return true;
    if (depth >= CROSS_FILE_BARREL_FOLLOW_DEPTH || !isSourceFile(project, filename)) continue;
    const text = readSource(filename);
    if (!text) continue;
    const program = parseSourceText({ filename, sourceText: text });
    if (!isNodeOfType(program, "Program")) continue;
    for (const statement of program.body) {
      if (
        "attributes" in statement &&
        Array.isArray(statement.attributes) &&
        statement.attributes.length
      )
        continue;
      const source = getRuntimeStaticDependencySource(statement);
      const selected = source && selectViteModule(project, filename, source);
      if (!selected || queued.has(selected)) continue;
      if (queued.size >= MAX_REACHABLE_LIBRARY_MODULES) return false;
      queued.add(selected);
      pending.push({ filename: selected, depth: depth + 1 });
    }
  }
  return false;
};

const hasUnshadowedSourceAncestors = (filename: string, project: string): boolean => {
  for (
    let directory = path.dirname(filename);
    directory !== project;
    directory = path.dirname(directory)
  ) {
    if (stat(path.join(directory, "package.json"))) return false;
    const alternative = path.join(directory, "node_modules", "hotkeys-js");
    if (["", ".js", ".json", ".node"].some((extension) => stat(alternative + extension)))
      return false;
  }
  return true;
};

const hasRootCompiler = (workspace: string, project: string): boolean => {
  for (let issuer = project; issuer !== workspace; issuer = path.dirname(issuer)) {
    const modules = path.join(issuer, "node_modules");
    if (
      stat(path.join(modules, ".bin", "vite")) ||
      stat(path.join(modules, ".bin", "tsc")) ||
      COMPILER_PACKAGES.some((name) =>
        ["", ".js", ".json", ".node"].some((extension) =>
          stat(path.join(modules, name + extension)),
        ),
      )
    )
      return false;
  }
  const rootModules = path.join(workspace, "node_modules");
  return (
    Object.entries(process.env).every(
      ([key, value]) => !value || !/^(?:NAPI_RS_|ROLLDOWN_|OXC_)/iu.test(key),
    ) &&
    hasStockNodeNpmCompilerEnvironment(project) &&
    hasExpectedNpmLauncher(path.join(rootModules, ".bin", "vite"), "../vite/bin/vite.js") &&
    hasExpectedNpmLauncher(path.join(rootModules, ".bin", "tsc"), "../typescript/bin/tsc") &&
    verifyStockNpmCompilerPackages(workspace, STOCK_VITE8_KEYBOARD_REGISTRATION_PROFILE)
  );
};

const resolvesStockLibraryImport = (
  workspace: string,
  importer: string,
  specifier: string,
  entry: string,
): boolean => {
  const stock = STOCK_VITE8_KEYBOARD_REGISTRATION_PROFILE.packages.find(
    ({ directory }) => directory === "node_modules/" + specifier,
  );
  if (!stock) return false;
  const selection = resolveStockPhysicalEntry({
    projectRoot: workspace,
    importerDirectory: path.dirname(importer),
    specifier,
    profile: "vite-production-import",
    contract: { packageName: specifier, version: stock.version, files: stock.entryMembers },
  });
  return selection?.entry === path.join(workspace, stock.directory, entry);
};

export const hasVerifiedViteKeyboardRegistration = (
  registration: { readonly source: string; readonly exportedName: string },
  context: RuleContext,
): boolean => {
  const project = getReactDoctorStringSetting(context.settings, "rootDirectory");
  if (!project || !context.filename || !path.isAbsolute(project)) return false;
  const filename = path.resolve(project, context.filename);
  const workspace = path.resolve(project, "../..");
  if (
    !/^packages\/[\w-]+$/u.test(path.relative(workspace, project)) ||
    !filename.endsWith(".ts") ||
    !isSourceFile(project, filename)
  ) {
    return false;
  }
  try {
    if (!isPhysicalDirectory(project)) return false;
    const helper = findHotkeysHelper(project, filename, registration.source);
    if (!helper || !hasUnshadowedSourceAncestors(helper, project)) return false;
    const source = context.getSourceText?.();
    if (
      !source ||
      readSource(filename) !== source ||
      !hasClosedKeyboardModuleInitialization(context.scopes.rootScope.node, context.scopes)
    )
      return false;
    const provider = readSource(helper);
    if (
      !provider ||
      !isDeferredHotkeysRegistrationExport(helper, provider, registration.exportedName)
    )
      return false;
    const entry = readLibraryEntry(project);
    return Boolean(
      entry &&
      entryReachesSource(project, entry, filename) &&
      rootHasNpmWorkspace(workspace, project) &&
      hasRootCompiler(workspace, project) &&
      resolvesStockLibraryImport(workspace, helper, "hotkeys-js", "dist/hotkeys-js.js") &&
      resolvesStockLibraryImport(workspace, filename, "react", "index.js"),
    );
  } catch {
    return false;
  }
};
