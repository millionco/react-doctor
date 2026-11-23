import * as fs from "node:fs";
import * as path from "node:path";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceText } from "./parse-source-file.js";
import { parseTsconfigJson } from "./resolve-tsconfig-alias.js";

const MAX_CONFIG_BYTES = 128 * 1024;
const MAX_ROUTE_ENTRIES = 2048;
const ROUTE_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx", ".md", ".mdx"];
const ENTRY_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx"];
const CONFIG_EXTENSIONS = [".js", ".cjs", ".mjs", ".ts", ".cts", ".mts"];
const POSTCSS_ROOT_CONFIG_NAMES = [
  ".postcssrc",
  ".postcssrc.json",
  ".postcssrc.yaml",
  ".postcssrc.yml",
  ...CONFIG_EXTENSIONS.map((extension) => "postcss.config" + extension),
  ...CONFIG_EXTENSIONS.map((extension) => ".postcssrc" + extension),
];
const TAILWIND_ROOT_CONFIG_NAMES = [".js", ".cjs", ".mjs", ".ts"].map(
  (extension) => "tailwind.config" + extension,
);
const LITERAL_SEGMENT = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/u;
const NAMED_PARAMETER = /^\$[A-Za-z][A-Za-z0-9_]*$/u;

const stat = (filename: string) => fs.lstatSync(filename, { throwIfNoEntry: false });
const exists = (filename: string) => stat(filename) !== undefined;

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readSmallFile = (filename: string): string | null => {
  const info = stat(filename);
  return info?.isFile() && info.size <= MAX_CONFIG_BYTES ? fs.readFileSync(filename, "utf8") : null;
};

const parseProgram = (filename: string, sourceText: string) =>
  parseSourceText({ filename, sourceText, language: "js", shouldAttachParentReferences: false });

const plainFields = (node: EsTreeNode): Map<string, EsTreeNode> | null => {
  if (!isNodeOfType(node, "ObjectExpression")) return null;
  const fields = new Map<string, EsTreeNode>();
  for (const property of node.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.kind !== "init" ||
      property.computed ||
      property.method ||
      property.shorthand
    )
      return null;
    const key = isNodeOfType(property.key, "Identifier")
      ? property.key.name
      : isNodeOfType(property.key, "Literal") && typeof property.key.value === "string"
        ? property.key.value
        : null;
    if (key === null || key === "__proto__" || fields.has(key)) return null;
    fields.set(key, property.value);
  }
  return fields;
};

const literal = (node: EsTreeNode) => (isNodeOfType(node, "Literal") ? node.value : undefined);

const jsonFields = (filename: string, text: string) => {
  const program = parseProgram(filename, `const config = ${text}\n`);
  if (!isNodeOfType(program, "Program") || program.body.length !== 1) return null;
  const [statement] = program.body;
  if (!isNodeOfType(statement, "VariableDeclaration") || statement.declarations.length !== 1)
    return null;
  const [{ init }] = statement.declarations;
  return init ? plainFields(init) : null;
};

interface StyleFlags {
  readonly postcss?: boolean;
  readonly tailwind?: boolean;
}

const classicConfig = (filename: string) => {
  const text = readSmallFile(filename);
  if (text === null) return null;
  const program = parseProgram(filename, text);
  if (!isNodeOfType(program, "Program") || program.body.length !== 1) return null;
  const [statement] = program.body;
  if (!isNodeOfType(statement, "ExpressionStatement")) return null;
  const { expression } = statement;
  if (!isNodeOfType(expression, "AssignmentExpression") || expression.operator !== "=") return null;
  const { left } = expression;
  if (
    !isNodeOfType(left, "MemberExpression") ||
    left.computed ||
    left.optional ||
    !isNodeOfType(left.object, "Identifier") ||
    left.object.name !== "module" ||
    !isNodeOfType(left.property, "Identifier") ||
    left.property.name !== "exports"
  )
    return null;
  const fields = plainFields(expression.right);
  if (!fields) return null;
  const flags: { postcss?: boolean; tailwind?: boolean } = {};
  for (const [key, node] of fields) {
    const value = literal(node);
    switch (key) {
      case "serverPlatform":
        if (value !== "node") return null;
        break;
      case "serverModuleFormat":
        if (value !== "cjs") return null;
        break;
      case "ignoredRouteFiles":
        if (
          !isNodeOfType(node, "ArrayExpression") ||
          node.elements.length !== 1 ||
          !node.elements[0] ||
          literal(node.elements[0]) !== "**/.*"
        )
          return null;
        break;
      case "watchPaths":
        if (
          !isNodeOfType(node, "ArrayExpression") ||
          !node.elements.every((element) => {
            const entry = element ? literal(element) : undefined;
            return (
              typeof entry === "string" &&
              /^\.\/(?:[A-Za-z\d_-]+\/)*[A-Za-z\d_-]+(?:\.[A-Za-z\d_-]+)*$/u.test(entry)
            );
          })
        )
          return null;
        break;
      case "postcss":
      case "tailwind":
        if (typeof value !== "boolean") return null;
        flags[key] = value;
        break;
      default:
        return null;
    }
  }
  // Classic Remix releases can differ on default server output format.
  return fields.has("serverModuleFormat")
    ? { styleFlags: flags, ignoresHiddenRoutes: fields.has("ignoredRouteFiles") }
    : null;
};

