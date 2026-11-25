import * as fs from "node:fs";
import * as path from "node:path";
import type { StaticExportEntry } from "oxc-parser";
import type { SourceProjectModule } from "./build-source-project-index.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { getRuntimeStaticDependencySource } from "./get-runtime-static-dependency-source.js";
import { recordExistenceProbe } from "./cross-file-probe-recorder.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { hasClosedStockReactObjectReferences } from "./has-closed-stock-react-object-references.js";
import {
  hasExpectedNpmLauncher,
  hasStockNodeNpmCompilerEnvironment,
} from "./has-stock-node-npm-compiler-environment.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isPathInside } from "./is-path-inside.js";
import { parseSourceText } from "./parse-source-file.js";
import { readNamedVite8StylesheetGraph } from "./read-named-vite8-stylesheet-graph.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import { parseTsconfigJson } from "./resolve-tsconfig-alias.js";
import {
  haveNoPhysicalPackageCandidates,
  readProviderMember,
  resolveStockPhysicalEntry,
} from "./stock-vite-providers/resolve-stock-physical-entry.js";
import { resolveViteSource, type EntryKind } from "./resolve-vite-source.js";
import {
  verifyStockNpmCompilerPackages,
  type StockNpmCompilerProfile,
} from "./verify-stock-npm-compiler-packages.js";

const SCRIPT_NAME = "dev:build";
const BUILD_COMMAND = "vite build --config dev/vite.config.ts";
const DECLARED_COMPILER_OPTIONS = {
  target: "ES2022",
  module: "ESNext",
  moduleResolution: "bundler",
  jsx: "react-jsx",
  verbatimModuleSyntax: true,
  noEmit: true,
};
const JSX_PRAGMA = /@jsx(?:Runtime|ImportSource|Frag)?\b/u;
const EXTERNAL_SOURCES = new Map([
  ["react", ["react", "index.js"]],
  ["react/jsx-runtime", ["react", "jsx-runtime.js"]],
  ["react-dom", ["react-dom", "index.js"]],
  ["react-dom/client", ["react-dom", "client.js"]],
]);

const stat = (filename: string) => {
  recordExistenceProbe(filename);
  return fs.lstatSync(filename, { throwIfNoEntry: false });
};

const readSource = (filename: string): string | null =>
  stat(filename)?.isFile() ? (readProviderMember(filename)?.toString("utf8") ?? null) : null;

const record = (value: unknown): Readonly<Record<string, unknown>> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;

const readJson = (filename: string): Readonly<Record<string, unknown>> | null => {
  const source = readSource(filename);
  return source ? record(JSON.parse(source)) : null;
};

const readFields = (node: EsTreeNode | undefined): Map<string, EsTreeNode> | null => {
  if (!isNodeOfType(node, "ObjectExpression")) return null;
  const fields = new Map<string, EsTreeNode>();
  for (const item of node.properties) {
    if (!isNodeOfType(item, "Property") || item.kind !== "init" || item.computed) return null;
    const key = getStaticPropertyKeyName(item);
    if (key === null || fields.has(key)) return null;
    fields.set(key, item.value);
  }
  return fields;
};

