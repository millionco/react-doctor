import * as path from "node:path";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import { buildSourceProjectIndex } from "../../../utils/build-source-project-index.js";
import type { SourceProjectIndex } from "../../../utils/build-source-project-index.js";
import {
  captureCrossFileProbes,
  replayCrossFileProbes,
} from "../../../utils/cross-file-probe-recorder.js";
import type { CapturedCrossFileProbes } from "../../../utils/cross-file-probe-recorder.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { normalizeFilename } from "../../../utils/normalize-filename.js";
import {
  findNearestPackageDirectory,
  readPackageManifest,
} from "../../../utils/read-nearest-package-manifest.js";
import { walkAst } from "../../../utils/walk-ast.js";

interface ServiceExports {
  readonly className: string | null;
  readonly singletonNames: ReadonlySet<string>;
}

type TrackImport = (binding: SymbolDescriptor, scopes: ScopeAnalysis) => boolean;

const projectByProgram = new WeakMap<
  EsTreeNode,
  CapturedCrossFileProbes<SourceProjectIndex | null>
>();

const unresolvedLocalCodeSource = (source: string): boolean => {
  if (!/^(?:\.{1,2}\/|\/|[@~]\/|#)/u.test(source)) return false;
  const withoutQuery = source.split("?", 1)[0] ?? source;
  const extension = path.posix.extname(withoutQuery);
  return extension.length === 0 || /^\.(?:[cm]?[jt]sx?|vue|svelte|astro|mdx)$/iu.test(extension);
};

export const tracksExportedServiceHookConsumers = (
  definingNode: EsTreeNode,
  definingScopes: ScopeAnalysis,
  filename: string | undefined,
  exports: ServiceExports,
  trackImport: TrackImport,
): boolean => {
  if (exports.className === null && exports.singletonNames.size === 0) return true;
  if (!filename || !path.isAbsolute(filename)) return false;
  const program = findProgramRoot(definingNode);
  if (!program) return false;
  const origin = normalizeFilename(filename);
  const root = findNearestPackageDirectory(origin);
  const manifest = root ? readPackageManifest(root) : null;
  if (!root || manifest?.private !== true || manifest.exports || manifest.main || manifest.module)
    return false;

  let cached = projectByProgram.get(program);
  if (cached === undefined) {
    cached = captureCrossFileProbes(() =>
      buildSourceProjectIndex({
        rootDirectory: root,
        currentFilePath: origin,
        currentProgramNode: program,
        currentScopes: definingScopes,
        includeTestlikeSources: true,
      }),
    );
    projectByProgram.set(program, cached);
  } else {
    replayCrossFileProbes(cached.trace);
  }
  const index = cached.value;
  if (
    !index ||
    !index.modulesByFilePath.has(origin) ||
    index.hasOpaqueMdxConsumerSurface ||
    index.hasOpaqueRuntimeConsumerSurface ||
    [...index.unresolvedRuntimeSources].some(unresolvedLocalCodeSource)
  ) {
    return false;
  }

  for (const consumer of index.consumerModulesByFilePath.get(origin) ?? []) {
    // Inline scripts are included as incoming edges, but the rule will not
    // report a replacement warning in an HTML file.
    if (index.htmlFilePaths.includes(consumer.filePath)) return false;
    let open = false;
    walkAst(consumer.programNode, (node) => {
      if (open) return false;
      if (index.resolvedSourcePathByNode.get(node) !== origin) return;
      if (!isNodeOfType(node, "ImportDeclaration")) {
        open = true;
        return false;
      }
      for (const specifier of node.specifiers) {
        if (isNodeOfType(specifier, "ImportNamespaceSpecifier")) {
          open = true;
          return false;
        }
        if (!isNodeOfType(specifier, "ImportSpecifier") || specifier.importKind === "type")
          continue;
        const importedName = getImportedName(specifier);
        if (
          !importedName ||
          (!exports.singletonNames.has(importedName) && importedName !== exports.className)
        )
          continue;
        const binding = consumer.scopes.symbolFor(specifier.local);
        if (
          !binding ||
          (importedName === exports.className
            ? binding.references.length > 0
            : !trackImport(binding, consumer.scopes))
        ) {
          open = true;
          return false;
        }
      }
    });
    if (open) return false;
  }
  return true;
};
