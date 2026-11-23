import * as fs from "node:fs";
import * as path from "node:path";
import {
  buildSourceProjectIndex,
  readSelectedTypedSourceClosure,
  type SourceProjectTypedEdgeReader,
} from "./build-source-project-index.js";
import {
  readStockCraCompilerRoute,
  hasVerifiedCraRawSnapshot,
  hasLocalEslintConfig,
} from "./has-automatic-stock-cra-jsx.js";
import { isPathInside } from "./is-path-inside.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";
import type { RuleContext } from "./rule-context.js";
import { readProviderMember } from "./stock-vite-providers/resolve-stock-physical-entry.js";

const EXTENSIONS = [".web.mjs", ".mjs", ".web.js", ".js", ".json", ".web.jsx", ".jsx"];
const stat = (filename: string): fs.Stats | undefined =>
  fs.lstatSync(filename, { throwIfNoEntry: false });
const object = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const readManifest = (directory: string): Record<string, unknown> | null => {
  const bytes = readProviderMember(path.join(directory, "package.json"));
  return bytes && bytes.length <= 64 * 1024 ? object(JSON.parse(bytes.toString("utf8"))) : null;
};
const physicalFile = (filename: string): boolean =>
  Boolean(
    stat(filename)?.isFile() &&
    stat(filename)?.nlink === 1 &&
    fs.realpathSync(filename) === filename,
  );
const selectSource = (candidate: string): string | null => {
  if (stat(candidate)?.isSymbolicLink()) return null;
  const choices = EXTENSIONS.map((extension) => candidate + extension);
  if (stat(candidate)?.isDirectory())
    choices.push(...EXTENSIONS.map((extension) => path.join(candidate, "index" + extension)));
  else if (stat(candidate)?.isFile()) choices.push(candidate);
  const selected = choices.filter((filename) => stat(filename));
  return selected.length === 1 && physicalFile(selected[0]) ? selected[0] : null;
};

interface RuntimeSources {
  readonly workspace: string;
  readonly links: ReadonlyMap<string, string>;
  readonly sources: ReadonlyMap<string, string>;
}

// Select actual local package candidates before admitting their source roots.
// A `file:` declaration by itself is never a resolution certificate.
const readRuntimeSources = (root: string): RuntimeSources | null => {
  const workspace = path.dirname(root);
  const links = new Map<string, string>();
  const sources = new Map<string, string>();
  const pending = [root];
  const visited = new Set<string>();
  while (pending.length) {
    const issuer = pending.pop()!;
    if (visited.has(issuer)) continue;
    visited.add(issuer);
    const manifest = readManifest(issuer);
    if (!manifest) return null;
    for (const section of ["dependencies", "devDependencies"]) {
      const declarations = object(manifest[section]);
      for (const [name, request] of Object.entries(declarations ?? {})) {
        if (typeof request !== "string" || !request.startsWith("file:")) continue;
        if (!/^[a-z][a-z0-9-]*$/u.test(name) || !/^file:\.\.\/[a-z][a-z0-9-]*$/u.test(request))
          return null;
        const target = path.resolve(issuer, request.slice(5));
        if (
          target === root ||
          path.dirname(target) !== workspace ||
          fs.realpathSync(target) !== target
        )
          return null;
        const link = path.join(issuer, "node_modules", name);
        if (!stat(link)?.isSymbolicLink() || fs.realpathSync(link) !== target) return null;
        const targetManifest = readManifest(target);
        if (
          !targetManifest ||
          ["exports", "browser", "module", "imports", "workspaces", "babel"].some((key) =>
            Object.hasOwn(targetManifest, key),
          )
        )
          return null;
        if (
          targetManifest.main !== "src/index.js" ||
          !physicalFile(path.join(target, "src/index.js"))
        )
          return null;
        const previous = sources.get(name);
        if (previous && previous !== target) return null;
        links.set(link, target);
        sources.set(name, target);
        pending.push(target);
      }
    }
  }
  // Stock Webpack searches ancestors before the app's fallback module root.
  // Source-package dependency directories therefore cannot be opaque holes.
  for (const target of new Set(sources.values())) {
    const modules = path.join(target, "node_modules");
    const expected = new Map([...links].filter(([link]) => path.dirname(link) === modules));
    const info = stat(modules);
    if (info && (!info.isDirectory() || fs.realpathSync(modules) !== modules)) return null;
    if (info && fs.readdirSync(modules).some((name) => !expected.has(path.join(modules, name))))
      return null;
    if (!info && expected.size) return null;
  }
  for (let directory = workspace; ; directory = path.dirname(directory)) {
    if (stat(path.join(directory, "node_modules"))) return null;
    if (path.dirname(directory) === directory) break;
  }
  return sources.size ? { workspace, links, sources } : null;
};