const hasVerifiedConfigShape = (filename: string, text: string | null): boolean => {
  if (!text) return false;
  const program = parseSourceText({ filename, sourceText: text });
  if (!isNodeOfType(program, "Program") || program.body.length !== 4) return false;
  const [framework, react, css, exported] = program.body;
  if (
    !isNodeOfType(framework, "ImportDeclaration") ||
    framework.source.value !== "vite" ||
    !isNodeOfType(react, "ImportDeclaration") ||
    react.source.value !== "@vitejs/plugin-react" ||
    !isNodeOfType(css, "ImportDeclaration") ||
    css.source.value !== "autoprefixer" ||
    program.body
      .slice(0, 3)
      .some(
        (statement) =>
          !isNodeOfType(statement, "ImportDeclaration") ||
          statement.importKind === "type" ||
          statement.specifiers.length !== 1,
      ) ||
    !isNodeOfType(exported, "ExportDefaultDeclaration")
  )
    return false;
  const scopes = analyzeScopes(program);
  const matchesCall = (
    node: EsTreeNode | undefined,
    origin: string,
    name: string,
    argumentsCount: number,
  ) => {
    if (
      !isNodeOfType(node, "CallExpression") ||
      node.optional ||
      node.arguments.length !== argumentsCount
    )
      return false;
    const binding = resolveImportedApiReference(node.callee, scopes);
    return binding?.source === origin && binding.importedName === name;
  };
  const call = exported.declaration;
  if (!isNodeOfType(call, "CallExpression") || !matchesCall(call, "vite", "defineConfig", 1))
    return false;
  const options = readFields(call.arguments[0]);
  if (
    !options ||
    [...options.keys()].some((key) => !["root", "plugins", "css", "server", "build"].includes(key))
  )
    return false;
  const root = options.get("root");
  const plugins = options.get("plugins");
  const cssOptions = readFields(options.get("css"));
  const postcss = readFields(cssOptions?.get("postcss"));
  const postcssPlugins = postcss?.get("plugins");
  const output = readFields(options.get("build"));
  const sourcemap = output?.get("sourcemap");
  const server = readFields(options.get("server"));
  const allowedHosts = server?.get("allowedHosts");
  return (
    isNodeOfType(root, "Literal") &&
    root.value === "dev" &&
    isNodeOfType(plugins, "ArrayExpression") &&
    plugins.elements.length === 1 &&
    matchesCall(plugins.elements[0] ?? undefined, "@vitejs/plugin-react", "default", 0) &&
    cssOptions?.size === 1 &&
    postcss?.size === 1 &&
    isNodeOfType(postcssPlugins, "ArrayExpression") &&
    postcssPlugins.elements.length === 1 &&
    matchesCall(postcssPlugins.elements[0] ?? undefined, "autoprefixer", "default", 0) &&
    (!options.has("build") ||
      (output?.size === 1 &&
        isNodeOfType(sourcemap, "Literal") &&
        typeof sourcemap.value === "boolean")) &&
    (!options.has("server") ||
      (server?.size === 1 &&
        isNodeOfType(allowedHosts, "ArrayExpression") &&
        allowedHosts.elements.length > 0 &&
        allowedHosts.elements.every(
          (item) =>
            item !== null && isNodeOfType(item, "Literal") && typeof item.value === "string",
        )))
  );
};

const DECLARED_EXTRA_COMPILER_OPTIONS = {
  skipLibCheck: true,
  types: ["vite/client"],
  lib: ["ES2022", "DOM", "DOM.Iterable"],
  useDefineForClassFields: true,
  allowImportingTsExtensions: true,
  moduleDetection: "force",
  strict: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
  erasableSyntaxOnly: true,
  noFallthroughCasesInSwitch: true,
  noUncheckedSideEffectImports: true,
};

const DECLARED_ROOT_COMPILER_OPTIONS = {
  strict: true,
  target: "ES2018",
  module: "ES2015",
  jsx: "react",
  lib: ["ES2020", "dom"],
  moduleResolution: "node",
  isolatedModules: true,
  skipLibCheck: true,
  forceConsistentCasingInFileNames: true,
  types: ["vitest/globals"],
};

const matchesConfigValue = (actual: unknown, expected: unknown): boolean =>
  Array.isArray(expected)
    ? Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((item, index) => actual[index] === item)
    : actual === expected;

