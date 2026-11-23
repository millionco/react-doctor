import * as fs from "node:fs";
import * as path from "node:path";
import { STOCK_GATSBY_MAX_STYLESHEET_BYTES } from "../constants/design.js";
import { buildSourceProjectIndex } from "./build-source-project-index.js";
import type { SourceProjectIndex } from "./build-source-project-index.js";
import { recordContentProbe, recordExistenceProbe } from "./cross-file-probe-recorder.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { normalizeFilename } from "./normalize-filename.js";
import { parseSourceFile } from "./parse-source-file.js";
import { findNearestPackageDirectory } from "./read-nearest-package-manifest.js";
import { walkAst } from "./walk-ast.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { hasGeometryNeutralStaticStylesheetRoute } from "./has-geometry-neutral-static-stylesheet-route.js";
import { readDeclaredStockGatsbyV1Provider } from "./read-declared-stock-gatsby-v1-provider.js";
import { readDeclaredGatsbyV1StyledSsrRoute } from "./read-declared-gatsby-v1-styled-ssr-route.js";
import { hasGatsbyJsxThemeRoute } from "./has-gatsby-jsx-theme-route.js";
import { readLocalStyledThemeProof } from "./read-local-styled-theme-proof.js";
import { hasReviewedGatsbyV1AssetImports } from "./has-reviewed-gatsby-v1-asset-imports.js";
import { hasStockGatsbyV1BabelInputs } from "./has-stock-gatsby-v1-babel-inputs.js";
import { hasUnshadowedStockGatsbyV1Entries } from "./has-unshadowed-stock-gatsby-v1-entries.js";
import { preservesStockGatsbyV1IndexPage } from "./preserves-stock-gatsby-v1-index-page.js";
import { readClosedStockGatsbyV1FrontmatterPaths } from "./read-closed-stock-gatsby-v1-frontmatter-paths.js";

interface StockGatsbyImageThemeContext {
  readonly project: SourceProjectIndex;
  readonly root: string;
  readonly theme: NonNullable<ReturnType<typeof readLocalStyledThemeProof>>;
}

const readOwnStylesheet = (root: string, filename: string): string | null => {
  const relative = path.relative(root, filename);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(".." + path.sep) ||
    path.isAbsolute(relative)
  )
    return null;
  recordExistenceProbe(filename);
  recordContentProbe(filename);
  try {
    const stat = fs.lstatSync(filename);
    return stat.isFile() &&
      stat.size <= STOCK_GATSBY_MAX_STYLESHEET_BYTES &&
      normalizeFilename(fs.realpathSync.native(filename)) === normalizeFilename(filename)
      ? fs.readFileSync(filename, "utf8")
      : null;
  } catch {
    return null;
  }
};

const hasStaticStylesheetProjection = (root: string, index: SourceProjectIndex): boolean => {
  const entries = new Set<string>();
  let opaqueImport = false;
  for (const module of index.modulesByFilePath.values()) {
    walkAst(module.programNode, (node) => {
      if (opaqueImport) return false;
      if (
        !isNodeOfType(node, "Literal") ||
        typeof node.value !== "string" ||
        !/\.css(?:[?#]|$)/i.test(node.value)
      )
        return;
      const parent = node.parent;
      if (
        !isNodeOfType(parent, "ImportDeclaration") ||
        parent.source !== node ||
        !/^\.\.?\/.+\.css$/.test(node.value) ||
        parent.specifiers.length !== 0
      ) {
        opaqueImport = true;
        return false;
      }
      entries.add(path.resolve(path.dirname(module.filePath), node.value));
    });
  }
  if (opaqueImport || entries.size === 0) return false;
  return [...entries].every((entry) =>
    hasGeometryNeutralStaticStylesheetRoute(entry, {
      readCss: (file) => readOwnStylesheet(root, file),
      resolveCss: (file, request) => path.resolve(path.dirname(file), request),
    }),
  );
};

const readStockGatsbyImageThemeContext = (
  filename: string,
  scopes: ScopeAnalysis,
): StockGatsbyImageThemeContext | null => {
  const program = scopes.rootScope.node;
  if (!filename || !isNodeOfType(program, "Program")) return null;
  const packageDirectory = findNearestPackageDirectory(filename);
  if (!packageDirectory) return null;
  const root = path.resolve(packageDirectory);
  const declaredRoute = readDeclaredGatsbyV1StyledSsrRoute(root);
  if (!declaredRoute || !hasUnshadowedStockGatsbyV1Entries(root, declaredRoute.pluginNames))
    return null;
  const index = buildSourceProjectIndex({
    rootDirectory: root,
    currentFilePath: filename,
    currentProgramNode: program,
    currentScopes: scopes,
    javascriptAllowsJsx: true,
    includeTestlikeSources: true,
    includeOutputFoldersUnder: declaredRoute.sourceDirectory,
  });
  if (!index) return null;
  const sourceFiles = [...index.modulesByFilePath.keys()];
  if (
    !hasReviewedGatsbyV1AssetImports(root, index) ||
    !hasStockGatsbyV1BabelInputs(root, sourceFiles)
  )
    return null;
  const stockProviders = readDeclaredStockGatsbyV1Provider(
    root,
    declaredRoute.pluginNames,
    sourceFiles,
  );
  if (!stockProviders) return null;
  for (const hook of declaredRoute.runtimeHookPaths) {
    const name = path.basename(hook);
    if (name !== "gatsby-node.js" && name !== "gatsby-browser.js") return null;
    const parsed = parseSourceFile(hook);
    if (!isNodeOfType(parsed, "Program")) return null;
    if (name === "gatsby-browser.js") {
      if (parsed.body.length !== 0) return null;
    } else if (
      !preservesStockGatsbyV1IndexPage({
        program: parsed,
        scopes: analyzeScopes(parsed),
        isStockRequire: (specifier) =>
          specifier === "path" || specifier === "node:path" || stockProviders.has(specifier),
        readClosedFrontmatterPaths: (query) =>
          readClosedStockGatsbyV1FrontmatterPaths({
            siteDirectory: root,
            effectiveSourceDirectory: declaredRoute.sourceDirectory,
            ...query,
          }),
      })
    )
      return null;
  }
  const theme = readLocalStyledThemeProof(index, filename);
  if (!theme || !hasStaticStylesheetProjection(root, index)) return null;
  return { project: index, root, theme };
};

export const createStockGatsbyImageThemeResolver = (
  filename: string | undefined,
  getScopes: () => ScopeAnalysis,
) => {
  let context: StockGatsbyImageThemeContext | null | undefined;
  return (image: EsTreeNodeOfType<"JSXOpeningElement">): ReadonlyMap<string, string> | null => {
    if (!filename) return null;
    const currentFilePath = normalizeFilename(filename);
    if (context === undefined)
      context = readStockGatsbyImageThemeContext(currentFilePath, getScopes());
    if (!context) return null;
    const { project, root, theme } = context;
    return hasGatsbyJsxThemeRoute({
      project,
      packageDirectory: root,
      currentFilePath,
      currentImage: image,
      providerModule: theme.provider.module,
      providerOpening: theme.provider.node,
    })
      ? theme.colors
      : null;
  };
};
