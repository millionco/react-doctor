import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { buildSourceProjectIndex } from "./build-source-project-index.js";
import {
  recordContentProbe,
  recordExistenceProbe,
  recordRealpathProbe,
} from "./cross-file-probe-recorder.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getModuleSpecifierName } from "./get-module-specifier-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { normalizeFilename } from "./normalize-filename.js";
import { parseSourceText } from "./parse-source-file.js";
import { readDeclaredViteAutoImportConfig } from "./read-declared-vite-auto-import.js";
import { hasStaticUnoCssTransformProfile } from "./read-declared-uno-css-transform-profile.js";
import { readProjectHtmlScripts } from "./read-project-html-scripts.js";
import {
  findNearestPackageDirectory,
  readPackageManifest,
} from "./read-nearest-package-manifest.js";
import type { PackageManifest } from "./read-nearest-package-manifest.js";
import { readViteIncomingDefaultCalls } from "./read-vite-incoming-default-calls.js";
import { resolveViteSource } from "./resolve-vite-source.js";
import { readsVerifiedPackageLauncher } from "./stock-vite-providers/reads-verified-package-launcher.js";
import type { RuleContext } from "./rule-context.js";
import type { StockPnpmInstalledClosure } from "./verify-stock-pnpm-installed-profile.js";
import { verifyStockPnpmInstalledProfile } from "./verify-stock-pnpm-installed-profile.js";
import { stockInstalledViteProfile } from "./stock-installed-vite-profile.js";

const readCurrentText = (filename: string): string | null => {
  recordExistenceProbe(filename);
  recordRealpathProbe(filename);
  if (
    !fs.lstatSync(filename, { throwIfNoEntry: false })?.isFile() ||
    fs.realpathSync(filename) !== filename
  )
    return null;
  recordContentProbe(filename);
  return fs.readFileSync(filename, "utf8");
};

const usesDefaultBuild = (manifest: PackageManifest): boolean =>
  typeof manifest.scripts?.build === "string" &&
  /^vite[ \t]+build$/u.test(manifest.scripts.build.trim()) &&
  !Object.hasOwn(manifest.scripts, "prebuild") &&
  !Object.hasOwn(manifest.scripts, "postbuild");

const isRegistryVersion = (value: unknown): boolean =>
  typeof value === "string" && /^[~^]?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value);

const declaresOnlyRegistryDependencies = (manifest: PackageManifest): boolean =>
  [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.optionalDependencies,
    manifest.peerDependencies,
  ].every(
    (table) =>
      table === undefined ||
      (table !== null &&
        typeof table === "object" &&
        !Array.isArray(table) &&
        Object.values(table).every(isRegistryVersion)),
  );

const verifiedInstalls = new WeakMap<RuleContext, StockPnpmInstalledClosure | null>();
const qualifiedInstallation = (
  root: string,
  context: RuleContext,
): StockPnpmInstalledClosure | null => {
  const stored = verifiedInstalls.get(context);
  if (stored !== undefined) return stored;
  const chosen = verifyStockPnpmInstalledProfile(root, stockInstalledViteProfile);
  verifiedInstalls.set(context, chosen);
  return chosen;
};
const knownCompilerImports = new Set([
  "vite",
  "unocss/vite",
  "@vitejs/plugin-react",
  "unplugin-auto-import/vite",
]);
const isQualifiedAmbientCompilerImport = (
  root: string,
  issuer: string,
  specifier: string,
): boolean =>
  (issuer === path.join(root, "vite.config.ts") &&
    (knownCompilerImports.has(specifier) || specifier === "path" || specifier === "node:path")) ||
  (issuer === path.join(root, "unocss.config.ts") && specifier === "unocss") ||
  specifier === "uno.css" ||
  specifier === "virtual:uno.css";

const qualifiedTypeScriptOptions = new Set([
  "target",
  "useDefineForClassFields",
  "lib",
  "module",
  "skipLibCheck",
  "moduleResolution",
  "allowImportingTsExtensions",
  "resolveJsonModule",
  "isolatedModules",
  "noEmit",
  "jsx",
  "strict",
  "forceConsistentCasingInFileNames",
  "noUnusedLocals",
  "noUnusedParameters",
  "noFallthroughCasesInSwitch",
  "paths",
  "allowJs",
  "esModuleInterop",
  "allowSyntheticDefaultImports",
]);
const hasQualifiedTypeScriptConfig = (root: string): boolean => {
  const raw = readCurrentText(path.join(root, "tsconfig.json"));
  if (raw === null) return false;
  const config = JSON.parse(raw) as {
    compilerOptions?: Record<string, unknown>;
    include?: unknown;
  };
  if (Object.keys(config).some((name) => name !== "include" && name !== "compilerOptions"))
    return false;
  const options = config.compilerOptions;
  if (
    !options ||
    Object.keys(options).some((name) => !qualifiedTypeScriptOptions.has(name)) ||
    options.jsx !== "react-jsx" ||
    options.module !== "ESNext" ||
    options.target !== "ESNext" ||
    options.moduleResolution !== "Node"
  )
    return false;
  return (
    JSON.stringify(options.paths) === '{"~/*":["./src/*"]}' &&
    JSON.stringify(config.include) === '["./src"]'
  );
};

