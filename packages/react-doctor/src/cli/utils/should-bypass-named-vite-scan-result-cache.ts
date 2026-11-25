import { isErrnoException } from "@react-doctor/core";
import * as fs from "node:fs";
import * as path from "node:path";

// Named Vite compiler proofs consult installed and ignored inputs that the
// Git-based whole-result key cannot represent. Probe the same post-rootDir
// project root used by lint settings, before either replay or storage.
export const shouldBypassNamedViteScanResultCache = (
  projectDirectory: string,
  lint: boolean,
): boolean => {
  if (!lint) return false;
  try {
    fs.statSync(path.join(projectDirectory, "dev", "vite.config.ts"));
    return true;
  } catch (error) {
    const code = isErrnoException(error) ? error.code : undefined;
    // Only a definitely absent marker proves the named route inapplicable.
    return code !== "ENOENT" && code !== "ENOTDIR";
  }
};
