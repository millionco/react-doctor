import { readNearestPackageManifest } from "./read-nearest-package-manifest.js";

// True when the nearest `package.json` declares a `bin` entry — the package
// is a CLI or a framework with a command-line entry point (gatsby, a mailer
// preview server, a codegen tool). Non-React source files inside such
// packages run in the Node process, not in a user's browser bundle.
export const isInsideNodeCliPackage = (filename: string | undefined): boolean => {
  if (!filename) return false;
  const manifest = readNearestPackageManifest(filename);
  if (!manifest) return false;
  return (
    typeof manifest.bin === "string" || (typeof manifest.bin === "object" && manifest.bin !== null)
  );
};
