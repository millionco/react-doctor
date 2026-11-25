import * as fs from "node:fs";
import * as path from "node:path";
import { recordExistenceProbe } from "./cross-file-probe-recorder.js";
import { isPathInside } from "./is-path-inside.js";
import { readStyleFileDirectives } from "./read-vite8-local-style-directives.js";
import { readProviderMember } from "./stock-vite-providers/resolve-stock-physical-entry.js";

const stylePath = /^(?:\.\.?\/)+(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:css|scss)$/u;
const literalSassPath = /^(?:(?:\.\.?\/)+)?(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/u;
const maxStyleFiles = 64;

const isSelectedSourceFile = (root: string, file: string): boolean =>
  [path.join(root, "dev"), path.join(root, "src")].some((directory) =>
    isPathInside(file, directory),
  );

const stat = (filename: string) => {
  recordExistenceProbe(filename);
  return fs.lstatSync(filename, { throwIfNoEntry: false });
};

export const readNamedVite8StylesheetGraph = (
  root: string,
  issuer: string,
  specifier: string,
): readonly string[] | null => {
  if (!stylePath.test(specifier)) return null;
  const visited = new Set<string>();
  const pending = new Set<string>();
  const selectSassUse = (issuerFile: string, request: string): string | null => {
    if (!literalSassPath.test(request)) return null;
    const stem = path.resolve(path.dirname(issuerFile), request);
    if (!isSelectedSourceFile(root, stem)) return null;
    const underscored = path.join(path.dirname(stem), "_" + path.basename(stem));
    // Reject competing ordinary files, partials, import-only forms and index directories.
    if (stat(stem) || stat(underscored)) return null;
    let found: string | null = null;
    for (const suffix of [
      ".scss",
      ".sass",
      ".css",
      ".import.scss",
      ".import.sass",
      ".import.css",
    ]) {
      for (const variant of [stem, underscored]) {
        const filename = variant + suffix;
        const candidate = stat(filename);
        if (!candidate) continue;
        if (suffix !== ".scss" || found || !candidate.isFile()) return null;
        found = filename;
      }
    }
    return found;
  };
  const visit = (filename: string): boolean => {
    if (pending.has(filename) || !isSelectedSourceFile(root, filename)) return false;
    if (visited.has(filename)) return true;
    if (visited.size + pending.size >= maxStyleFiles) return false;
    const info = stat(filename);
    if (!info?.isFile() || info.size > 128 * 1024) return false;

    const bytes = readProviderMember(filename);
    if (!bytes) return false;
    const directives = readStyleFileDirectives(
      bytes.toString("utf8"),
      filename.endsWith(".scss"),
      "local-sass",
    );
    if (!directives) return false;
    pending.add(filename);
    for (const directive of directives) {
      const selected = directive.kind === "use" ? selectSassUse(filename, directive.source) : null;
      if (!selected || !visit(selected)) return false;
    }
    pending.delete(filename);
    visited.add(filename);
    return true;
  };
  try {
    return visit(path.resolve(path.dirname(issuer), specifier)) ? [...visited] : null;
  } catch {
    return null;
  }
};