// The verified plugin selects automatic JSX for this named Vite build.
const hasDeclaredRootCompilerOptions = (sourceText: string | null): boolean => {
  const config = sourceText && parseTsconfigJson(sourceText);
  if (
    !config ||
    Object.keys(config).length !== 2 ||
    !matchesConfigValue(config.exclude, ["dev", "dist"])
  )
    return false;
  const options = record(config.compilerOptions);
  return Boolean(
    options &&
    Object.keys(options).length === Object.keys(DECLARED_ROOT_COMPILER_OPTIONS).length &&
    Object.entries(DECLARED_ROOT_COMPILER_OPTIONS).every(([key, value]) =>
      matchesConfigValue(options[key], value),
    ),
  );
};

const hasDeclaredCompilerOptions = (sourceText: string | null): boolean => {
  const config = sourceText && parseTsconfigJson(sourceText);
  if (!config || Object.keys(config).length !== 1) return false;
  const options = record(config.compilerOptions);
  if (!options) return false;
  if (!Object.entries(DECLARED_COMPILER_OPTIONS).every(([key, value]) => options[key] === value))
    return false;
  return Object.entries(options).every(([key, value]) => {
    if (Object.hasOwn(DECLARED_COMPILER_OPTIONS, key)) return true;
    if (!Object.hasOwn(DECLARED_EXTRA_COMPILER_OPTIONS, key)) return false;
    const expected =
      DECLARED_EXTRA_COMPILER_OPTIONS[key as keyof typeof DECLARED_EXTRA_COMPILER_OPTIONS];
    return matchesConfigValue(value, expected);
  });
};

// Only inert head metadata and one module entry under the already proved Vite root.
const hasVerifiedHtmlEntry = (text: string | null): boolean => {
  if (!text) return false;
  const minimal =
    '<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="./index.tsx"></script>';
  if (text.trim() === minimal) return true;
  return /^\s*<!doctype html>\s*<html lang="[a-z-]+">\s*<head>\s*<meta charset="utf-8"\s*\/?>\s*<meta name="viewport" content="width=device-width, initial-scale=1.0"\s*\/?>\s*<meta name="theme-color" content="#[a-f0-9]{6}"\s*\/?>\s*<title>[^<>&]+<\/title>\s*<\/head>\s*<body>\s*<div id="root"><\/div>\s*<script type="module" src="\/index\.tsx"><\/script>\s*<\/body>\s*<\/html>\s*$/u.test(
    text,
  );
};

const hasDefaultStylesheetTargets = (root: string, file: string): boolean => {
  for (let directory = path.dirname(file); ; directory = path.dirname(directory)) {
    if ([".browserslistrc", "browserslist"].some((name) => stat(path.join(directory, name))))
      return false;
    if (directory !== root && stat(path.join(directory, "package.json"))) return false;
    if (path.dirname(directory) === directory) return true;
  }
};

const isDeclaredCompilerConfiguration = (root: string): boolean => {
  const manifest = readJson(path.join(root, "package.json"));
  const scripts = record(manifest?.scripts);
  if (
    !manifest ||
    manifest.type !== "module" ||
    scripts?.[SCRIPT_NAME] !== BUILD_COMMAND ||
    Object.hasOwn(scripts, "pre" + SCRIPT_NAME) ||
    Object.hasOwn(scripts, "post" + SCRIPT_NAME) ||
    ["browser", "imports", "workspaces", "overrides", "resolutions", "browserslist"].some((key) =>
      Object.hasOwn(manifest, key),
    )
  )
    return false;
  for (const directory of [root, path.join(root, "dev")]) {
    if (
      [
        ".env",
        ".env.local",
        ".env.production",
        ".env.production.local",
        "postcss.config.js",
        "postcss.config.cjs",
        "postcss.config.mjs",
        ".postcssrc",
        ".postcssrc.json",
        "babel.config.js",
        ".babelrc",
      ].some((entry) => stat(path.join(directory, entry)))
    )
      return false;
  }
  const config = path.join(root, "dev", "vite.config.ts");
  const rootConfig = path.join(root, "tsconfig.json");
  return (
    (!stat(rootConfig) || hasDeclaredRootCompilerOptions(readSource(rootConfig))) &&
    hasDeclaredCompilerOptions(readSource(path.join(root, "dev", "tsconfig.json"))) &&
    hasVerifiedConfigShape(config, readSource(config))
  );
};

