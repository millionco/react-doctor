import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { analyzeScopes, type ScopeAnalysis } from "../semantic/scope-analysis.js";
import { recordContentProbe, recordExistenceProbe } from "./cross-file-probe-recorder.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getReactDoctorStringSetting } from "./get-react-doctor-setting.js";
import { getRuntimeStaticDependencySource } from "./get-runtime-static-dependency-source.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isPathInside } from "./is-path-inside.js";
import { isSymbolReadOnly } from "./is-symbol-read-only.js";
import { normalizeFilename } from "./normalize-filename.js";
import { parseSourceFile } from "./parse-source-file.js";
import {
  findNearestPackageDirectory,
  readPackageManifest,
} from "./read-nearest-package-manifest.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import { resolveModulePath } from "./resolve-module-path.js";
import type { RuleContext } from "./rule-context.js";
import { walkAst } from "./walk-ast.js";

const EMBLA_HOOK = "embla-carousel-react";
const EMBLA_CORE = "embla-carousel";
const EMBLA_AUTOPLAY = "embla-carousel-autoplay";
const EMBLA_UTILS = "embla-carousel-reactive-utils";
const EMBLA_VERSION = "8.6.0";
const MAX_PROJECT_MODULES = 64;
const MAX_METADATA_BYTES = 1_000_000;
const CONFIG_EXTENSIONS = ["js", "mjs", "ts", "mts", "cjs", "cts"];
const SOURCE_EXTENSIONS = [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json", ".cjs", ".cts"];
const STATIC_ASSET = /\.(?:avif|gif|jpe?g|mp4|png|webm|webp|woff2?)$/iu;
const REGISTRY_SELECTOR = /^[~^]?\d+\.\d+\.\d+$/u;
const STOCK_APPLICATION_IMPORTS = new Set([
  "react",
  "react-dom",
  "react-dom/client",
  "@vercel/analytics",
  EMBLA_HOOK,
  EMBLA_CORE,
  EMBLA_AUTOPLAY,
]);
const STOCK_POSTCSS_PLUGINS = new Set(["autoprefixer", "postcss-preset-env", "tailwindcss"]);
const RESOLUTION_MARKERS = [
  ".npmrc",
  ".yarnrc",
  ".yarnrc.yml",
  ".pnp.cjs",
  ".pnp.loader.mjs",
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "bun.lock",
  "bun.lockb",
  "tsconfig.json",
  "jsconfig.json",
];
const ANCESTOR_RESOLUTION_MARKERS = [
  ".npmrc",
  ".yarnrc",
  ".yarnrc.yml",
  ".pnp.cjs",
  ".pnp.loader.mjs",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "jsconfig.json",
];
const PACKAGE_RESOLUTION_FIELDS = [
  "alias",
  "browser",
  "imports",
  "overrides",
  "patchedDependencies",
  "pnpm",
  "postcss",
  "resolutions",
  "workspaces",
];
const EMBLA_INTEGRITY: Readonly<Record<string, string>> = {
  [EMBLA_HOOK]:
    "sha512-0/PjqU7geVmo6F734pmPqpyHqiM99olvyecY7zdweCw+6tKEXnrE90pBiBbMMU8s5tICemzpQ3hi5EpxzGW+JA==",
  [EMBLA_CORE]:
    "sha512-SjWyZBHJPbqxHOzckOfo8lHisEaJWmwd23XppYFYVh10bU66/Pn5tkVkbkCMZVdbUE5eTCI2nD8OyIP4Z+uwkA==",
  [EMBLA_AUTOPLAY]:
    "sha512-OBu5G3nwaSXkZCo1A6LTaFMZ8EpkYbwIaH+bPqdBnDGQ2fh4+NbzjXjs2SktoPNKCtflfVMc75njaDHOYXcrsA==",
  [EMBLA_UTILS]:
    "sha512-fMVUDUEx0/uIEDM0Mz3dHznDhfX+znCCDCeIophYb1QGVM7YThSWX+wz11zlYwWFOr74b4QLGg0hrGPJeG2s4A==",
};

type Package = NonNullable<ReturnType<typeof readPackageManifest>>;

const entryAt = (filename: string) => {
  recordExistenceProbe(filename);
  return lstatSync(filename, { throwIfNoEntry: false });
};

const readPlainText = (filename: string): string | null => {
  const entry = entryAt(filename);
  if (!entry?.isFile() || entry.size > MAX_METADATA_BYTES) return null;
  recordContentProbe(filename);
  return readFileSync(filename, "utf8");
};

const directDependency = (
  manifest: Package,
  name: string,
  developmentAllowed = false,
): string | null => {
  if (
    manifest.optionalDependencies?.[name] !== undefined ||
    manifest.peerDependencies?.[name] !== undefined
  )
    return null;
  const runtime = manifest.dependencies?.[name];
  const development = manifest.devDependencies?.[name];
  if (runtime !== undefined && development !== undefined) return null;
  const selector = runtime ?? (developmentAllowed ? development : undefined);
  return typeof selector === "string" && REGISTRY_SELECTOR.test(selector) ? selector : null;
};

const isUnredirectedPackage = (manifest: Package): boolean =>
  PACKAGE_RESOLUTION_FIELDS.every((field) => !Object.hasOwn(manifest, field));

const hasUnredirectedBuildBoundary = (
  packageRoot: string,
  configuredRoot: string | undefined,
): boolean => {
  if (configuredRoot === undefined) return true;
  const scanRoot = normalizeFilename(resolve(configuredRoot));
  if (scanRoot === packageRoot) return true;
  if (!isPathInside(packageRoot, scanRoot)) return false;

  // The package is an independently declared Vite build. An enclosing scan
  // root does not change its CWD, but may declare a workspace/provider redirect.
  let directory = normalizeFilename(dirname(packageRoot));
  while (true) {
    if (
      ANCESTOR_RESOLUTION_MARKERS.some((name) => entryAt(join(directory, name))) ||
      CONFIG_EXTENSIONS.some((extension) => entryAt(join(directory, `vite.config.${extension}`)))
    )
      return false;
    const packageEntry = entryAt(join(directory, "package.json"));
    if (packageEntry) {
      if (!packageEntry.isFile()) return false;
      const manifest = readPackageManifest(directory);
      if (!manifest || !isUnredirectedPackage(manifest)) return false;
      const directProviderNames = [
        "react",
        "react-dom",
        "vite",
        "@vitejs/plugin-react",
        EMBLA_CORE,
        EMBLA_HOOK,
        EMBLA_UTILS,
        EMBLA_AUTOPLAY,
      ];
      if (
        directProviderNames.some((name) => {
          const hasDeclaration = [
            manifest.dependencies,
            manifest.devDependencies,
            manifest.optionalDependencies,
            manifest.peerDependencies,
          ].some((source) => source?.[name] !== undefined);
          return hasDeclaration && !directDependency(manifest, name, true);
        })
      )
        return false;
    }
    if (directory === scanRoot) return true;
    const parent = normalizeFilename(dirname(directory));
    if (parent === directory) return false;
    directory = parent;
  }
};

const readStockBuildPackage = (rootDirectory: string): Package | null => {
  if (!entryAt(join(rootDirectory, "package.json"))?.isFile()) return null;
  const manifest = readPackageManifest(rootDirectory);
  if (!manifest || !isUnredirectedPackage(manifest) || manifest.scripts?.build !== "vite build")
    return null;
  if (
    ["prebuild", "postbuild", "preinstall", "install", "postinstall", "prepare", "prepack"].some(
      (script) => manifest.scripts?.[script] !== undefined,
    )
  )
    return null;
  return directDependency(manifest, "react") &&
    directDependency(manifest, "vite", true) &&
    directDependency(manifest, "@vitejs/plugin-react", true) &&
    directDependency(manifest, EMBLA_HOOK)
    ? manifest
    : null;
};

const hasKnownEmblaLock = (root: string, manifest: Package): boolean => {
  const lock = readPlainText(join(root, "yarn.lock"));
  if (!lock || !/^# yarn lockfile v1$/mu.test(lock)) return false;
  const blocks = lock.split(/\r?\n(?=[^\s#])/u);
  const lockedBlock = (name: string, selector: string): string | null => {
    const key = `${name}@${selector}`;
    const matches = blocks.filter((block) => {
      const [header] = block.split(/\r?\n/u, 1);
      return (
        header?.endsWith(":") &&
        header
          .slice(0, -1)
          .split(/,\s*/u)
          .some((entry) => entry === key || entry === `"${key}"`)
      );
    });
    return matches.length === 1 ? (matches[0] ?? null) : null;
  };
  const isKnown = (name: string, selector: string): boolean => {
    const block = lockedBlock(name, selector);
    if (!block) return false;
    const lines = block.split(/\r?\n/u);
    const resolved = `  resolved "https://registry.npmjs.org/${name}/-/${name}-${EMBLA_VERSION}.tgz`;
    return (
      lines.filter((line) => line.startsWith("  version ")).length === 1 &&
      lines.includes(`  version "${EMBLA_VERSION}"`) &&
      lines.filter((line) => line.startsWith("  integrity ")).length === 1 &&
      lines.includes(`  integrity ${EMBLA_INTEGRITY[name]}`) &&
      lines.filter((line) => line.startsWith("  resolved ")).length === 1 &&
      lines.some((line) => line.startsWith(`${resolved}#`) || line === `${resolved}"`)
    );
  };
  const hookSelector = directDependency(manifest, EMBLA_HOOK);
  if (
    !hookSelector ||
    !isKnown(EMBLA_HOOK, hookSelector) ||
    !isKnown(EMBLA_CORE, EMBLA_VERSION) ||
    !isKnown(EMBLA_UTILS, EMBLA_VERSION)
  )
    return false;
  const hookBlock = lockedBlock(EMBLA_HOOK, hookSelector);
  const hookLines = hookBlock?.split(/\r?\n/u) ?? [];
  if (
    [EMBLA_CORE, EMBLA_UTILS].some(
      (dependency) => !hookLines.includes(`    ${dependency} "${EMBLA_VERSION}"`),
    )
  )
    return false;
  for (const name of [EMBLA_CORE, EMBLA_AUTOPLAY]) {
    const selector = directDependency(manifest, name);
    if (selector !== null && !isKnown(name, selector)) return false;
  }
  return true;
};

const getLiteralProperties = (node: EsTreeNode | undefined): Map<string, EsTreeNode> | null => {
  if (!isNodeOfType(node, "ObjectExpression")) return null;
  const properties = new Map<string, EsTreeNode>();
  for (const entry of node.properties) {
    if (
      !isNodeOfType(entry, "Property") ||
      entry.computed ||
      entry.method ||
      entry.kind !== "init" ||
      entry.shorthand
    )
      return null;
    const numberKey = isNodeOfType(entry.key, "Literal") && typeof entry.key.value === "number";
    const name = getStaticPropertyKeyName(entry, { stringifyNonStringLiterals: numberKey });
    if (!name || name === "__proto__" || properties.has(name)) return null;
    properties.set(name, entry.value);
  }
  return properties;
};

const isStaticValue = (node: EsTreeNode, depth = 0): boolean => {
  if (depth > 12) return false;
  if (isNodeOfType(node, "Literal"))
    return node.value === null || ["boolean", "number", "string"].includes(typeof node.value);
  if (isNodeOfType(node, "ArrayExpression"))
    return node.elements.every((entry) => entry && isStaticValue(entry, depth + 1));
  const properties = getLiteralProperties(node);
  return Boolean(
    properties && [...properties.values()].every((value) => isStaticValue(value, depth + 1)),
  );
};

const hasOnlyKeys = (
  properties: ReadonlyMap<string, EsTreeNode>,
  keys: ReadonlyArray<string>,
): boolean => [...properties.keys()].every((key) => keys.includes(key));

const isDirectImportCall = (
  node: EsTreeNode | undefined,
  source: string,
  importedName: string,
  count: number,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    node.optional ||
    node.arguments.length !== count ||
    !isNodeOfType(node.callee, "Identifier")
  )
    return false;
  const binding = scopes.symbolFor(node.callee);
  const imported = resolveImportedApiReference(node.callee, scopes);
  return (
    binding?.kind === "import" &&
    imported?.source === source &&
    imported.importedName === importedName &&
    !imported.isNamespace
  );
};

const getUniqueConfig = (root: string, stem: string): string | null => {
  let selected: string | null = null;
  for (const extension of CONFIG_EXTENSIONS) {
    const filename = join(root, `${stem}.${extension}`);
    const entry = entryAt(filename);
    if (!entry) continue;
    if (!entry.isFile() || selected !== null) return null;
    selected = filename;
  }
  return selected;
};

const hasStaticViteBuild = (filename: string, manifest: Package): boolean => {
  const program = parseSourceFile(filename);
  if (!isNodeOfType(program, "Program") || program.body.length !== 3) return false;
  const [first, second, exported] = program.body;
  if (
    !isNodeOfType(first, "ImportDeclaration") ||
    !isNodeOfType(second, "ImportDeclaration") ||
    !isNodeOfType(exported, "ExportDefaultDeclaration")
  )
    return false;
  const imports = new Set([first.source.value, second.source.value]);
  if (
    first.specifiers.length !== 1 ||
    second.specifiers.length !== 1 ||
    imports.size !== 2 ||
    !imports.has("vite") ||
    !imports.has("@vitejs/plugin-react")
  )
    return false;
  const scopes = analyzeScopes(program);
  const definition = exported.declaration;
  if (
    !isNodeOfType(definition, "CallExpression") ||
    !isDirectImportCall(definition, "vite", "defineConfig", 1, scopes)
  )
    return false;
  const options = getLiteralProperties(definition.arguments[0]);
  if (!options || !hasOnlyKeys(options, ["base", "plugins", "build", "server"])) return false;
  const plugins = options.get("plugins");
  if (
    !isNodeOfType(plugins, "ArrayExpression") ||
    plugins.elements.length !== 1 ||
    !isDirectImportCall(
      plugins.elements[0] ?? undefined,
      "@vitejs/plugin-react",
      "default",
      0,
      scopes,
    )
  )
    return false;
  const base = options.get("base");
  if (
    base &&
    (!isNodeOfType(base, "Literal") ||
      typeof base.value !== "string" ||
      !/^\/(?:[\w.-]+\/)*$/u.test(base.value))
  )
    return false;
  const server = options.get("server");
  if (server) {
    const object = getLiteralProperties(server);
    if (!object || !hasOnlyKeys(object, ["port", "open"]) || !isStaticValue(server)) return false;
  }
  const build = options.get("build");
  if (!build) return true;
  const buildProperties = getLiteralProperties(build);
  if (
    !buildProperties ||
    !hasOnlyKeys(buildProperties, ["outDir", "sourcemap", "minify", "rollupOptions"]) ||
    !isStaticValue(build)
  )
    return false;
  const rollup = buildProperties.get("rollupOptions");
  if (!rollup) return true;
  const rollupProperties = getLiteralProperties(rollup);
  const output = getLiteralProperties(rollupProperties?.get("output"));
  const chunks = getLiteralProperties(output?.get("manualChunks"));
  return Boolean(
    rollupProperties &&
    hasOnlyKeys(rollupProperties, ["output"]) &&
    output &&
    hasOnlyKeys(output, ["manualChunks"]) &&
    chunks &&
    [...chunks.values()].every(
      (chunk) =>
        isNodeOfType(chunk, "ArrayExpression") &&
        chunk.elements.every(
          (name) =>
            isNodeOfType(name, "Literal") &&
            typeof name.value === "string" &&
            STOCK_APPLICATION_IMPORTS.has(name.value) &&
            directDependency(
              manifest,
              name.value === "react-dom/client" ? "react-dom" : name.value,
            ),
        ),
    ),
  );
};

const hasStaticStyles = (root: string, manifest: Package): boolean => {
  if (
    [
      ".postcssrc",
      ".postcssrc.json",
      ".postcssrc.yaml",
      ".postcssrc.yml",
      ...CONFIG_EXTENSIONS.map((extension) => `.postcssrc.${extension}`),
    ].some((name) => entryAt(join(root, name)))
  )
    return false;
  for (const stem of ["postcss.config", "tailwind.config"]) {
    const candidates = CONFIG_EXTENSIONS.filter((ext) => entryAt(join(root, `${stem}.${ext}`)));
    if (candidates.length === 0) continue;
    const filename = getUniqueConfig(root, stem);
    const program = filename && parseSourceFile(filename);
    if (!isNodeOfType(program, "Program") || program.body.length !== 1) return false;
    const [statement] = program.body;
    if (
      !isNodeOfType(statement, "ExportDefaultDeclaration") ||
      !isStaticValue(statement.declaration)
    )
      return false;
    const properties = getLiteralProperties(statement.declaration);
    if (!properties) return false;
    if (stem === "postcss.config") {
      const plugins = getLiteralProperties(properties.get("plugins"));
      if (
        !hasOnlyKeys(properties, ["plugins"]) ||
        !plugins ||
        ![...plugins].every(
          ([name, options]) =>
            STOCK_POSTCSS_PLUGINS.has(name) &&
            Boolean(directDependency(manifest, name, true)) &&
            getLiteralProperties(options)?.size === 0,
        )
      )
        return false;
    } else {
      const plugins = properties.get("plugins");
      if (
        !hasOnlyKeys(properties, ["content", "theme", "plugins"]) ||
        (plugins && (!isNodeOfType(plugins, "ArrayExpression") || plugins.elements.length !== 0))
      )
        return false;
    }
  }
  return true;
};

const readHtmlEntry = (filename: string): string | null => {
  const html = readPlainText(filename)?.replace(/<!--[\s\S]*?-->/gu, "");
  if (!html || /<(?:base|embed|iframe|object)\b|\son[a-z]+\s*=/iu.test(html)) return null;
  let entry: string | null = null;
  let scripts = 0;
  for (const match of html.matchAll(/<script\b([^<>]*)>([\s\S]*?)<\/script\s*>/giu)) {
    scripts++;
    const attributes = match[1]?.trim() ?? "";
    const body = match[2] ?? "";
    if (/^type=(?:"application\/ld\+json"|'application\/ld\+json')$/iu.test(attributes)) {
      JSON.parse(body);
      continue;
    }
    const source = /^type=(?:"module"|'module')\s+src=(?:"(\/?[\w./-]+)"|'(\/?[\w./-]+)')$/iu.exec(
      attributes,
    );
    const sourcePath = source?.[1] ?? source?.[2];
    if (
      entry ||
      !sourcePath ||
      body.trim() ||
      sourcePath.includes("..") ||
      sourcePath.startsWith("//")
    )
      return null;
    entry = sourcePath.replace(/^\//u, "");
  }
  return scripts === [...html.matchAll(/<script\b/giu)].length ? entry : null;
};

const isStaticMediaGlob = (node: EsTreeNode): boolean => {
  const callee = node.parent;
  const call = callee?.parent;
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.object !== node ||
    callee.optional ||
    callee.computed ||
    !isNodeOfType(callee.property, "Identifier") ||
    callee.property.name !== "glob" ||
    !isNodeOfType(call, "CallExpression") ||
    call.callee !== callee ||
    call.optional ||
    call.arguments.length !== 2
  )
    return false;
  const [pattern, options] = call.arguments;
  const properties = getLiteralProperties(options);
  const eager = properties?.get("eager");
  return (
    isNodeOfType(pattern, "Literal") &&
    typeof pattern.value === "string" &&
    /^(?:\.\.?\/)+[\w/-]+\*\.[a-z0-9]+$/iu.test(pattern.value) &&
    STATIC_ASSET.test(pattern.value) &&
    properties?.size === 1 &&
    isNodeOfType(eager, "Literal") &&
    eager.value === true
  );
};

interface ApplicationModule {
  filePath: string;
  programNode: EsTreeNodeOfType<"Program">;
  scopes: ScopeAnalysis;
}

const hasClosedModuleReferences = (module: ApplicationModule, focalPath: string): boolean => {
  const { programNode, scopes } = module;
  let closed = true;
  walkAst(programNode, (node) => {
    if (!closed) return false;
    if (
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "TSImportEqualsDeclaration") ||
      isNodeOfType(node, "WithStatement") ||
      (isNodeOfType(node, "MetaProperty") && !isStaticMediaGlob(node)) ||
      (isNodeOfType(node, "Identifier") &&
        ["eval", "Function", "require"].includes(node.name) &&
        scopes.isGlobalReference(node))
    ) {
      closed = false;
      return false;
    }
    const source = getRuntimeStaticDependencySource(node);
    if (source === "react" || source === "react-dom" || source === "react-dom/client") {
      if (!isNodeOfType(node, "ImportDeclaration")) {
        closed = false;
        return false;
      }
      closed = node.specifiers.every((specifier) => {
        if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type")
          return true;
        const binding = scopes.symbolFor(specifier.local);
        if (
          !binding ||
          !isSymbolReadOnly(binding) ||
          !hasCompleteSymbolReferences(binding, programNode, scopes)
        )
          return false;
        return binding.references.every(({ identifier }) => {
          const parent = identifier.parent;
          if (isWithinAssignmentTarget(identifier)) return false;
          if (isNodeOfType(parent, "CallExpression"))
            return parent.callee === identifier && !parent.optional;
          if (isNodeOfType(specifier, "ImportSpecifier")) return false;
          if (isNodeOfType(parent, "JSXMemberExpression") && parent.object === identifier)
            return source === "react" && ["Fragment", "StrictMode"].includes(parent.property.name);
          if (
            !isNodeOfType(parent, "MemberExpression") ||
            parent.object !== identifier ||
            parent.optional ||
            parent.computed
          )
            return false;
          const call = parent.parent;
          return isNodeOfType(call, "CallExpression") && call.callee === parent && !call.optional;
        });
      });
      return closed;
    }
    if (source !== EMBLA_HOOK && source !== EMBLA_CORE && source !== EMBLA_AUTOPLAY) return;
    if (
      !isNodeOfType(node, "ImportDeclaration") ||
      module.filePath !== focalPath ||
      node.specifiers.length !== 1
    ) {
      closed = false;
      return false;
    }
    const [specifier] = node.specifiers;
    const binding = specifier && scopes.symbolFor(specifier.local);
    if (
      !isNodeOfType(specifier, "ImportDefaultSpecifier") ||
      !binding ||
      !isSymbolReadOnly(binding) ||
      !hasCompleteSymbolReferences(binding, programNode, scopes)
    ) {
      closed = false;
      return false;
    }
    if (source !== EMBLA_HOOK) {
      closed = binding.references.length === 0;
      return;
    }
    closed =
      binding.references.length === 1 &&
      binding.references.every(
        ({ identifier }) =>
          isDirectImportCall(identifier.parent ?? undefined, EMBLA_HOOK, "default", 2, scopes) &&
          isNodeOfType(identifier.parent, "CallExpression") &&
          identifier.parent.callee === identifier,
      );
  });
  return closed;
};

const isStaticCss = (filename: string): boolean => {
  const source = readPlainText(filename);
  if (source === null || /@(?:config|plugin)\b/iu.test(source)) return false;
  // Permit the common inert font link. A CSS import graph or plugin directive is outside this proof.
  const fontImport =
    /@import\s+url\((?:"https:\/\/fonts\.googleapis\.com\/[^"\r\n]+"|'https:\/\/fonts\.googleapis\.com\/[^'\r\n]+')\)\s*;/giu;
  return [...source.matchAll(/@import\b/giu)].length === [...source.matchAll(fontImport)].length;
};

// Walk from the proved package root before touching any nested path. Missing
// assets are harmless to the JS ownership proof, but existing aliases are not.
type ProjectPathKind = "file" | "directory" | "missing" | "unsupported";

const getProjectPathKind = (root: string, filename: string): ProjectPathKind => {
  if (filename === root || !isPathInside(filename, root) || !entryAt(root)?.isDirectory())
    return "unsupported";
  const segments = relative(root, filename).split(sep);
  let path = root;
  for (const [index, segment] of segments.entries()) {
    path = join(path, segment);
    const entry = entryAt(path);
    if (!entry) return "missing";
    if (index === segments.length - 1) {
      if (entry.isFile()) return "file";
      return entry.isDirectory() ? "directory" : "unsupported";
    }
    if (!entry.isDirectory()) return "unsupported";
  }
  return "unsupported";
};

const resolveLocalSource = (root: string, filename: string, source: string): string | null => {
  const base = normalizeFilename(resolve(dirname(filename), source));
  const baseKind = getProjectPathKind(root, base);
  if (STATIC_ASSET.test(source)) return baseKind === "file" || baseKind === "missing" ? base : null;
  if (source.endsWith(".css")) return baseKind === "file" ? base : null;
  if (/\.[\w]+$/u.test(source)) {
    if (baseKind !== "file") return null;
    const resolved = resolveModulePath(filename, source);
    return resolved && normalizeFilename(resolved) === base ? base : null;
  }
  if (baseKind !== "missing" && baseKind !== "directory") return null;
  if (baseKind === "directory" && entryAt(join(base, "package.json"))) return null;
  const candidates = [
    ...SOURCE_EXTENSIONS.map((ext) => `${base}${ext}`),
    ...SOURCE_EXTENSIONS.map((ext) => `${base}/index${ext}`),
  ];
  let selected: string | undefined;
  for (const candidate of candidates) {
    const kind = getProjectPathKind(root, candidate);
    if (kind === "missing") continue;
    if (kind !== "file" || selected) return null;
    selected = candidate;
  }
  if (!selected) return null;
  const resolved = resolveModulePath(filename, source);
  return resolved && normalizeFilename(resolved) === selected ? selected : null;
};

const readClosedProject = (
  root: string,
  focal: string,
  program: EsTreeNodeOfType<"Program">,
  scopes: ScopeAnalysis,
  manifest: Package,
): boolean => {
  // Default stock Vite build has a single root index and no additional Rollup
  // input. Follow its static runtime edges, ignoring unrelated source files.
  const htmlFiles = readdirSync(root).filter((name) => /\.html?$/iu.test(name));
  if (htmlFiles.length !== 1 || htmlFiles[0] !== "index.html") return false;
  const htmlFile = normalizeFilename(join(root, "index.html"));
  const entry = readHtmlEntry(htmlFile);
  if (!entry) return false;
  const pending = new Set([normalizeFilename(resolve(root, entry))]);
  const visited = new Set<string>();
  for (const filename of pending) {
    if (
      visited.size >= MAX_PROJECT_MODULES ||
      getProjectPathKind(root, filename) !== "file" ||
      (entryAt(filename)?.size ?? Infinity) > MAX_METADATA_BYTES
    )
      return false;
    const owner = findNearestPackageDirectory(filename);
    if (!owner || normalizeFilename(owner) !== root) return false;
    const moduleProgram = filename === focal ? program : parseSourceFile(filename);
    if (!isNodeOfType(moduleProgram, "Program")) return false;
    const moduleScopes = filename === focal ? scopes : analyzeScopes(moduleProgram);
    if (
      !hasClosedModuleReferences(
        { filePath: filename, programNode: moduleProgram, scopes: moduleScopes },
        focal,
      )
    )
      return false;
    visited.add(filename);
    for (const statement of moduleProgram.body) {
      const source = getRuntimeStaticDependencySource(statement);
      if (!source) continue;
      if (!source.startsWith("./") && !source.startsWith("../")) {
        const name = source === "react-dom/client" ? "react-dom" : source;
        if (!STOCK_APPLICATION_IMPORTS.has(source) || !directDependency(manifest, name))
          return false;
        continue;
      }
      const resolved = resolveLocalSource(root, filename, source);
      if (!resolved) return false;
      if (STATIC_ASSET.test(source)) continue;
      if (source.endsWith(".css")) {
        if (!isStaticCss(resolved)) return false;
        continue;
      }
      pending.add(resolved);
    }
  }
  return visited.has(focal);
};

/** A finite declared Vite application with registry-locked Embla 8.6.0 and no reachable adapter mutation. */
export const hasStockViteEmblaProvider = (
  context: RuleContext,
  program: EsTreeNode | undefined = context.sourceCode?.ast,
): boolean => {
  const filename = context.filename;
  if (!filename || !isAbsolute(filename) || !isNodeOfType(program, "Program")) return false;
  const focal = normalizeFilename(filename);
  try {
    const directory = findNearestPackageDirectory(focal);
    if (!directory) return false;
    const root = normalizeFilename(directory);
    const configuredRoot = getReactDoctorStringSetting(context.settings, "rootDirectory");
    if (!hasUnredirectedBuildBoundary(root, configuredRoot)) return false;
    if (RESOLUTION_MARKERS.some((name) => entryAt(join(root, name)))) return false;
    const manifest = readStockBuildPackage(root);
    if (!manifest || !hasKnownEmblaLock(root, manifest)) return false;
    const vite = getUniqueConfig(root, "vite.config");
    return Boolean(
      vite &&
      hasStaticViteBuild(vite, manifest) &&
      hasStaticStyles(root, manifest) &&
      readClosedProject(root, focal, program, context.scopes, manifest),
    );
  } catch {
    return false;
  }
};
