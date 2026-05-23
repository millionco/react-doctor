import fs from "node:fs";
import path from "node:path";
import type { Diagnostic, ReactDoctorConfig } from "./types/index.js";
import { collectIgnorePatterns } from "./collect-ignore-patterns.js";
import { readIgnoreFile } from "./read-ignore-file.js";
import { toRelativePath } from "./utils/to-relative-path.js";

interface CheckDeadCodeOptions {
  rootDirectory: string;
  /** Loaded react-doctor config — `ignore.files` is forwarded to deslop. */
  userConfig?: ReactDoctorConfig | null;
}

const TSCONFIG_FILENAMES = ["tsconfig.json", "tsconfig.base.json"];

const resolveTsConfigPath = (rootDirectory: string): string | undefined => {
  for (const filename of TSCONFIG_FILENAMES) {
    const candidate = path.join(rootDirectory, filename);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
};

// HACK: `collectIgnorePatterns` intentionally omits `.gitignore` because
// oxlint reads it automatically — deslop does not, so we pull it in.
const collectDeadCodeIgnorePatterns = (
  rootDirectory: string,
  userConfig: ReactDoctorConfig | null | undefined,
): string[] => {
  const seen = new Set<string>();
  const sources = [
    readIgnoreFile(path.join(rootDirectory, ".gitignore")),
    collectIgnorePatterns(rootDirectory),
    userConfig?.ignore?.files ?? [],
  ];
  for (const source of sources) {
    for (const pattern of source) seen.add(pattern);
  }
  return [...seen].filter((pattern) => pattern.length > 0);
};

// HACK: route through `toRelativePath` (which normalizes backslashes to
// forward slashes) so deslop output matches every other diagnostic on
// Windows. Downstream picomatch ignore-pattern matching requires POSIX
// separators or `src/**` overrides silently miss.
const toRelativeFilePath = (rootDirectory: string, filePath: string): string => {
  const relative = toRelativePath(filePath, rootDirectory);
  return relative.length > 0 ? relative : filePath.replace(/\\/g, "/");
};

export const checkDeadCode = async (options: CheckDeadCodeOptions): Promise<Diagnostic[]> => {
  const { rootDirectory, userConfig } = options;
  if (!fs.existsSync(path.join(rootDirectory, "package.json"))) return [];

  // HACK: lazy-load so a missing/incompatible native oxc binding inside
  // deslop-js can't crash module evaluation of @react-doctor/core
  // (which the entire CLI imports). The caller's try/catch then
  // catches the import failure and degrades gracefully.
  const { analyze, defineConfig } = await import("deslop-js");

  const ignorePatterns = collectDeadCodeIgnorePatterns(rootDirectory, userConfig);
  const result = await analyze(
    defineConfig({
      rootDir: rootDirectory,
      tsConfigPath: resolveTsConfigPath(rootDirectory),
      ...(ignorePatterns.length > 0 ? { ignorePatterns } : {}),
    }),
  );
  const toRelative = (filePath: string): string => toRelativeFilePath(rootDirectory, filePath);
  const diagnostics: Diagnostic[] = [];

  for (const unusedFile of result.unusedFiles) {
    diagnostics.push({
      filePath: toRelative(unusedFile.path),
      plugin: "deslop",
      rule: "unused-file",
      severity: "warning",
      message: "Unused file — not reachable from any entry point",
      help: "Delete the file if it is truly unreachable, or import it from an entry point.",
      line: 0,
      column: 0,
      category: "Dead Code",
    });
  }

  for (const unusedExport of result.unusedExports) {
    const label = unusedExport.isTypeOnly ? "type export" : "export";
    diagnostics.push({
      filePath: toRelative(unusedExport.path),
      plugin: "deslop",
      rule: unusedExport.isTypeOnly ? "unused-type" : "unused-export",
      severity: "warning",
      message: `Unused ${label}: \`${unusedExport.name}\``,
      help: "Drop the `export` keyword (or remove the declaration) if no other module uses this symbol.",
      line: unusedExport.line,
      column: unusedExport.column,
      category: "Dead Code",
    });
  }

  for (const unusedDependency of result.unusedDependencies) {
    const label = unusedDependency.isDevDependency ? "devDependency" : "dependency";
    diagnostics.push({
      filePath: "package.json",
      plugin: "deslop",
      rule: unusedDependency.isDevDependency ? "unused-dev-dependency" : "unused-dependency",
      severity: "warning",
      message: `Unused ${label}: \`${unusedDependency.name}\``,
      help: "Remove the dependency from package.json if it is genuinely unused.",
      line: 0,
      column: 0,
      category: "Dead Code",
    });
  }

  for (const cycle of result.circularDependencies) {
    if (cycle.files.length === 0) continue;
    diagnostics.push({
      filePath: toRelative(cycle.files[0]),
      plugin: "deslop",
      rule: "circular-dependency",
      severity: "warning",
      message: `Circular import cycle: ${cycle.files.map(toRelative).join(" → ")}`,
      help: "Break the cycle by extracting the shared code into a third module that both files import.",
      line: 0,
      column: 0,
      category: "Dead Code",
    });
  }

  return diagnostics;
};
