import * as fs from "node:fs";
import * as path from "node:path";
import { findNearestPackageDirectory } from "./classify-package-platform.js";
import { recordContentProbe } from "./cross-file-probe-recorder.js";

const cachedResultByPackageDirectory = new Map<string, boolean>();

// True when the nearest `package.json` declares a `bin` entry — the package
// is a CLI or a framework with a command-line entry point (gatsby, a mailer
// preview server, a codegen tool). Non-React source files inside such
// packages run in the Node process, not in a user's browser bundle.
export const isInsideNodeCliPackage = (filename: string | undefined): boolean => {
  if (!filename) return false;
  const packageDirectory = findNearestPackageDirectory(filename);
  if (!packageDirectory) return false;
  const packageJsonPath = path.join(packageDirectory, "package.json");
  recordContentProbe(packageJsonPath);
  const cached = cachedResultByPackageDirectory.get(packageDirectory);
  if (cached !== undefined) return cached;
  let result = false;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    if (typeof parsed === "object" && parsed !== null && "bin" in parsed) {
      const binField = (parsed as { bin?: unknown }).bin;
      result = typeof binField === "string" || (typeof binField === "object" && binField !== null);
    }
  } catch {
    result = false;
  }
  cachedResultByPackageDirectory.set(packageDirectory, result);
  return result;
};