const hasStockJsxRender = (program: EsTreeNode): boolean => {
  if (!isNodeOfType(program, "Program")) return false;
  // React DOM captures the hook dependency comparator at module initialization.
  const firstRendererOrAppImport = program.body
    .map(getRuntimeStaticDependencySource)
    .find((source) => source && source !== "react" && source !== "react/jsx-runtime");
  if (firstRendererOrAppImport !== "react-dom/client") return false;

  const scopes = analyzeScopes(program);
  let renderCount = 0;
  walkAst(program, (node) => {
    if (
      !isNodeOfType(node, "CallExpression") ||
      node.optional ||
      node.parent?.parent !== program ||
      !isNodeOfType(node.callee, "MemberExpression") ||
      node.callee.optional ||
      node.callee.computed ||
      !isNodeOfType(node.callee.property, "Identifier") ||
      node.callee.property.name !== "render" ||
      node.arguments.length !== 1 ||
      !isNodeOfType(node.arguments[0], "JSXElement")
    )
      return;
    const createRoot = node.callee.object;
    if (
      !isNodeOfType(createRoot, "CallExpression") ||
      createRoot.optional ||
      createRoot.arguments.length !== 1
    )
      return;
    const provider = resolveImportedApiReference(createRoot.callee, scopes);
    if (provider?.source !== "react-dom/client" || provider.importedName !== "createRoot") return;
    const container = stripParenExpression(createRoot.arguments[0]);
    if (
      !isNodeOfType(container, "CallExpression") ||
      container.optional ||
      !isNodeOfType(container.callee, "MemberExpression") ||
      container.callee.optional ||
      container.callee.computed ||
      !isNodeOfType(container.callee.property, "Identifier") ||
      container.callee.property.name !== "getElementById" ||
      !isNodeOfType(container.callee.object, "Identifier") ||
      container.callee.object.name !== "document" ||
      !scopes.isGlobalReference(container.callee.object) ||
      container.arguments.length !== 1 ||
      !isNodeOfType(container.arguments[0], "Literal") ||
      container.arguments[0].value !== "root"
    )
      return;
    renderCount++;
  });
  return renderCount === 1;
};

const hasGeneratedJsxImport = (program: EsTreeNode): boolean => {
  let hasJsx = false;
  walkAst(program, (node) => {
    if (isNodeOfType(node, "JSXElement") || isNodeOfType(node, "JSXFragment")) hasJsx = true;
    if (hasJsx) return false;
  });
  return hasJsx;
};

const resolveStockPackage = (
  root: string,
  issuer: string,
  specifier: string,
  packageName: string,
  entry: string,
  profile: StockNpmCompilerProfile,
  mode: "vite-production-import" | "node-import" = "vite-production-import",
) => {
  const directory = "node_modules/" + packageName;
  const proof = profile.packages.find((candidate) => candidate.directory === directory);
  if (!proof) return false;
  const selected = resolveStockPhysicalEntry({
    projectRoot: root,
    importerDirectory: issuer,
    specifier,
    profile: mode,
    contract: { packageName, version: proof.version, files: proof.entryMembers },
  });
  return selected?.entry === path.join(root, directory, entry);
};

const probeEntry = (filename: string): EntryKind => {
  const state = stat(filename);
  return state?.isFile()
    ? "file"
    : state?.isDirectory()
      ? "directory"
      : state
        ? "unknown"
        : "missing";
};

