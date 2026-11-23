import * as path from "node:path";

type Marker = "missing" | "file" | "directory" | "opaque";
interface LookupInput {
  readonly assetFilename: string;
  readonly workingDirectory: string;
  readonly homeDirectory: string;
  readonly probe: (absolutePath: string) => Marker;
  readonly readPackage: (absolutePath: string) => Record<string, unknown> | null;
}
const META_EXTENSIONS = [".json", ".yaml", ".yml", ".js", ".ts", ".cjs", ".mjs"];
const ASYNC_RC_EXTENSIONS = ["", ...META_EXTENSIONS];
const VITE_SVGR_CONFIG_FILES = [
  ...ASYNC_RC_EXTENSIONS.map((extension) => ".svgrrc" + extension),
  ...ASYNC_RC_EXTENSIONS.map((extension) => path.join(".config", "svgrrc" + extension)),
  ...[".js", ".ts", ".cjs", ".mjs"].map((extension) => "svgr.config" + extension),
];
const excludesPackageProperty = (
  directory: string,
  name: string,
  { probe, readPackage }: LookupInput,
): boolean => {
  const manifest = path.join(directory, "package.json");
  const marker = probe(manifest);
  if (marker === "missing") return true;
  if (marker !== "file") return false;
  const properties = readPackage(manifest);
  return properties !== null && !Object.hasOwn(properties, name);
};

// @svgr/core 8.1 uses the asynchronous default explorer. Its cosmiconfig 8.3.6
// first loads meta config at the build cwd, then searches up from each asset.
export const hasNoImplicitSvgConfig = (input: LookupInput): boolean => {
  const { assetFilename, workingDirectory, homeDirectory, probe } = input;
  if (
    ![assetFilename, workingDirectory, homeDirectory].every(path.isAbsolute) ||
    probe(workingDirectory) !== "directory"
  )
    return false;
  if (
    !excludesPackageProperty(workingDirectory, "cosmiconfig", input) ||
    META_EXTENSIONS.some(
      (extension) => probe(path.join(workingDirectory, ".config" + extension)) !== "missing",
    )
  ) {
    return false;
  }

  for (let directory = path.dirname(assetFilename); ; directory = path.dirname(directory)) {
    if (probe(directory) !== "directory" || !excludesPackageProperty(directory, "svgr", input)) {
      return false;
    }
    const configDirectory = probe(path.join(directory, ".config"));
    if (configDirectory !== "missing" && configDirectory !== "directory") return false;
    if (VITE_SVGR_CONFIG_FILES.some((name) => probe(path.join(directory, name)) !== "missing")) {
      return false;
    }
    if (directory === homeDirectory || directory === path.dirname(directory)) return true;
  }
};
