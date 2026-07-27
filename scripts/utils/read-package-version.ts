import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const readPackageVersion = (moduleUrl: string): string => {
  const packageRoot = path.dirname(fileURLToPath(moduleUrl));
  const manifestPath = path.join(packageRoot, "package.json");
  const manifest: unknown = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("version" in manifest) ||
    typeof manifest.version !== "string"
  ) {
    throw new Error(`Package manifest at ${manifestPath} has no string version.`);
  }
  return manifest.version;
};