const hasOpenModuleAcquisition = (
  program: EsTreeNode,
  scopes: ReturnType<typeof analyzeScopes>,
): boolean => {
  let open = false;
  walkAst(program, (node) => {
    if (open) return false;
    if (
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "WithStatement") ||
      (isNodeOfType(node, "Identifier") &&
        ["eval", "Function"].includes(node.name) &&
        scopes.isGlobalReference(node))
    )
      open = true;
    return !open;
  });
  return open;
};

export interface NamedViteSourceModule extends SourceProjectModule {
  readonly staticExports: readonly StaticExportEntry[];
  readonly localImports: ReadonlyMap<string, string>;
}

export interface NamedViteSourceProject {
  readonly root: string;
  readonly entry: string;
  readonly focal: string;
  readonly modulesByFilePath: ReadonlyMap<string, NamedViteSourceModule>;
}

interface NamedViteVerificationOptions {
  readonly onReject?: (reason: string) => void;
  readonly collectSourceProject?: boolean;
}

export const readNamedVite8CallbackCompiler = (
  root: string,
  focal: string,
  source: string,
  profile: StockNpmCompilerProfile,
  options?: NamedViteVerificationOptions,
) => {
  const reject = (reason: string) => {
    options?.onReject?.(reason);
    return null;
  };
  const dev = path.join(root, "dev");
  if (!path.isAbsolute(root) || !path.isAbsolute(focal) || !isPathInside(focal, root))
    return reject("path scope");

  try {
    if (fs.realpathSync(root) !== root || !isDeclaredCompilerConfiguration(root))
      return reject("declared config");
    if (!hasStockNodeNpmCompilerEnvironment(root)) return reject("node/npm environment");
    if (
      Object.entries(process.env).some(
        ([name, value]) => value && /^(?:NAPI_RS_|ROLLDOWN_|OXC_)/iu.test(name),
      )
    )
      return reject("native compiler environment");
    const launcher = path.join(root, "node_modules", ".bin", "vite");
    recordExistenceProbe(launcher);

    if (!hasExpectedNpmLauncher(launcher, "../vite/bin/vite.js")) return reject("launcher");
    const configurationIssuers = [
      ["vite", "dist/node/index.js"],
      ["@vitejs/plugin-react", "dist/index.js"],
      ["autoprefixer", "lib/autoprefixer.js"],
    ] as const;
    for (const [specifier, entry] of configurationIssuers) {
      if (!resolveStockPackage(root, dev, specifier, specifier, entry, profile, "node-import"))
        return reject("configuration provider");
    }
    if (readSource(focal) !== source) return reject("focal source");
    const html = readSource(path.join(dev, "index.html"));
    if (!hasVerifiedHtmlEntry(html)) return reject("html");
    const entry = path.join(dev, "index.tsx");
    const pending = [entry];
    const sourceModules = options?.collectSourceProject
      ? new Map<string, NamedViteSourceModule>()
      : undefined;
    const reachable = new Set<string>();
    const verifiedStyles = new Set<string>();
    let usedRenderer = false;
    while (pending.length) {
      const filename = pending.pop()!;
      if (reachable.has(filename)) continue;
      if (
        reachable.size >= 512 ||
        ![dev, path.join(root, "src")].some((directory) => isPathInside(filename, directory)) ||
        !/\.[jt]sx?$/u.test(filename) ||
        /\.d\.ts$/u.test(filename)
      )
        return reject("source area");
      reachable.add(filename);
      const text = readSource(filename);
      if (text === null || JSX_PRAGMA.test(text)) return reject("per-file JSX settings");
      let staticExports: readonly StaticExportEntry[] = [];
      const program = parseSourceText({
        filename,
        sourceText: text,
        readModule: sourceModules
          ? (module) => {
              staticExports = module.staticExports.flatMap((statement) => statement.entries);
            }
          : undefined,
      });
      if (!isNodeOfType(program, "Program")) return reject("source parse");
      const scopes = analyzeScopes(program);
      if (filename === entry && !hasStockJsxRender(program)) return reject("entry root renderer");
      if (
        hasOpenModuleAcquisition(program, scopes) ||
        !hasClosedStockReactObjectReferences(program, scopes, undefined, true)
      )
        return reject("source provider references");
      const issuer = path.dirname(filename);
      if (
        hasGeneratedJsxImport(program) &&
        !resolveStockPackage(root, issuer, "react/jsx-runtime", "react", "jsx-runtime.js", profile)
      )
        return reject("implicit JSX provider");

      for (let directory = issuer; directory !== root; directory = path.dirname(directory)) {
        if (stat(path.join(directory, "package.json"))) return reject("nested package");
        if (directory !== dev && stat(path.join(directory, "tsconfig.json")))
          return reject("nested config");
      }
      if (!isPathInside(filename, dev)) {
        for (let directory = path.dirname(root); ; directory = path.dirname(directory)) {
          if (stat(path.join(directory, "tsconfig.json")))
            return reject("ancestor TypeScript config");
          if (path.dirname(directory) === directory) break;
        }
      }

      const localImports = sourceModules ? new Map<string, string>() : undefined;
      for (const statement of program.body) {
        const specifier = getRuntimeStaticDependencySource(statement);
        if (!specifier) continue;
        if (/\.(?:css|scss|sass)(?:$|[?#])/iu.test(specifier)) {
          if (!isNodeOfType(statement, "ImportDeclaration") || statement.specifiers.length !== 0)
            return reject("stylesheet import");
          const styles = readNamedVite8StylesheetGraph(root, filename, specifier);
          if (!styles) return reject("stylesheet graph");
          for (const file of styles) verifiedStyles.add(file);
          continue;
        }
        const result = resolveViteSource({
          fromFilename: filename,
          projectDirectory: root,
          aliases: [],
          specifier,
          probe: probeEntry,
        });
        if (result.kind === "file") {
          localImports?.set(specifier, result.filename);
          pending.push(result.filename);
          continue;
        }
        const selected = EXTERNAL_SOURCES.get(specifier);
        if (
          result.kind !== "external" ||
          !selected ||
          !resolveStockPackage(root, issuer, specifier, selected[0], selected[1], profile)
        )
          return reject("React issuer or module edge");
        usedRenderer ||= specifier === "react-dom/client";
      }
      if (localImports) {
        sourceModules?.set(filename, {
          filePath: filename,
          programNode: program,
          scopes,
          staticExports,
          localImports,
        });
      }
    }
    if (!reachable.has(focal) || !usedRenderer) return reject("entry closure");
    const styles = [...verifiedStyles];
    if (
      styles.length &&
      (Object.entries(process.env).some(
        ([name, value]) => value && /^(?:BROWSERSLIST(?:_|$)|SASS_)/u.test(name),
      ) ||
        !styles.every((filename) => hasDefaultStylesheetTargets(root, filename)))
    )
      return reject("stylesheet compiler options");
    if (styles.some((filename) => filename.endsWith(".scss"))) {
      const sass = profile.packages.find((item) => item.directory === "node_modules/sass");
      const viteIssuer = path.join(root, "node_modules", "vite", "dist", "node", "chunks");
      if (
        sass?.version !== "1.99.0" ||
        !haveNoPhysicalPackageCandidates([dev, viteIssuer], "sass-embedded") ||
        !resolveStockPackage(root, dev, "sass", "sass", "sass.node.mjs", profile, "node-import")
      )
        return reject("Sass provider");
    }
    if (!verifyStockNpmCompilerPackages(root, profile)) return reject("npm package graph");
    return {
      buildScript: SCRIPT_NAME,
      configuration: path.join(dev, "vite.config.ts"),
      entry,
      focal,
      sourceGraphSize: reachable.size + verifiedStyles.size,
      sourceProject: sourceModules
        ? { root, entry, focal, modulesByFilePath: sourceModules }
        : undefined,
    };
  } catch {
    return reject("thrown verifier error");
  }
};
