import * as fs from "node:fs";
import * as path from "node:path";
import type { SourceProjectTypedEdgeReader } from "./build-source-project-index.js";
import { recordDirectoryProbe, recordExistenceProbe } from "./cross-file-probe-recorder.js";
import { getViteJsonImportDirectory } from "./vite-json-import-directory.js";
import { isInferredTypeOnlyAssertionImport } from "./is-inferred-type-only-assertion-import.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveViteSource, type EntryKind, type StaticAlias } from "./resolve-vite-source.js";

interface ViteTypedEdgeProfile {
  readonly projectDirectory: string;
  readonly aliases: readonly StaticAlias[];
  // Supplied only after the live emitter and effective per-source settings
  // are proved. The caller owns tsconfig, transform and package authority.
  readonly assertionImportOptions?: (
    filename: string,
  ) => Parameters<typeof isInferredTypeOnlyAssertionImport>[3] | undefined;
  readonly defaultJsonModuleEmitter: boolean;
}

const probeEntry = (candidate: string): EntryKind => {
  recordExistenceProbe(candidate);
  const stat = fs.lstatSync(candidate, { throwIfNoEntry: false });
  return stat?.isFile() ? "file" : stat?.isDirectory() ? "directory" : stat ? "unknown" : "missing";
};

const readFiniteJsonModules = (directory: string, projectDirectory: string): string[] | null => {
  // Track the negative and membership checks before reads. Realpath
  // transport is handled by the owning scan/provider proof.
  recordDirectoryProbe(directory);
  for (
    let candidate = directory;
    candidate !== projectDirectory;
    candidate = path.dirname(candidate)
  ) {
    if (probeEntry(candidate) !== "directory") return null;
    recordDirectoryProbe(path.dirname(candidate));
    if (candidate === path.dirname(candidate)) return null;
  }
  if (fs.realpathSync(directory) !== directory) return null;
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const filenames: string[] = [];
  for (const entry of entries) {
    if (!entry.name.endsWith(".json")) continue;
    const filename = path.join(directory, entry.name);
    if (!entry.isFile() || probeEntry(filename) !== "file") return null;
    filenames.push(filename);
  }
  return filenames.length > 0 ? filenames.sort() : null;
};

// This expands only the locally observable edge set of the selected Vite
// emitter. Provider/transform authority and JSX caller eligibility remain
// independent obligations.
export const createViteTypedRuntimeEdgeReader =
  (profile: ViteTypedEdgeProfile): SourceProjectTypedEdgeReader =>
  (module, node, source) => {
    if (isNodeOfType(node, "CallExpression") || isNodeOfType(node, "NewExpression")) {
      const callee = node.callee;
      if (
        isNodeOfType(callee, "Identifier") &&
        (callee.name === "eval" || callee.name === "Function") &&
        module.scopes.isGlobalReference(callee)
      )
        return { kind: "opaque" };
      if (
        isNodeOfType(callee, "MemberExpression") &&
        isNodeOfType(callee.object, "Identifier") &&
        callee.object.name === "jest" &&
        module.scopes.isGlobalReference(callee.object)
      ) {
        // The Vite emitter projection cannot certify a test-runner resolver or
        // module substitution. Keep the test issuer opaque until that route
        // independently supplies its bounded mock semantics.
        return { kind: "opaque" };
      }
    }
    if (isNodeOfType(node, "WithStatement")) return { kind: "opaque" };

    if (source === null) {
      if (!profile.defaultJsonModuleEmitter) return null;
      const directory = getViteJsonImportDirectory(node, module.filePath, profile.projectDirectory);
      if (!directory) return null;
      const filenames = readFiniteJsonModules(directory.path, profile.projectDirectory);
      return filenames ? { kind: "data", filenames } : { kind: "opaque" };
    }

    const result = resolveViteSource({
      fromFilename: module.filePath,
      projectDirectory: profile.projectDirectory,
      aliases: profile.aliases,
      specifier: source,
      probe: probeEntry,
    });
    if (result.kind === "file") return { kind: "file", filename: result.filename };
    if (
      result.kind === "external" &&
      !source.includes(":") &&
      !source.includes("?") &&
      !source.includes("#")
    ) {
      return { kind: "external" };
    }
    if (result.kind === "missing" && isNodeOfType(node, "ImportDeclaration")) {
      const options = profile.assertionImportOptions?.(module.filePath);
      if (
        options &&
        isInferredTypeOnlyAssertionImport(node, module.programNode, module.scopes, options)
      ) {
        return { kind: "erased" };
      }
    }
    return { kind: "opaque" };
  };
