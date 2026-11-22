import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { analyzeScopes, type ScopeAnalysis } from "../semantic/scope-analysis.js";
import { recordContentProbe, recordExistenceProbe } from "./cross-file-probe-recorder.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import {
  DOTLOTTIE_REACT_PACKAGE,
  DOTLOTTIE_WEB_PACKAGE,
  getDotLottieRoutePathKind,
  hasStockInstalledDotLottieProvider,
} from "./has-stock-dotlottie-installed-provider.js";
import { getGlobalRequireModuleSource } from "./get-global-require-module-source.js";
import { getImportedName } from "./get-imported-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isKeyedDraftTypeReference } from "./is-keyed-draft-type-reference.js";
import { getReactDoctorStringSetting } from "./get-react-doctor-setting.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { readDeclaredMetroPeerAliasDirectory } from "./read-declared-metro-peer-alias-directory.js";
import { readDeclaredWebpackMetroAlias } from "./has-declared-webpack-metro-alias.js";
import { getRuntimeStaticDependencySource } from "./get-runtime-static-dependency-source.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isPathInside } from "./is-path-inside.js";
import { parseSourceFile } from "./parse-source-file.js";
import {
  findNearestPackageDirectory,
  readPackageManifest,
} from "./read-nearest-package-manifest.js";
import { resolveDeclaredWorkspaceDirectories } from "./resolve-declared-workspace-directories.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import type { RuleContext } from "./rule-context.js";
import { walkAst } from "./walk-ast.js";

type Manifest = NonNullable<ReturnType<typeof readPackageManifest>>;
const CORE_TOOLS = [
  ["react-native-builder-bob", "^0.20.4", "0.20.4"],
  ["metro-react-native-babel-preset", "^0.73.10", "0.73.10"],
] as const;
const WEB_TOOLS = [
  ["@babel/core", "^7.20.0", "7.29.0"],
  ["@react-native/babel-preset", "^0.78.0", "0.78.3"],
  ["@react-native/metro-config", "^0.78.0", "0.78.3"],
  ["@rnx-kit/metro-config", "^1.3.15", "1.3.17"],
  ["babel-loader", "^9.1.3", "9.2.1"],
  ["babel-plugin-react-native-web", "^0.19.12", "0.19.13"],
  ["html-webpack-plugin", "^5.6.0", "5.6.7"],
  ["webpack", "^5.94.0", "5.106.2"],
  ["webpack-cli", "^5.1.4", "5.1.4"],
  ["webpack-dev-server", "^5.1.0", "5.2.4"],
] as const;
const PROVIDER_PACKAGES = [
  DOTLOTTIE_REACT_PACKAGE,
  DOTLOTTIE_WEB_PACKAGE,
  ...[...CORE_TOOLS, ...WEB_TOOLS].map(([name]) => name),
];
const REDIRECTION_FIELDS = [
  "alias",
  "browser",
  "exports",
  "imports",
  "babel",
  "overrides",
  "pnpm",
  "patchedDependencies",
];
const PACKAGE_MANAGER_MARKERS = [
  ".npmrc",
  ".yarnrc",
  ".pnp.cjs",
  ".pnp.loader.mjs",
  "pnpm-workspace.yaml",
  "pnpm-workspace.yml",
  "pnpm-lock.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "bun.lock",
  "bun.lockb",
];
const BABEL_CONFIG_STEMS = [".babelrc", "babel.config"];
const CONFIG_EXTENSIONS = ["", ".json", ".js", ".cjs", ".mjs", ".ts", ".cts", ".mts"];
const ALLOWED_YARN_FIELDS = new Set([
  "compressionLevel",
  "enableGlobalCache",
  "enableScripts",
  "nmHoistingLimits",
  "nodeLinker",
  "yarnPath",
  "npmMinimalAgeGate",
]);

