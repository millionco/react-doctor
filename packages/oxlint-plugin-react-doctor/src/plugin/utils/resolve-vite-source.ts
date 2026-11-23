import * as path from "node:path";

export const DEFAULT_VITE_EXTENSIONS = [
  ".mjs",
  ".js",
  ".mts",
  ".ts",
  ".jsx",
  ".tsx",
  ".json",
] as const;

export type EntryKind = "file" | "directory" | "missing" | "unknown";
export type LocalResolution =
  | { kind: "file"; filename: string }
  | { kind: "external" | "missing" | "unknown" };

export interface StaticAlias {
  readonly find: string;
  readonly replacement: string;
}
interface ViteSourceInput {
  readonly fromFilename: string;
  readonly specifier: string;
  readonly projectDirectory: string;
  readonly aliases: readonly StaticAlias[];
  readonly probe: (filename: string) => EntryKind;
}

const normalizeAlias = ({ find, replacement }: StaticAlias): StaticAlias =>
  find.endsWith("/") && replacement.endsWith("/")
    ? { find: find.slice(0, -1), replacement: replacement.slice(0, -1) }
    : { find, replacement };

const isBelow = (absolutePath: string, projectDirectory: string): boolean => {
  const relative = path.relative(projectDirectory, absolutePath);
  return relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
};

const getSearchLocation = ({
  fromFilename,
  specifier,
  projectDirectory,
  aliases,
}: Omit<ViteSourceInput, "probe">): string | null => {
  for (const rawAlias of aliases) {
    const { find, replacement } = normalizeAlias(rawAlias);
    if (specifier === find || specifier.startsWith(find + "/")) {
      return path.join(replacement, specifier.slice(find.length));
    }
  }
  if (specifier.startsWith("./") || specifier.startsWith("../") || specifier === ".") {
    return path.resolve(path.dirname(fromFilename), specifier);
  }
  if (specifier.startsWith("/") && !specifier.startsWith("//")) {
    return path.resolve(projectDirectory, "." + specifier);
  }
  return null;
};

const tsSubstitutions = (filename: string): string[] => {
  const extension = path.extname(filename);
  if (extension === ".js") return [filename.slice(0, -3) + ".ts", filename.slice(0, -3) + ".tsx"];
  if ([".jsx", ".mjs", ".cjs"].includes(extension)) {
    return [filename.slice(0, -extension.length) + extension.replace("js", "ts")];
  }
  return [];
};

// Models Vite's default local filesystem route once the caller proves the
// active aliases and absence of custom resolution or asset transforms.
export const resolveViteSource = (input: ViteSourceInput): LocalResolution => {
  const { probe, projectDirectory, fromFilename } = input;
  const [base] = input.specifier.split(/[?#]/u, 1);
  if (
    !base ||
    base.includes("\\") ||
    base.includes("\u0000") ||
    !isBelow(fromFilename, projectDirectory)
  ) {
    return { kind: "unknown" };
  }
  const location = getSearchLocation({ ...input, specifier: base });
  if (location === null) return { kind: "external" };
  if (
    !path.isAbsolute(location) ||
    !isBelow(location, projectDirectory) ||
    base !== input.specifier
  ) {
    return { kind: "unknown" };
  }
  for (
    let directory = path.dirname(location);
    isBelow(directory, projectDirectory);
    directory = path.dirname(directory)
  ) {
    const kind = probe(directory);
    if (kind === "unknown") return { kind: "unknown" };
    if (kind !== "directory") return { kind: "missing" };
    if (directory === projectDirectory) break;
  }
  const initial = probe(location);
  if (initial === "unknown") return { kind: "unknown" };
  if (initial === "file") return { kind: "file", filename: location };

  for (const candidate of [
    ...tsSubstitutions(location),
    ...DEFAULT_VITE_EXTENSIONS.map((extension) => location + extension),
  ]) {
    const kind = probe(candidate);
    if (kind === "unknown") return { kind: "unknown" };
    if (kind === "file") return { kind: "file", filename: candidate };
  }
  if (initial === "directory") {
    // A package entry needs the active package conditions and main field order.
    // Treat it as opaque until the calling provider proof supplies that model.
    if (probe(path.join(location, "package.json")) !== "missing") return { kind: "unknown" };
    for (const extension of DEFAULT_VITE_EXTENSIONS) {
      const candidate = path.join(location, "index" + extension);
      const kind = probe(candidate);
      if (kind === "unknown") return { kind: "unknown" };
      if (kind === "file") return { kind: "file", filename: candidate };
    }
  }
  return { kind: "missing" };
};
