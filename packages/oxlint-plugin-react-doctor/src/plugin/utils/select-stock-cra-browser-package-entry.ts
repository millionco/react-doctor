interface StockCraBrowserPackageEntry {
  readonly packageName: string;
  readonly specifier: string;
  readonly manifest: Readonly<Record<string, unknown>>;
}

const STOCK_WEB_ESM_CONDITIONS = new Set([
  "webpack",
  "production",
  "browser",
  "import",
  "module",
  "module-sync",
  "typescript",
]);

const SAFE_MODULE_MEMBER =
  /^(?:[a-zA-Z0-9][a-zA-Z0-9._-]*\/)*[a-zA-Z0-9][a-zA-Z0-9._-]*[.](?:js|cjs|mjs)$/u;

const objectFields = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const safeMember = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const relative = value.replace(/^\.\//u, "");
  return SAFE_MODULE_MEMBER.test(relative) && !relative.split("/").includes("node_modules")
    ? relative
    : null;
};

const explicitExportMember = (value: unknown, wildcard?: string): string | null => {
  if (typeof value !== "string" || !value.startsWith("./")) return null;
  if (wildcard === undefined) return safeMember(value);
  if ((value.match(/[*]/gu)?.length ?? 0) > 1) return null;
  return safeMember(value.replace("*", wildcard));
};

const selectConditionalTarget = (value: unknown, wildcard?: string): string | null => {
  if (typeof value === "string") return explicitExportMember(value, wildcard);
  // Some stock packages publish a conditional first target alongside a
  // redundant default fallback. Refuse arrays with multiple live branches.
  if (Array.isArray(value)) {
    const first = value.length === 2 && objectFields(value[0]);
    if (!first || typeof value[1] !== "string" || first.default !== value[1]) return null;
    return selectConditionalTarget(first, wildcard);
  }
  const conditions = objectFields(value);
  if (!conditions || Object.keys(conditions).some((name) => name.startsWith("."))) return null;
  for (const [name, target] of Object.entries(conditions)) {
    if (name === "default" || STOCK_WEB_ESM_CONDITIONS.has(name)) {
      // This bounded selector handles one selected conditional object.
      return explicitExportMember(target, wildcard);
    }
  }
  return null;
};

const selectExport = (exports: unknown, subpath: string): string | null => {
  const fields = objectFields(exports);
  if (fields && Object.keys(fields).some((name) => name.startsWith("."))) {
    if (Object.keys(fields).some((name) => name !== "." && !name.startsWith("./"))) return null;
    if (Object.hasOwn(fields, subpath)) return selectConditionalTarget(fields[subpath]);
    const patterns = Object.keys(fields).filter((name) => name.includes("*"));
    if (patterns.length !== 1 || !patterns[0].endsWith("/*")) return null;
    const pattern = patterns[0];
    const prefix = pattern.slice(0, -1);
    if (prefix.includes("*") || !subpath.startsWith(prefix)) return null;
    const wildcard = subpath.slice(prefix.length);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(wildcard)) return null;
    return selectConditionalTarget(fields[pattern], wildcard);
  }
  return subpath === "." ? selectConditionalTarget(exports) : null;
};

// The caller verifies the selected physical package and the stock CRA
// production webpack 5.111.1 resolver. This selects a bounded, explicit JS member.
// It makes no claim about issuer manifest aliases or executable imports.
export const selectStockCraBrowserPackageEntry = ({
  packageName,
  specifier,
  manifest,
}: StockCraBrowserPackageEntry): string | null => {
  if (
    manifest.name !== packageName ||
    (specifier !== packageName && !specifier.startsWith(packageName + "/"))
  )
    return null;
  const subpath = "." + specifier.slice(packageName.length);
  if (/[!?#:\\]/u.test(subpath)) return null;

  const chosen =
    manifest.exports !== undefined
      ? selectExport(manifest.exports, subpath)
      : subpath !== "."
        ? safeMember(subpath)
        : safeMember(
            (typeof manifest.browser === "string" ? manifest.browser : undefined) ??
              manifest.module ??
              manifest.main ??
              "index.js",
          );
  if (!chosen) return null;

  const aliases = objectFields(manifest.browser);
  if (!aliases) return chosen;
  const keys = ["./" + chosen, chosen].filter((name) => Object.hasOwn(aliases, name));
  if (keys.length === 0) return chosen;
  if (keys.length !== 1) return null;
  const target = aliases[keys[0]];
  if (typeof target !== "string" || !target.startsWith("./")) return null;
  const renamed = safeMember(target);
  if (!renamed || Object.hasOwn(aliases, "./" + renamed) || Object.hasOwn(aliases, renamed))
    return null;
  return renamed;
};