const readTreeFile = (workspace: string, filename: string, maxBytes: number): string | null => {
  if (
    getDotLottieRoutePathKind(workspace, filename) !== "file" ||
    lstatSync(filename).size > maxBytes
  )
    return null;
  recordContentProbe(filename);
  return readFileSync(filename, "utf8");
};

const readTreeManifest = (root: string, directory: string): Manifest | null =>
  getDotLottieRoutePathKind(root, join(directory, "package.json")) === "file"
    ? readPackageManifest(directory)
    : null;

const hasUnsupportedResolution = (manifest: Manifest): boolean => {
  if (REDIRECTION_FIELDS.some((field) => Object.hasOwn(manifest, field))) return true;
  const resolutions = Reflect.get(manifest, "resolutions");
  return (
    resolutions !== undefined &&
    (!resolutions ||
      typeof resolutions !== "object" ||
      Array.isArray(resolutions) ||
      Object.entries(resolutions).some(
        ([name, value]) =>
          typeof value !== "string" ||
          !/^[~^]?\d+\.\d+\.\d+$/u.test(value) ||
          PROVIDER_PACKAGES.some((provider) => name.includes(provider)) ||
          /(?:^|\/)(?:webpack|metro-config|bob|react-native-builder-bob)(?:@|$)/u.test(name),
      ))
  );
};

const hasCompetingFiles = (
  root: string,
  directory: string,
  stems: string[],
  admitted: string | null,
): boolean =>
  stems.some((stem) =>
    CONFIG_EXTENSIONS.some((extension) => {
      const filename = stem + extension;
      return (
        filename !== admitted &&
        getDotLottieRoutePathKind(root, join(directory, filename)) !== "missing"
      );
    }),
  );

const hasStockBabelConfig = (root: string, directory: string, preset: string): boolean => {
  if (hasCompetingFiles(root, directory, BABEL_CONFIG_STEMS, "babel.config.js")) return false;
  const filename = join(directory, "babel.config.js");
  if (getDotLottieRoutePathKind(root, filename) !== "file" || lstatSync(filename).size > 4096)
    return false;
  const program = parseSourceFile(filename);
  if (!isNodeOfType(program, "Program") || program.body.length !== 1) return false;
  const [statement] = program.body;
  const assignment = isNodeOfType(statement, "ExpressionStatement") ? statement.expression : null;
  if (
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    !isNodeOfType(assignment.left, "MemberExpression") ||
    assignment.left.computed ||
    assignment.left.optional ||
    !isNodeOfType(assignment.left.object, "Identifier") ||
    assignment.left.object.name !== "module" ||
    getStaticPropertyName(assignment.left) !== "exports" ||
    !isNodeOfType(assignment.right, "ObjectExpression") ||
    assignment.right.properties.length !== 1
  )
    return false;
  const [option] = assignment.right.properties;
  if (
    !isNodeOfType(option, "Property") ||
    option.computed ||
    option.method ||
    option.kind !== "init" ||
    getStaticPropertyKeyName(option) !== "presets" ||
    !isNodeOfType(option.value, "ArrayExpression") ||
    option.value.elements.length !== 1
  )
    return false;
  const [item] = option.value.elements;
  return isNodeOfType(item, "Literal") && item.value === preset;
};

const hasDeclaredWebProviderRoute = (root: string, owner: string, consumer: string): boolean => {
  const metro = join(consumer, "metro.config.js");
  const webpack = join(consumer, "webpack.config.js");
  if (
    [metro, webpack].some(
      (file) => getDotLottieRoutePathKind(root, file) !== "file" || lstatSync(file).size > 32_000,
    )
  )
    return false;
  const directory = readDeclaredMetroPeerAliasDirectory(metro, join(owner, "package.json"));
  if (!directory) return false;
  const config = readDeclaredWebpackMetroAlias(webpack, directory);
  if (!config || config.entryPath !== join(consumer, "index.web.js")) return false;
  if (config.htmlTemplate === null) return true;
  const html = readTreeFile(root, config.htmlTemplate, 24_000);
  return Boolean(
    html && !/<(?:script|base|iframe|embed|object)\b|\son[a-z]+\s*=|<%|\x00/iu.test(html),
  );
};

