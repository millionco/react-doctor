import type { PackageManifest } from "../../plugin/utils/read-nearest-package-manifest.js";

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parseResourceManifest = (sourceText: string | null): PackageManifest | null => {
  if (sourceText === null) return null;
  try {
    const parsedValue: unknown = JSON.parse(sourceText);
    return isObjectRecord(parsedValue) ? parsedValue : null;
  } catch {
    return null;
  }
};
