import * as fs from "node:fs";
import * as path from "node:path";
import {
  recordDirectoryProbe,
  recordExistenceProbe,
  recordRealpathProbe,
} from "./cross-file-probe-recorder.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isPathInside } from "./is-path-inside.js";
import { walkAst } from "./walk-ast.js";

export interface ViteCssRouteModule {
  readonly filename: string;
  readonly program: EsTreeNodeOfType<"Program">;
}

export interface VitePlainCssRootInput {
  readonly appDirectory: string;
  readonly entryFile: string;
  readonly routeModules: readonly ViteCssRouteModule[];
}

export interface VitePlainCssRoots {
  readonly entryStylesheets: readonly string[];
  // Every file must pass the stylesheet fence. The census does not read CSS.
  readonly localStylesheets: readonly string[];
}

const styleExtension = /\.(?:css|less|sass|scss|styl|stylus|pcss|postcss|sss)$/iu;
const relativePlainCss = /^\.{1,2}\/(?:[a-z\d_.-]+\/)*[a-z\d_.-]+\.css$/iu;
const plainCss = (filename: string): boolean =>
  filename.endsWith(".css") && !filename.toLowerCase().endsWith(".module.css");

const observe = (filename: string): fs.Stats | undefined => {
  recordExistenceProbe(filename);
  recordRealpathProbe(filename);
  const info = fs.lstatSync(filename, { throwIfNoEntry: false });
  return info && fs.realpathSync(filename) === filename ? info : undefined;
};

const listLocalPlainCss = (appDirectory: string): Set<string> | null => {
  const pending = [appDirectory];
  const found = new Set<string>();
  let entriesSeen = 0;
  while (pending.length) {
    const directory = pending.pop()!;
    recordDirectoryProbe(directory);
    if (!observe(directory)?.isDirectory()) return null;
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    entriesSeen += entries.length;
    if (entriesSeen > 4096) return null;
    for (const entry of entries) {
      // Dependency package contents belong to the authenticated provider
      // graph. Git bookkeeping is outside the Vite application source.
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(filename);
      } else if (!entry.isFile()) {
        recordExistenceProbe(filename);
        return null;
      } else if (styleExtension.test(filename)) {
        if (!plainCss(filename) || !observe(filename)?.isFile() || found.size >= 64) return null;
        found.add(filename);
      }
    }
  }
  return found;
};

const isOpaqueViteGlob = (node: EsTreeNode): boolean => {
  if (
    !isNodeOfType(node, "MemberExpression") ||
    !isNodeOfType(node.object, "MetaProperty") ||
    node.object.meta.name !== "import"
  )
    return false;
  const property = getStaticPropertyKeyName(node, { allowComputedString: true });
  return property === "glob" || property === "globEager" || property === null;
};

const isNonImportStyleRequest = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression") && !isNodeOfType(node, "NewExpression")) return false;
  const target = node.callee;
  const argument = node.arguments[0];
  if (
    !isNodeOfType(argument, "Literal") ||
    typeof argument.value !== "string" ||
    !styleExtension.test(argument.value.split(/[?#]/u, 1)[0])
  )
    return false;
  return (
    (isNodeOfType(target, "Identifier") && ["require", "URL"].includes(target.name)) ||
    (isNodeOfType(target, "MemberExpression") &&
      isNodeOfType(target.object, "Identifier") &&
      target.object.name === "require" &&
      getStaticPropertyKeyName(target) === "resolve")
  );
};

const readModuleStyleImports = ({ filename, program }: ViteCssRouteModule): string[] | null => {
  const stylesheets: string[] = [];
  let refused = false;
  walkAst(program, (node) => {
    if (refused) return false;
    if (isOpaqueViteGlob(node) || isNonImportStyleRequest(node)) {
      refused = true;
      return false;
    }
    const source =
      isNodeOfType(node, "ImportDeclaration") ||
      isNodeOfType(node, "ExportNamedDeclaration") ||
      isNodeOfType(node, "ExportAllDeclaration") ||
      isNodeOfType(node, "ImportExpression")
        ? node.source
        : null;
    if (isNodeOfType(node, "ImportExpression") && !isNodeOfType(source, "Literal")) {
      refused = true;
      return false;
    }
    if (!isNodeOfType(source, "Literal") || typeof source.value !== "string") return;
    const request = source.value;
    if (/[?#]/u.test(request)) {
      refused = true;
      return false;
    }
    if (!styleExtension.test(request)) return;
    if (
      !isNodeOfType(node, "ImportDeclaration") ||
      node.specifiers.length ||
      node.importKind === "type" ||
      node.attributes?.length ||
      !relativePlainCss.test(request) ||
      !plainCss(request)
    ) {
      refused = true;
      return false;
    }
    stylesheets.push(path.resolve(path.dirname(filename), request));
  });
  return refused ? null : stylesheets;
};

// The caller supplies the selected default Vite resolution profile and parsed
// route modules. Resolving style exports of external JS packages is separate.
export const readVitePlainCssRoots = (input: VitePlainCssRootInput): VitePlainCssRoots | null => {
  try {
    const { appDirectory, entryFile, routeModules } = input;
    if (
      !path.isAbsolute(appDirectory) ||
      path.normalize(appDirectory) !== appDirectory ||
      !path.isAbsolute(entryFile) ||
      routeModules.length > 16
    )
      return null;
    const localStylesheets = listLocalPlainCss(appDirectory);
    if (!localStylesheets) return null;
    const moduleFiles = new Set<string>();
    let entryStylesheets: string[] | null = null;
    for (const module of routeModules) {
      const { filename } = module;
      if (
        moduleFiles.has(filename) ||
        !path.isAbsolute(filename) ||
        !isPathInside(filename, appDirectory) ||
        !observe(filename)?.isFile()
      )
        return null;
      moduleFiles.add(filename);
      const styles = readModuleStyleImports(module);
      if (!styles) return null;
      for (const style of styles) {
        recordExistenceProbe(style);
        if (!localStylesheets.has(style)) return null;
      }
      if (filename === entryFile) entryStylesheets = styles;
    }
    return entryStylesheets?.length
      ? {
          entryStylesheets: [...new Set(entryStylesheets)],
          localStylesheets: [...localStylesheets].sort(),
        }
      : null;
  } catch {
    return null;
  }
};