const hasKnownYarnMode = (root: string, packageManager: unknown): boolean => {
  if (typeof packageManager !== "string" || !/^yarn@4\.\d+\.\d+$/u.test(packageManager))
    return false;
  if (
    PACKAGE_MANAGER_MARKERS.some(
      (name) => getDotLottieRoutePathKind(root, join(root, name)) !== "missing",
    )
  )
    return false;
  const text = readTreeFile(root, join(root, ".yarnrc.yml"), 4096);
  if (!text) return false;
  const options = new Map<string, string>();
  for (const line of text.split(/\r?\n/u)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const match = /^(\w+): ([\w./-]+)$/u.exec(line);
    const name = match?.[1];
    const value = match?.[2];
    if (!name || !value || !ALLOWED_YARN_FIELDS.has(name) || options.has(name)) return false;
    options.set(name, value);
  }
  return (
    options.get("nodeLinker") === "node-modules" &&
    options.get("nmHoistingLimits") === "workspaces" &&
    options.get("yarnPath") === `.yarn/releases/${packageManager.replace("@", "-")}.cjs`
  );
};

const hasKnownYarnLocks = (
  root: string,
  owner: string,
  ownerName: string,
  consumer: string,
  consumerName: string,
): boolean => {
  const text = readTreeFile(root, join(root, "yarn.lock"), 1_500_000);
  if (!text || !/^__metadata:\r?\n  version: 9$/mu.test(text)) return false;
  const blocks = text.split(/\r?\n(?=[^\s#])/u);
  const find = (descriptor: string) => {
    const matches = blocks.filter((block) => {
      const header = block.split(/\r?\n/u, 1)[0];
      return (
        header?.startsWith('"') &&
        header.endsWith('":') &&
        header.slice(1, -2).split(", ").includes(descriptor)
      );
    });
    return matches.length === 1 ? matches[0]?.split(/\r?\n/u) : undefined;
  };
  const reads = (packageName: string, selector: string, version: string, web?: string): boolean => {
    const body = find(`${packageName}@npm:${selector}`);
    return Boolean(
      body &&
      body.includes(`  version: ${version}`) &&
      body.includes(`  resolution: "${packageName}@npm:${version}"`) &&
      (!web || body.includes(`    "${DOTLOTTIE_WEB_PACKAGE}": "npm:${web}"`)),
    );
  };
  const inWorkspace = (
    name: string,
    directory: string,
    dependencies: ReadonlyArray<readonly [string, string]>,
  ): boolean => {
    const path = relative(root, directory).split(sep).join("/");
    const descriptor = `${name}@workspace:${path}`;
    const body = find(descriptor);
    if (!body?.includes(`  resolution: "${descriptor}"`)) return false;
    const start = body.indexOf("  dependencies:");
    if (start < 0) return false;
    const following = body.slice(start + 1);
    const end = following.findIndex((line) => !line.startsWith("    "));
    const entries = end < 0 ? following : following.slice(0, end);
    return dependencies.every(([key, specifier]) => {
      const header = key.startsWith("@") ? `    "${key}": ` : `    ${key}: `;
      const matches = entries.filter((line) => line.startsWith(header));
      return matches.length === 1 && matches[0] === `${header}"${specifier}"`;
    });
  };
  if (
    !inWorkspace(ownerName, owner, [
      [DOTLOTTIE_REACT_PACKAGE, "npm:^0.13.5"],
      ...CORE_TOOLS.map(([name, selector]) => [name, `npm:${selector}`] as const),
    ]) ||
    !inWorkspace(consumerName, consumer, [
      [DOTLOTTIE_REACT_PACKAGE, "npm:^0.8.12"],
      [ownerName, "workspace:*"],
      ...WEB_TOOLS.map(([name, selector]) => [name, `npm:${selector}`] as const),
    ])
  )
    return false;
  return (
    reads(DOTLOTTIE_REACT_PACKAGE, "^0.13.5", "0.13.5", "0.44.0") &&
    reads(DOTLOTTIE_WEB_PACKAGE, "0.44.0", "0.44.0") &&
    reads(DOTLOTTIE_REACT_PACKAGE, "^0.8.12", "0.8.12", "0.33.0") &&
    reads(DOTLOTTIE_WEB_PACKAGE, "0.33.0", "0.33.0") &&
    [...CORE_TOOLS, ...WEB_TOOLS].every(([name, selector, version]) =>
      reads(name, selector, version),
    ) &&
    reads("metro-config", "^0.81.3", "0.81.5")
  );
};

const noExtraBuildHooks = (manifest: Manifest, scripts: readonly string[]): boolean =>
  ![
    "install",
    "preinstall",
    "postinstall",
    ...scripts.flatMap((script) => [`pre${script}`, `post${script}`]),
  ].some((script) => manifest.scripts?.[script] !== undefined);

const hasBobWebEntry = (
  root: string,
  owner: string,
  filename: string,
  manifest: Manifest,
): boolean => {
  if (
    manifest.scripts?.build !== "bob build" ||
    manifest.scripts?.prepare !== "bob build" ||
    manifest.devDependencies?.["react-native-builder-bob"] !== "^0.20.4" ||
    !noExtraBuildHooks(manifest, ["build", "prepare"])
  )
    return false;
  const bob = Reflect.get(manifest, "react-native-builder-bob");
  if (
    !bob ||
    typeof bob !== "object" ||
    Object.keys(bob).length !== 3 ||
    bob.source !== "src" ||
    bob.output !== "lib" ||
    JSON.stringify(bob.targets) !== '["commonjs","module","typescript"]' ||
    manifest.main !== "lib/commonjs/index.js" ||
    manifest.module !== "lib/module/index.js" ||
    manifest["react-native"] !== "src/index.tsx" ||
    manifest.source !== "src/index.tsx"
  )
    return false;
  const entryPath = join(owner, "src/index.tsx");
  if (getDotLottieRoutePathKind(root, entryPath) !== "file") return false;
  const entry = parseSourceFile(entryPath);
  if (!isNodeOfType(entry, "Program") || entry.body.length !== 3) return false;
  const [imported, types, exported] = entry.body;
  if (
    !isNodeOfType(imported, "ImportDeclaration") ||
    imported.specifiers.length !== 1 ||
    !isNodeOfType(types, "ExportAllDeclaration") ||
    types.source.value !== "./types" ||
    !isNodeOfType(exported, "ExportDefaultDeclaration") ||
    !isNodeOfType(exported.declaration, "Identifier")
  )
    return false;
  const selected = resolveImportedApiReference(exported.declaration, analyzeScopes(entry));
  if (
    !selected?.source.startsWith("./") ||
    !/^\.\/[\w-]+$/u.test(selected.source) ||
    selected.source !== imported.source.value ||
    !selected.importedName
  )
    return false;
  const stem = join(dirname(entryPath), selected.source);
  const selectedFile = join(stem, "index.web.tsx");
  return (
    resolve(filename) === selectedFile &&
    getDotLottieRoutePathKind(root, selectedFile) === "file" &&
    getDotLottieRoutePathKind(root, `${stem}.web.tsx`) === "missing" &&
    getDotLottieRoutePathKind(root, join(stem, "package.json")) === "missing" &&
    hasStockBabelConfig(root, owner, "module:metro-react-native-babel-preset")
  );
};

const hasConsumerEntry = (root: string, consumer: string, ownerName: string): boolean => {
  const indexPath = join(consumer, "index.web.js");
  const appPath = join(consumer, "App.tsx");
  if (
    [indexPath, appPath].some((file) => getDotLottieRoutePathKind(root, file) !== "file") ||
    ["App.web.tsx", "App.web.ts"].some(
      (name) => getDotLottieRoutePathKind(root, join(consumer, name)) !== "missing",
    )
  )
    return false;
  const index = parseSourceFile(indexPath);
  const app = parseSourceFile(appPath);
  if (!isNodeOfType(index, "Program") || !isNodeOfType(app, "Program")) return false;
  const readSources = (program: EsTreeNodeOfType<"Program">) =>
    program.body.flatMap((statement) => getRuntimeStaticDependencySource(statement) ?? []);
  const indexImports = readSources(index);
  const appImports = readSources(app);
  if (
    indexImports.length !== 2 ||
    !indexImports.includes("./App") ||
    !indexImports.includes("react-native") ||
    appImports.filter((name) => name === ownerName).length !== 1 ||
    appImports.some((name) => ![ownerName, "react", "react-native"].includes(name))
  )
    return false;
  for (const program of [index, app]) {
    const scopes = analyzeScopes(program);
    let closed = true;
    walkAst(program, (node) => {
      if (
        isNodeOfType(node, "ImportExpression") ||
        isNodeOfType(node, "TSImportEqualsDeclaration") ||
        isNodeOfType(node, "WithStatement")
      )
        closed = false;
      if (
        isNodeOfType(node, "Identifier") &&
        ["eval", "Function"].includes(node.name) &&
        scopes.isGlobalReference(node)
      )
        closed = false;
      if (
        isNodeOfType(node, "Identifier") &&
        node.name === "require" &&
        scopes.isGlobalReference(node)
      ) {
        const call = node.parent;
        if (
          !isNodeOfType(call, "CallExpression") ||
          call.callee !== node ||
          call.arguments.length !== 1 ||
          !/^\.\/[\w/-]+\.(?:json|lottie)$/u.test(getGlobalRequireModuleSource(call, scopes) ?? "")
        )
          closed = false;
      }
      return closed ? undefined : false;
    });
    if (!closed) return false;
  }
  return true;
};

const matchesWorkspaceLink = (
  root: string,
  owner: string,
  consumer: string,
  name: string,
): boolean => {
  const link = join(consumer, "node_modules", name);
  if (getDotLottieRoutePathKind(root, dirname(link)) !== "directory") return false;
  recordExistenceProbe(link);
  return Boolean(
    lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink() &&
    realpathSync(link) === realpathSync(owner),
  );
};

const closesFocalProviders = (
  root: string,
  owner: string,
  focal: string,
  focalProgram: EsTreeNodeOfType<"Program">,
  focalScopes: ScopeAnalysis,
): boolean => {
  const pending = new Set([focal]);
  for (const filename of pending) {
    if (pending.size > 16 || getDotLottieRoutePathKind(root, filename) !== "file") return false;
    const program = filename === focal ? focalProgram : parseSourceFile(filename);
    if (!isNodeOfType(program, "Program")) return false;
    const scopes = filename === focal ? focalScopes : analyzeScopes(program);
    let sdkImports = 0;
    let closed = true;
    walkAst(program, (node) => {
      if (!closed) return false;
      if (
        isNodeOfType(node, "ImportExpression") ||
        isNodeOfType(node, "TSImportEqualsDeclaration") ||
        isNodeOfType(node, "WithStatement") ||
        (isNodeOfType(node, "Identifier") &&
          ["require", "eval", "Function"].includes(node.name) &&
          scopes.isGlobalReference(node))
      ) {
        closed = false;
        return false;
      }
      const source = getRuntimeStaticDependencySource(node);
      if (!source || source === "react" || source === "react-native") return;
      if (
        source === DOTLOTTIE_REACT_PACKAGE &&
        filename === focal &&
        isNodeOfType(node, "ImportDeclaration")
      ) {
        sdkImports++;
        closed =
          node.specifiers.some((specifier) => getImportedName(specifier) === "DotLottieReact") &&
          node.specifiers.every((specifier) => {
            if (!isNodeOfType(specifier, "ImportSpecifier")) return false;
            const name = getImportedName(specifier);
            const binding = scopes.symbolFor(specifier.local);
            if (!binding || !hasCompleteSymbolReferences(binding, program, scopes)) return false;
            const runtimeReferences = binding.references.filter(
              ({ identifier }) => !isKeyedDraftTypeReference(identifier),
            );
            if (name === "DotLottie") return runtimeReferences.length === 0;
            return (
              name === "DotLottieReact" &&
              runtimeReferences.length === 1 &&
              runtimeReferences.every(
                ({ identifier }) =>
                  isNodeOfType(identifier.parent, "JSXOpeningElement") &&
                  identifier.parent.name === identifier,
              )
            );
          });
        return;
      }
      if (!/^\.\.?\/[\w/-]+$/u.test(source)) {
        closed = false;
        return false;
      }
      const base = resolve(dirname(filename), source);
      if (!isPathInside(base, owner) || getDotLottieRoutePathKind(root, base) !== "missing") {
        closed = false;
        return false;
      }
      const allowed = [".web.tsx", ".web.ts", ".tsx", ".ts", ".web.js", ".js"].map(
        (suffix) => base + suffix,
      );
      let target: string | undefined;
      for (const candidate of allowed) {
        const kind = getDotLottieRoutePathKind(root, candidate);
        if (kind === "missing") continue;
        if (kind !== "file" || target) {
          closed = false;
          return false;
        }
        target = candidate;
      }
      if (!target) {
        closed = false;
        return false;
      }
      pending.add(target);
    });
    if (!closed || sdkImports !== (filename === focal ? 1 : 0)) return false;
  }
  return true;
};

const findYarnRoot = (owner: string): string | null => {
  let current = dirname(owner);
  for (let index = 0; index < 8; index++) {
    const manifest = readTreeManifest(current, current);
    if (manifest?.workspaces !== undefined) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
};

/** Only the stock, explicitly modeled Bob and Webpack peer routes are admitted. */
export const hasStockDotLottiePeerProvider = (
  context: RuleContext,
  focalProgram: EsTreeNode | undefined = context.sourceCode?.ast,
): boolean => {
  const filename = context.filename;
  if (
    !filename ||
    !isAbsolute(filename) ||
    !filename.endsWith(".web.tsx") ||
    !isNodeOfType(focalProgram, "Program")
  )
    return false;
  try {
    const owner = findNearestPackageDirectory(filename);
    const root = owner && findYarnRoot(owner);
    if (!owner || !root) return false;
    const scanRoot = getReactDoctorStringSetting(context.settings, "rootDirectory");
    if (scanRoot && (!isPathInside(filename, scanRoot) || !isPathInside(scanRoot, root)))
      return false;
    const rootManifest = readTreeManifest(root, root);
    const ownerManifest = readTreeManifest(root, owner);
    if (
      !rootManifest ||
      !ownerManifest ||
      hasUnsupportedResolution(rootManifest) ||
      hasUnsupportedResolution(ownerManifest) ||
      !hasKnownYarnMode(root, Reflect.get(rootManifest, "packageManager"))
    )
      return false;
    const workspaces = resolveDeclaredWorkspaceDirectories(root, rootManifest);
    const ownerName = ownerManifest.name;
    if (
      !workspaces ||
      workspaces.length !== 2 ||
      !workspaces.includes(owner) ||
      typeof ownerName !== "string" ||
      !/^(?:@[\w.-]+\/)?[\w.-]+$/u.test(ownerName)
    )
      return false;
    const consumer = workspaces.find((directory) => directory !== owner);
    if (!consumer || getDotLottieRoutePathKind(root, consumer) !== "directory") return false;
    const consumerManifest = readTreeManifest(root, consumer);
    const consumerName = consumerManifest?.name;
    if (
      !consumerManifest ||
      hasUnsupportedResolution(consumerManifest) ||
      typeof consumerName !== "string" ||
      !/^(?:@[\w.-]+\/)?[\w.-]+$/u.test(consumerName)
    )
      return false;
    if (
      [owner, consumer].some((directory) =>
        [...PACKAGE_MANAGER_MARKERS, ".yarnrc.yml", "yarn.lock"].some(
          (marker) => getDotLottieRoutePathKind(root, join(directory, marker)) !== "missing",
        ),
      )
    )
      return false;
    const onlyDeclaredTools = (
      manifest: Manifest,
      tools: ReadonlyArray<readonly [string, string, string]>,
    ) =>
      tools.every(
        ([name, selector]) =>
          manifest.devDependencies?.[name] === selector &&
          manifest.dependencies?.[name] === undefined &&
          manifest.optionalDependencies?.[name] === undefined &&
          manifest.peerDependencies?.[name] === undefined,
      );
    if (
      !onlyDeclaredTools(ownerManifest, CORE_TOOLS) ||
      !onlyDeclaredTools(consumerManifest, WEB_TOOLS) ||
      !hasKnownYarnLocks(root, owner, ownerName, consumer, consumerName)
    )
      return false;
    for (let directory = dirname(filename); directory !== owner; directory = dirname(directory)) {
      if (
        !isPathInside(directory, owner) ||
        hasCompetingFiles(root, directory, BABEL_CONFIG_STEMS, null)
      )
        return false;
    }
    const commands = Object.values(rootManifest.scripts ?? {});
    if (
      !commands.includes(`yarn workspace ${ownerName} build`) ||
      !commands.includes(`yarn workspace ${consumerName} web`) ||
      consumerManifest.scripts?.web !== "webpack serve" ||
      !noExtraBuildHooks(consumerManifest, ["web"])
    )
      return false;
    if (
      ownerManifest.peerDependencies?.[DOTLOTTIE_REACT_PACKAGE] !== "^0.13.5" ||
      ownerManifest.devDependencies?.[DOTLOTTIE_REACT_PACKAGE] !== "^0.13.5" ||
      ownerManifest.dependencies?.[DOTLOTTIE_REACT_PACKAGE] !== undefined ||
      ownerManifest.optionalDependencies?.[DOTLOTTIE_REACT_PACKAGE] !== undefined ||
      consumerManifest.dependencies?.[DOTLOTTIE_REACT_PACKAGE] !== "^0.8.12" ||
      consumerManifest.dependencies?.[ownerName] !== "workspace:*" ||
      consumerManifest.devDependencies?.[DOTLOTTIE_REACT_PACKAGE] !== undefined ||
      consumerManifest.optionalDependencies?.[DOTLOTTIE_REACT_PACKAGE] !== undefined ||
      consumerManifest.peerDependencies?.[DOTLOTTIE_REACT_PACKAGE] !== undefined
    )
      return false;
    if (
      hasCompetingFiles(
        root,
        root,
        [...BABEL_CONFIG_STEMS, "webpack.config", "metro.config"],
        null,
      ) ||
      hasCompetingFiles(root, owner, ["webpack.config", "metro.config"], null) ||
      hasCompetingFiles(root, consumer, ["webpack.config"], "webpack.config.js") ||
      hasCompetingFiles(root, consumer, ["metro.config"], "metro.config.js")
    )
      return false;
    return (
      hasBobWebEntry(root, owner, filename, ownerManifest) &&
      hasStockBabelConfig(root, consumer, "module:@react-native/babel-preset") &&
      hasDeclaredWebProviderRoute(root, owner, consumer) &&
      hasConsumerEntry(root, consumer, ownerName) &&
      matchesWorkspaceLink(root, owner, consumer, ownerName) &&
      closesFocalProviders(root, owner, filename, focalProgram, context.scopes) &&
      hasStockInstalledDotLottieProvider(owner, "0.13.5") &&
      hasStockInstalledDotLottieProvider(consumer, "0.8.12")
    );
  } catch {
    return false;
  }
};
