interface StaticEsmPackageExportInput {
  readonly manifest: unknown;
  readonly packageName: string;
  readonly subpath: string;
}

const DIRECT_EXPORT_CONDITIONS = new Set(["types", "require", "import", "default"]);
const LOCAL_ESM_EXPORT_PATTERN = /^\.\/(?:[\w-]+\/)*[\w-]+\.mjs$/;

export const getStaticEsmPackageExportTarget = ({
  manifest,
  packageName,
  subpath,
}: StaticEsmPackageExportInput): string | null => {
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("name" in manifest) ||
    manifest.name !== packageName ||
    "browser" in manifest ||
    !("exports" in manifest) ||
    typeof manifest.exports !== "object" ||
    manifest.exports === null ||
    Array.isArray(manifest.exports) ||
    Object.keys(manifest.exports).some(
      (key) => key !== "." && (!key.startsWith("./") || key.includes("*")),
    )
  )
    return null;

  if (!Object.hasOwn(manifest.exports, subpath)) return null;
  const exported: unknown = Reflect.get(manifest.exports, subpath);
  let target: unknown;
  if (typeof exported === "string") {
    target = exported;
  } else if (
    typeof exported === "object" &&
    exported !== null &&
    !Array.isArray(exported) &&
    Object.keys(exported).every((key) => DIRECT_EXPORT_CONDITIONS.has(key)) &&
    "import" in exported &&
    Object.hasOwn(exported, "import") &&
    typeof exported.import === "string" &&
    (!Object.hasOwn(exported, "default") || Reflect.get(exported, "default") === exported.import)
  ) {
    target = exported.import;
  }
  return typeof target === "string" &&
    LOCAL_ESM_EXPORT_PATTERN.test(target) &&
    !target.split("/").includes("node_modules")
    ? target
    : null;
};
