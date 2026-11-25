import * as fs from "node:fs";
import * as path from "node:path";
import { collectStencil2OutputPaths } from "./collect-stencil2-output-paths.js";
import { recordExistenceProbe } from "./cross-file-probe-recorder.js";
import { isPathInside } from "./is-path-inside.js";
import { readContainedStencilOutputPaths } from "./read-contained-stencil-outputs.js";
import { readGeneratedStencil2Owner } from "./read-generated-stencil2-owner.js";
import { readLocalStencilGeneratorModule } from "./read-local-stencil-generator-module.js";
import { readStockStencil2GeneratorImport } from "./read-stock-stencil2-generator-import.js";
import { readStockStencil2PnpmProviders } from "./read-stock-stencil2-pnpm-providers.js";
import {
  readStencilGeneratorModuleClosure,
  type StencilGeneratorImport,
} from "./read-stencil-generator-module-closure.js";
import { parseTsconfigJson } from "./resolve-tsconfig-alias.js";
import { readProviderMember } from "./stock-vite-providers/resolve-stock-physical-entry.js";

const maxSourceSize = 128 * 1024;

const lstat = (filename: string): fs.Stats | undefined => {
  recordExistenceProbe(filename);
  return fs.lstatSync(filename, { throwIfNoEntry: false });
};

const readOrdinarySource = (filename: string): string | null => {
  const info = lstat(filename);
  if (!info?.isFile() || info.size > maxSourceSize) return null;
  return readProviderMember(filename)?.toString("utf8") ?? null;
};

const hasProjectTsconfig = (filename: string, projectDirectory: string): boolean => {
  for (
    let directory = path.dirname(filename);
    directory !== projectDirectory;
    directory = path.dirname(directory)
  ) {
    if (
      !isPathInside(directory, projectDirectory) ||
      lstat(path.join(directory, "tsconfig.json")) ||
      lstat(path.join(directory, "jsconfig.json")) ||
      lstat(path.join(directory, "package.json"))
    )
      return false;
  }
  return true;
};

const readGeneratorTypeScriptOptions = (
  tsconfigs: readonly string[],
): { readonly usesProjectBaseUrl: boolean; readonly erasesUnusedTypeImports: boolean } | null => {
  const layerOptions = [];
  for (const tsconfig of tsconfigs) {
    const source = readOrdinarySource(tsconfig);
    const options = source === null ? undefined : parseTsconfigJson(source)?.compilerOptions;
    if (options === null || Array.isArray(options) || typeof options !== "object") return null;
    layerOptions.unshift(options as Record<string, unknown>);
  }
  if (layerOptions.length === 0) return null;
  // A parent baseUrl is resolved relative to its own file. This projection
  // models the build owner's base directory and ordinary esbuild import elision.
  if (layerOptions.slice(0, -1).some((options) => options.baseUrl !== undefined)) return null;
  const options = Object.assign({}, ...layerOptions);
  if (
    (options.baseUrl !== undefined && options.baseUrl !== ".") ||
    options.paths !== undefined ||
    options.jsxImportSource !== undefined ||
    options.moduleSuffixes !== undefined
  )
    return null;
  return {
    usesProjectBaseUrl: options.baseUrl !== undefined,
    erasesUnusedTypeImports:
      (options.verbatimModuleSyntax === undefined || options.verbatimModuleSyntax === false) &&
      (options.preserveValueImports === undefined || options.preserveValueImports === false) &&
      (options.importsNotUsedAsValues === undefined || options.importsNotUsedAsValues === "remove"),
  };
};

// Prepares the configuration proof for a declared fresh production build.
// The caller still has to prove the active launchers and lifecycle policy.
export const readGeneratedStencil2Configuration = (workspaceRoot: string, filename: string) => {
  try {
    const owner = readGeneratedStencil2Owner(workspaceRoot, filename);
    if (!owner || lstat(owner.generatedConfig)) return null;
    const { projectDirectory, configSource, sourceTsconfigs } = owner;
    const options = readGeneratorTypeScriptOptions(sourceTsconfigs);
    if (!options) return null;
    const providers = readStockStencil2PnpmProviders({
      workspaceRoot,
      projectDirectory,
      subjectDirectory: path.dirname(filename),
    });
    if (!providers) return null;
    const modules = new Map<string, string>();
    const reads = new Map<
      string,
      NonNullable<ReturnType<typeof readStockStencil2GeneratorImport>>
    >();
    const resolveImport = (issuer: string, request: string): StencilGeneratorImport | null => {
      if (request.startsWith(".")) {
        const target = readLocalStencilGeneratorModule(projectDirectory, issuer, request);
        if (!target || !hasProjectTsconfig(target.filename, projectDirectory)) return null;
        modules.set(target.filename, target.source);
        return { kind: "local", path: target.filename };
      }
      if (request === "path" || request === "node:path")
        return { kind: "builtin", name: "node:path" };
      if (request === "lightningcss")
        return { kind: "stock", path: providers.lightningCssEntry, provider: "lightningcss" };
      const key = issuer + "\0" + request;
      const selected =
        reads.get(key) ??
        readStockStencil2GeneratorImport(
          workspaceRoot,
          projectDirectory,
          issuer,
          request,
          options.usesProjectBaseUrl,
        );
      if (!selected) return null;
      reads.set(key, selected);
      return { kind: "stock", path: selected.entry, provider: selected.provider };
    };
    if (!hasProjectTsconfig(configSource, projectDirectory)) return null;
    const declaration = readStencilGeneratorModuleClosure(
      configSource,
      (sourceFile) => modules.get(sourceFile) ?? readOrdinarySource(sourceFile),
      resolveImport,
    );
    if (
      !declaration ||
      (declaration.requiresTypeScriptImportElision && !options.erasesUnusedTypeImports)
    )
      return null;

    const destinations = collectStencil2OutputPaths(
      projectDirectory,
      owner.generatedConfig,
      declaration.config,
    );
    if (!destinations) return null;
    const outputs = readContainedStencilOutputPaths({
      workspaceRoot,
      projectDirectory,
      outputs: [
        ...destinations,
        {
          absolutePath: path.join(projectDirectory, ".stencil"),
          kind: "directory",
          role: "builtin",
        },
        {
          absolutePath: path.join(projectDirectory, "src", "components.d.ts"),
          kind: "file",
          role: "component-types",
        },
      ],
      protectedInputs: [filename, ...sourceTsconfigs, ...declaration.localModules],
    });
    return (
      outputs && {
        owner,
        declaration,
        providerEntries: [...new Set([...reads.values()].map((provider) => provider.entry))],
        outputs,
      }
    );
  } catch {
    return null;
  }
};