const hasNoNestedCompilerConfig = (root: string, sourceFile: string): boolean => {
  for (let current = path.dirname(sourceFile); current !== root; current = path.dirname(current)) {
    if (current === path.dirname(current)) return false;
    for (const name of [
      "package.json",
      "tsconfig.json",
      "jsconfig.json",
      ".babelrc",
      ".babelrc.json",
      ".babelrc.js",
      ".babelrc.cjs",
      ".babelrc.mjs",
      "babel.config.js",
      "babel.config.cjs",
      "babel.config.mjs",
    ]) {
      const filename = path.join(current, name);
      recordExistenceProbe(filename);
      if (fs.lstatSync(filename, { throwIfNoEntry: false })) return false;
    }
  }
  return true;
};

export const hasViteDefaultCallSourceProof = (
  context: RuleContext,
  owner: EsTreeNodeOfType<"FunctionDeclaration">,
  parameterIndex: number,
): boolean => {
  const programNode = context.scopes.rootScope.node;
  if (
    !context.filename ||
    !path.isAbsolute(context.filename) ||
    !isNodeOfType(programNode, "Program")
  )
    return false;
  const sourceFile = normalizeFilename(context.filename);
  const root = findNearestPackageDirectory(sourceFile);
  if (!root || path.relative(root, sourceFile).startsWith(".." + path.sep)) return false;
  const manifest = readPackageManifest(root);
  if (
    manifest?.private !== true ||
    manifest.type !== "module" ||
    ["browser", "exports", "main", "module", "imports"].some((key) =>
      Object.hasOwn(manifest, key),
    ) ||
    !usesDefaultBuild(manifest) ||
    !declaresOnlyRegistryDependencies(manifest) ||
    (process.env.NODE_ENV !== undefined && process.env.NODE_ENV !== "production") ||
    ["NODE_OPTIONS", "NODE_PATH", "ESBUILD_BINARY_PATH"].some(
      (name) => process.env[name] !== undefined,
    )
  )
    return false;
  try {
    for (const name of [
      ".env",
      ".env.local",
      ".env.production",
      ".env.production.local",
      "vite.config.js",
      "vite.config.mjs",
      "vite.config.cjs",
      "vite.config.mts",
      "vite.config.cts",
      "jsconfig.json",
      ".babelrc",
      ".babelrc.json",
      ".babelrc.js",
      ".babelrc.cjs",
      ".babelrc.mjs",
      "babel.config.js",
      "babel.config.cjs",
      "babel.config.mjs",
    ]) {
      const candidate = path.join(root, name);
      recordExistenceProbe(candidate);
      if (fs.lstatSync(candidate, { throwIfNoEntry: false })) return false;
    }
    const filename = path.join(root, "vite.config.ts");
    const rawConfig = readCurrentText(filename);
    if (rawConfig === null) return false;
    const config = parseSourceText({ filename, sourceText: rawConfig });
    if (!config) return false;
    const profile = readDeclaredViteAutoImportConfig(config, analyzeScopes(config));
    if (
      !profile ||
      profile.aliases.length !== 1 ||
      profile.aliases[0]?.find !== "~" ||
      profile.aliases[0]?.relativeReplacement !== "src" ||
      !hasQualifiedTypeScriptConfig(root)
    )
      return false;
    const unoPath = path.join(root, "unocss.config.ts");
    const unoText = readCurrentText(unoPath);
    if (unoText === null) return false;
    const uno = parseSourceText({ filename: unoPath, sourceText: unoText });
    if (!uno || !hasStaticUnoCssTransformProfile(uno, analyzeScopes(uno))) return false;
    const html = path.join(root, "index.html");
    const startup = readProjectHtmlScripts(root, html, {
      externalLocalModulesOnly: true,
      rejectHtmlTemplates: true,
      readSource: readCurrentText,
    });
    if (!startup || startup.localEntrypoints.length !== 1) return false;
    const installed = qualifiedInstallation(root, context);
    const vitePackage = installed?.packageDirectories.get(stockInstalledViteProfile.roots.vite);
    if (
      !installed ||
      !vitePackage ||
      !readsVerifiedPackageLauncher({
        projectRoot: root,
        projectDirectory: root,
        packageDirectory: vitePackage,
        binary: "vite",
      })
    )
      return false;
    const index = buildSourceProjectIndex({
      rootDirectory: root,
      currentFilePath: sourceFile,
      currentProgramNode: programNode,
      currentScopes: context.scopes,
      includeTestlikeSources: true,
      readEmittedSource: (file) => (file === sourceFile ? undefined : readCurrentText(file)),
      readTypedRuntimeEdge: (module, node, imported) => {
        if (!imported) return null;
        const specifierPath = imported.split(/[?#]/u, 1)[0];
        if (
          specifierPath?.startsWith("/@fs/") ||
          specifierPath?.startsWith(normalizeFilename(root) + "/")
        )
          return { kind: "opaque" };
        const resolution = resolveViteSource({
          projectDirectory: root,
          fromFilename: module.filePath,
          specifier: imported,
          aliases: profile.aliases.map(({ find, relativeReplacement }) => ({
            find,
            replacement: path.join(root, relativeReplacement),
          })),
          probe: (candidate) => {
            recordExistenceProbe(candidate);
            const stat = fs.lstatSync(candidate, { throwIfNoEntry: false });
            if (stat?.isFile()) return "file";
            if (stat?.isDirectory()) return "directory";
            return stat ? "unknown" : "missing";
          },
        });
        if (resolution.kind === "file") return { kind: "file", filename: resolution.filename };
        if (resolution.kind === "external") {
          if (
            isQualifiedAmbientCompilerImport(root, module.filePath, imported) ||
            installed.hasRuntimeRootSpecifier(imported, module.filePath)
          )
            return { kind: "external" };
          return { kind: "opaque" };
        }
        if (
          resolution.kind === "missing" &&
          /\.(?:css|png|svg|webp|woff2?|jpe?g|ico|mp3|wav)$/iu.test(imported)
        ) {
          return { kind: "external" };
        }
        if (
          resolution.kind === "missing" &&
          isNodeOfType(node, "ImportDeclaration") &&
          node.specifiers.length > 0 &&
          node.specifiers.every(
            (item) => module.scopes.symbolFor(item.local)?.references.length === 0,
          )
        ) {
          return { kind: "erased" };
        }
        return { kind: "opaque" };
      },
    });
    if (
      !index ||
      index.htmlFilePaths.length !== 1 ||
      !index.modulesByFilePath.has(startup.localEntrypoints[0] ?? "")
    )
      return false;
    const definingModule = index.modulesByFilePath.get(sourceFile);
    if (
      !definingModule ||
      [...index.modulesByFilePath.keys()].some(
        (filename) => !hasNoNestedCompilerConfig(root, filename),
      )
    )
      return false;
    const candidates = [...index.modulesByFilePath.values()].filter((module) => {
      const relative = path.relative(root, module.filePath).split(path.sep).join("/");
      return profile.dirs.some((directory) =>
        relative.startsWith(directory.replace(/\/\*\*$/u, "") + "/"),
      );
    });
    const seen = new Set<string>();
    for (const module of candidates) {
      if (seen.has(module.filePath)) continue;
      seen.add(module.filePath);
      if (
        module.scopes.rootScope.symbolsByName.has("useEffect") ||
        /^use[-_]?effect\.[cm]?[jt]sx?$/iu.test(path.basename(module.filePath))
      )
        return false;
      for (const statement of module.programNode.body) {
        if (
          !isNodeOfType(statement, "ExportAllDeclaration") &&
          !isNodeOfType(statement, "ExportNamedDeclaration")
        )
          continue;
        if (statement.exportKind === "type") continue;
        if (
          isNodeOfType(statement, "ExportNamedDeclaration") &&
          statement.specifiers.some(
            (specifier) =>
              specifier.exportKind !== "type" &&
              getModuleSpecifierName(specifier.exported) === "useEffect",
          )
        )
          return false;
        if (
          !statement.source ||
          (isNodeOfType(statement, "ExportNamedDeclaration") &&
            statement.specifiers.length > 0 &&
            statement.specifiers.every((specifier) => specifier.exportKind === "type"))
        )
          continue;
        const selected = index.resolvedSourcePathByNode.get(statement);
        const target = selected ? index.modulesByFilePath.get(selected) : undefined;
        if (!target) return false;
        candidates.push(target);
      }
    }
    return (
      readViteIncomingDefaultCalls({
        index,
        definingModule,
        functionNode: owner,
        parameterIndex,
      }) !== null
    );
  } catch {
    return false;
  }
};
