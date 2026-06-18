import type { DependencyGraph, UnusedFile, SourceModule } from "../types.js";

const EXCLUDED_EXTENSIONS = new Set([
  ".html",
  ".mdx",
  ".md",
  ".css",
  ".scss",
  ".less",
  ".sass",
  ".graphql",
  ".gql",
]);

const TEST_FILE_PATTERN = /(?:\.(?:test|spec|stories|story|cy)\.|(?:^|\/)__tests__\/)/;

const EXCLUDED_DIRECTORY_PATTERN =
  /(?:^|\/)(?:e2e|cypress|playwright|__fixtures__|__snapshots__|scripts)\/(?!.*node_modules)/;

const CONFIG_FILE_PATTERN =
  /(?:^|\/)(?:[^/]+\.config\.[tj]sx?$|[^/]+\.setup\.[tj]sx?$|setupTests\.[tj]sx?$|jest\.setup\.[tj]sx?$|vitest\.setup\.[tj]sx?$)/;

const hasExcludedExtension = (filePath: string): boolean => {
  const lastDot = filePath.lastIndexOf(".");
  if (lastDot === -1) return false;
  return EXCLUDED_EXTENSIONS.has(filePath.slice(lastDot));
};

const isExcludedByPattern = (filePath: string): boolean =>
  TEST_FILE_PATTERN.test(filePath) ||
  EXCLUDED_DIRECTORY_PATTERN.test(filePath) ||
  CONFIG_FILE_PATTERN.test(filePath);

/**
 * Files the parser couldn't analyze (minified bundles, oversized files, binaries)
 * have no detectable imports — they're effectively opaque. Flagging them as
 * "unused" is a false positive because we can't see who imports them, and they
 * may be static assets, generated bundles, or build artifacts that get loaded
 * outside the JS module graph (HTML `<script src>`, `vite-plugin-string`, etc.).
 * The parser already records a `file-minified`/`file-too-large`/`file-binary`
 * info-level entry in `analysisErrors`, which is the actionable signal.
 */
const PARSE_OPAQUE_ERROR_CODES = new Set(["file-minified", "file-too-large", "file-binary"]);

const isOpaqueToAnalysis = (module: SourceModule): boolean =>
  module.parseErrors.some(
    (parseError) => parseError.code && PARSE_OPAQUE_ERROR_CODES.has(parseError.code),
  );

export const detectOrphanFiles = (graph: DependencyGraph): UnusedFile[] => {
  const unusedFiles: UnusedFile[] = [];

  for (const module of graph.modules) {
    if (module.isReachable) continue;
    if (module.isEntryPoint) continue;
    if (module.isDeclarationFile) continue;
    if (module.isConfigFile) continue;
    if (module.isGitIgnored) continue;
    if (hasExcludedExtension(module.fileId.path)) continue;
    if (isExcludedByPattern(module.fileId.path)) continue;
    if (isOpaqueToAnalysis(module)) continue;
    if (isBarrelWithReachableSources(module, graph)) continue;
    if (hasReachableDirectImporter(module.fileId.index, graph)) continue;

    unusedFiles.push({ path: module.fileId.path });
  }

  return unusedFiles;
};

const isBarrelWithReachableSources = (module: SourceModule, graph: DependencyGraph): boolean => {
  if (module.exports.length === 0) return false;

  const hasOnlyReExports = module.exports.every(
    (exportInfo) => exportInfo.isNamespaceReExport || exportInfo.isSynthetic,
  );
  if (!hasOnlyReExports) return false;

  for (const edge of graph.edges) {
    if (edge.source === module.fileId.index) {
      const targetModule = graph.modules[edge.target];
      if (targetModule?.isReachable) return true;
    }
  }

  return false;
};

const hasReachableDirectImporter = (targetModuleIndex: number, graph: DependencyGraph): boolean => {
  for (const edge of graph.edges) {
    if (edge.target !== targetModuleIndex) continue;
    if (edge.isReExportEdge) continue;
    const importerModule = graph.modules[edge.source];
    if (importerModule?.isReachable) return true;
  }
  return false;
};
