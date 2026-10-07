import { extractPackageName } from "./package-name.js";

const collectPluginPackageNames = (value: unknown, packageNames: Set<string>): void => {
  if (!Array.isArray(value)) return;
  for (const plugin of value) {
    if (typeof plugin !== "string") continue;
    const packageName = extractPackageName(plugin);
    if (packageName) packageNames.add(packageName);
  }
};

const collectPartPackageNames = (value: unknown, packageNames: Set<string>): void => {
  if (!Array.isArray(value)) return;
  for (const part of value) {
    if (!part || typeof part !== "object" || typeof part.name !== "string") continue;
    const specifier = part.name.replace(/^(?:all:)?part:/, "");
    const packageName = extractPackageName(specifier);
    if (packageName) packageNames.add(packageName);
  }
};

export const collectSanityV2PackageNames = (content: string): Set<string> => {
  const packageNames = new Set<string>();
  try {
    const manifest = JSON.parse(content);
    if (!manifest || typeof manifest !== "object" || manifest.root !== true) return packageNames;
    collectPluginPackageNames(manifest.plugins, packageNames);
    collectPartPackageNames(manifest.parts, packageNames);
    if (manifest.env && typeof manifest.env === "object") {
      for (const environment of Object.values(manifest.env)) {
        if (!environment || typeof environment !== "object") continue;
        collectPluginPackageNames(Reflect.get(environment, "plugins"), packageNames);
      }
    }
  } catch {
    return packageNames;
  }
  return packageNames;
};