// Use only the version returned by the independently verified physical
// compiler. Classic 1.19.3 keeps these loaders off unless opted in.
export const resolveClassicRemixStyleFlags = (version: string, declared: StyleFlags) => {
  if (version !== "1.19.3" && version !== "2.17.4") return null;
  const enabledByDefault = version === "2.17.4";
  return {
    postcss: declared.postcss ?? enabledByDefault,
    tailwind: declared.tailwind ?? enabledByDefault,
  };
};

const classicTsconfig = (filename: string): boolean => {
  const text = readSmallFile(filename);
  if (text === null) return false;
  const document = parseTsconfigJson(text);
  const fields = jsonFields(filename, text);
  const compiler = fields?.get("compilerOptions");
  if (!document || !fields || !compiler || fields.has("extends") || fields.has("references"))
    return false;
  const compilerFields = plainFields(compiler);
  const opts = document.compilerOptions;
  if (
    !compilerFields ||
    !object(opts) ||
    opts.noEmit !== true ||
    opts.jsx !== "react-jsx" ||
    ["jsxFactory", "jsxFragmentFactory", "jsxImportSource", "plugins"].some((key) =>
      compilerFields.has(key),
    )
  )
    return false;
  const paths = compilerFields.get("paths");
  if (!paths) return opts.baseUrl === undefined || opts.baseUrl === ".";
  const aliases = plainFields(paths);
  if (opts.baseUrl !== "." || !aliases) return false;
  return Array.from(aliases).every(([alias, target]) => {
    if (!isNodeOfType(target, "ArrayExpression") || target.elements.length !== 1) return false;
    const [element] = target.elements;
    const value = element ? literal(element) : undefined;
    return (
      /^[~@]\/(?:[A-Za-z\d_-]+\/)*\*$/u.test(alias) &&
      typeof value === "string" &&
      /^\.\/app\/(?:[A-Za-z\d_-]+\/)*\*$/u.test(value)
    );
  });
};

interface PackageScriptSelection {
  readonly requiredPackageScript: "build" | "build:remix";
  readonly hasPackagePostcssConfig: boolean;
}

const scriptSelection = (root: string): PackageScriptSelection | null => {
  const filename = path.join(root, "package.json");
  const text = readSmallFile(filename);
  if (text === null) return null;
  const manifest: unknown = JSON.parse(text);
  const fields = jsonFields(filename, text);
  const scriptsNode = fields?.get("scripts");
  if (
    !object(manifest) ||
    !scriptsNode ||
    !plainFields(scriptsNode) ||
    (manifest.type !== undefined && manifest.type !== "commonjs") ||
    !object(manifest.scripts)
  )
    return null;
  const declaration = manifest.scripts;
  const buildScriptNames = Object.keys(declaration).filter((name) =>
    /^(?:pre|post)?build(?::|$)/u.test(name),
  );
  const hasPackagePostcssConfig = Object.hasOwn(manifest, "postcss");
  if (declaration.build === "remix build" && buildScriptNames.length === 1)
    return { requiredPackageScript: "build", hasPackagePostcssConfig };
  if (
    declaration.build === "run-s build:*" &&
    declaration["build:remix"] === "remix build" &&
    buildScriptNames.length === 2
  )
    return { requiredPackageScript: "build:remix", hasPackagePostcssConfig };
  return null;
};

const selectUniqueEntry = (directory: string, prefix: string, extensions: readonly string[]) => {
  const entries = extensions.map((suffix) => path.join(directory, prefix + suffix)).filter(exists);
  if (entries.length === 0) return undefined;
  if (entries.length !== 1 || !stat(entries[0])?.isFile()) return null;
  return entries[0];
};

export interface DeclaredClassicRemixRoute {
  readonly projectRoot: string;
  readonly configFile: string;
  readonly tsconfigFile: string;
  readonly filename: string;
  readonly routeId: string;
  readonly rootRouteFile: string;
  readonly browserEntry: string | undefined;
  readonly serverEntry: string | undefined;
  readonly requiredPackageScript: "build" | "build:remix";
  readonly styleFlags: StyleFlags;
  readonly rootStyles: {
    readonly hasPackagePostcssConfig: boolean;
    readonly postcssFileCandidates: readonly string[];
    readonly tailwindFileCandidates: readonly string[];
  };
}