export const hasStockCraRawTextModule = (context: RuleContext): boolean => {
  const route = readStockCraCompilerRoute(context, true);
  if (!route) return false;
  try {
    const runtime = readRuntimeSources(route.root);
    const sourceText = context.getSourceText?.();
    const physicalBytes = readProviderMember(route.filename);
    const program = context.scopes.rootScope.node;
    // Text inputs may legitimately contain classic pragmas or unbound React
    // member tags. Establish byte identity without assuming they execute.
    if (
      !runtime ||
      !physicalFile(route.filename) ||
      sourceText === undefined ||
      !physicalBytes ||
      sourceText !== physicalBytes.toString("utf8") ||
      !isNodeOfType(program, "Program")
    )
      return false;
    const sourceRoots = [
      route.sourceDirectory,
      ...[...runtime.sources.values()].map((directory) => path.join(directory, "src")),
    ];
    const insideSource = (filename: string): boolean =>
      sourceRoots.some((directory) => isPathInside(filename, directory));
    const rawIssuers = new Map<string, Set<string>>();
    const ordinaryTargets = new Set<string>();
    const edgeReader: SourceProjectTypedEdgeReader = (module, _node, request) => {
      if (request === null) return null;
      if (request.startsWith("!!raw-loader!")) {
        // Loader resolution starts at the actual issuer. A nearer loader
        // candidate never inherits the root package's release certificate.
        let directory = path.dirname(module.filePath);
        let loader: string | null = null;
        while (true) {
          const candidate = path.join(directory, "node_modules", "raw-loader");
          if (stat(candidate)) {
            loader = candidate;
            break;
          }
          if (path.dirname(directory) === directory) break;
          directory = path.dirname(directory);
        }
        if (loader !== path.join(route.root, "node_modules", "raw-loader"))
          return { kind: "opaque" };
        const resource = request.slice("!!raw-loader!".length);
        if (!/^\.{1,2}\//u.test(resource) || /[!?#:\\]/u.test(resource)) return { kind: "opaque" };
        const candidate = path.resolve(path.dirname(module.filePath), resource);
        if (stat(candidate)?.isDirectory()) return { kind: "opaque" };
        const filename = selectSource(candidate);
        if (!filename || !insideSource(filename)) return { kind: "opaque" };
        const issuers = rawIssuers.get(filename) ?? new Set<string>();
        issuers.add(module.filePath);
        rawIssuers.set(filename, issuers);
        return { kind: "data", filenames: [] };
      }
      if (/[!?#:\\]/u.test(request) || /(?:^|[./])macro(?:$|[./])/iu.test(request))
        return { kind: "opaque" };
      if (!/^\.{1,2}\//u.test(request)) {
        if (request.split("/").some((part) => part === "." || part === ".." || part === ""))
          return { kind: "opaque" };
        if ([...runtime.sources.keys()].some((name) => request.startsWith(name + "/")))
          return { kind: "opaque" };
        const local = runtime.sources.get(request);
        if (local) {
          // The nearest candidate must be the exact admitted runtime link.
          let issuer = path.dirname(module.filePath);
          let selected: string | null = null;
          while (true) {
            const candidate = path.join(issuer, "node_modules", request);
            if (stat(candidate)) {
              selected = candidate;
              break;
            }
            if (path.dirname(issuer) === issuer) break;
            issuer = path.dirname(issuer);
          }
          if (!selected || runtime.links.get(selected) !== local) return { kind: "opaque" };
          const filename = path.join(local, "src/index.js");
          ordinaryTargets.add(filename);
          return { kind: "file", filename };
        }
        return /^[\w@][\w@./-]*$/u.test(request) ? { kind: "external" } : { kind: "opaque" };
      }
      const filename = selectSource(path.resolve(path.dirname(module.filePath), request));
      if (!filename || !insideSource(filename)) return { kind: "opaque" };
      if (filename.endsWith(".json")) return { kind: "data", filenames: [filename] };
      if (filename.endsWith(".css")) {
        const bytes = readProviderMember(filename);
        if (
          !bytes ||
          /@import\b|url\s*\(|:import\s*\(|\bcomposes\s*:|@value\b/iu.test(bytes.toString("utf8"))
        )
          return { kind: "opaque" };
        return { kind: "data", filenames: [filename] };
      }
      ordinaryTargets.add(filename);
      return { kind: "file", filename };
    };
    const entrypoints = EXTENSIONS.map((extension) =>
      path.join(route.sourceDirectory, "index" + extension),
    ).filter(physicalFile);
    if (entrypoints.length !== 1 || entrypoints[0] === route.filename) return false;
    const index = buildSourceProjectIndex({
      rootDirectory: runtime.workspace,
      currentFilePath: route.filename,
      currentProgramNode: program,
      currentScopes: context.scopes,
      includeTestlikeSources: true,
      javascriptAllowsJsx: true,
      readTypedRuntimeEdge: edgeReader,
    });
    if (!index || ordinaryTargets.has(route.filename)) return false;
    const closure = readSelectedTypedSourceClosure(index, entrypoints);
    if (!closure || closure.opaqueIssuers.size) return false;
    const issuers = rawIssuers.get(route.filename);
    if (!issuers?.size || ![...issuers].every((issuer) => closure.reachable.has(issuer)))
      return false;
    // No nested manifest, compiler pragma, macro, or unsupported runtime module
    // operation may alter the selected compiler corridor.
    for (const filename of closure.reachable) {
      if (!insideSource(filename)) return false;
      const module = index.modulesByFilePath.get(filename);
      if (module) {
        let implicitEntry = false;
        walkAst(module.programNode, (node) => {
          if (isNodeOfType(node, "MetaProperty") && node.meta.name === "import")
            implicitEntry = true;
          if (
            isNodeOfType(node, "Identifier") &&
            (node.name === "Worker" || node.name === "SharedWorker") &&
            module.scopes.isGlobalReference(node)
          )
            implicitEntry = true;
        });
        if (implicitEntry) return false;
      }
      const bytes = readProviderMember(filename);
      if (!bytes || /@jsx(?:Runtime|ImportSource|Frag)?\b/u.test(bytes.toString("utf8")))
        return false;
      for (
        let directory = path.dirname(filename);
        insideSource(path.join(directory, "_"));
        directory = path.dirname(directory)
      ) {
        if (
          stat(path.join(directory, "package.json")) ||
          stat(path.join(directory, "node_modules")) ||
          hasLocalEslintConfig(directory)
        )
          return false;
      }
    }
    return hasVerifiedCraRawSnapshot(route.root, runtime.links);
  } catch {
    return false;
  }
};
