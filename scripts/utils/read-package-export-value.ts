export const readPackageExportValue = (exportsValue: unknown, subpath: string): unknown => {
  if (typeof exportsValue !== "object" || exportsValue === null || Array.isArray(exportsValue)) {
    return subpath === "." ? exportsValue : undefined;
  }

  const hasSubpathKeys = Object.keys(exportsValue).some((exportKey) => exportKey.startsWith("."));
  if (hasSubpathKeys) return Reflect.get(exportsValue, subpath);
  return subpath === "." ? exportsValue : undefined;
};