// Select only the default classic convention proven by the stock compiler
// profile. The caller must separately verify the actual invoked script and
// physical compiler, source JSX directives, style transforms, and cache policy.
// Root style candidates do not establish provider precedence or absence of
// additional PostCSS candidates in ancestor directories.
export const readDeclaredClassicRemixRoute = (input: {
  projectRoot: string;
  filename: string;
}): DeclaredClassicRemixRoute | null => {
  try {
    const { projectRoot, filename } = input;
    if (
      !path.isAbsolute(projectRoot) ||
      fs.realpathSync(projectRoot) !== projectRoot ||
      !path.isAbsolute(filename)
    )
      return null;
    const app = path.join(projectRoot, "app");
    const routes = path.join(app, "routes");
    const stem = path.basename(filename, ".tsx");
    if (
      filename !== path.join(routes, stem + ".tsx") ||
      !stem.split(".").every((segment) => LITERAL_SEGMENT.test(segment)) ||
      !stat(app)?.isDirectory() ||
      fs.realpathSync(app) !== app ||
      !stat(routes)?.isDirectory() ||
      fs.realpathSync(routes) !== routes ||
      !stat(filename)?.isFile()
    )
      return null;
    const configFile = path.join(projectRoot, "remix.config.js");
    const tsconfigFile = path.join(projectRoot, "tsconfig.json");
    if (
      CONFIG_EXTENSIONS.some(
        (extension) =>
          exists(path.join(projectRoot, "vite.config" + extension)) ||
          (extension !== ".js" && exists(path.join(projectRoot, "remix.config" + extension))),
      ) ||
      exists(path.join(projectRoot, "jsconfig.json")) ||
      [app, routes].some((directory) =>
        ["package.json", "tsconfig.json", "jsconfig.json"].some((name) =>
          exists(path.join(directory, name)),
        ),
      ) ||
      ENTRY_EXTENSIONS.some((extension) => exists(path.join(app, "routes" + extension)))
    )
      return null;
    const script = scriptSelection(projectRoot);
    const config = classicConfig(configFile);
    if (!script || !config || !classicTsconfig(tsconfigFile)) return null;
    const rootRouteFile = selectUniqueEntry(app, "root", ROUTE_EXTENSIONS);
    const browserEntry = selectUniqueEntry(app, "entry.client", ENTRY_EXTENSIONS);
    const serverEntry = selectUniqueEntry(app, "entry.server", ENTRY_EXTENSIONS);
    if (
      !rootRouteFile ||
      !ENTRY_EXTENSIONS.includes(path.extname(rootRouteFile)) ||
      browserEntry === null ||
      serverEntry === null
    )
      return null;

    const entries = fs.readdirSync(routes, { withFileTypes: true });
    if (entries.length > MAX_ROUTE_ENTRIES) return null;
    const routeStems = new Set<string>();
    for (const entry of entries) {
      if (entry.name.startsWith(".") && config.ignoresHiddenRoutes && entry.isFile()) continue;
      const extension = path.extname(entry.name);
      if (!entry.isFile() || !ENTRY_EXTENSIONS.includes(extension) || entry.name.endsWith(".d.ts"))
        return null;
      const routeStem = path.basename(entry.name, extension);
      const segments = routeStem.split(".");
      if (
        routeStems.has(routeStem) ||
        !segments.every(
          (segment, index) =>
            (segment !== "index" && LITERAL_SEGMENT.test(segment)) ||
            NAMED_PARAMETER.test(segment) ||
            (segment === "_index" && index === segments.length - 1),
        )
      )
        return null;
      routeStems.add(routeStem);
    }
    if (!routeStems.has(stem)) return null;
    const rootCandidates = (names: readonly string[]) =>
      names.map((name) => path.join(projectRoot, name)).filter(exists);
    return {
      projectRoot,
      filename,
      configFile,
      tsconfigFile,
      rootRouteFile,
      browserEntry,
      serverEntry,
      routeId: `routes/${stem}`,
      requiredPackageScript: script.requiredPackageScript,
      styleFlags: config.styleFlags,
      rootStyles: {
        hasPackagePostcssConfig: script.hasPackagePostcssConfig,
        postcssFileCandidates: rootCandidates(POSTCSS_ROOT_CONFIG_NAMES),
        tailwindFileCandidates: rootCandidates(TAILWIND_ROOT_CONFIG_NAMES),
      },
    };
  } catch {
    return null;
  }
};
