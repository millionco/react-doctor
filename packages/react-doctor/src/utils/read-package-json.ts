import fs from "node:fs";
import type { PackageJson } from "../types.js";

export const readPackageJson = (packageJsonPath: string): PackageJson => {
  try {
    return JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      const { code } = error as { code: string };
      if (code === "EISDIR" || code === "EACCES") {
        return {};
      }
    }
    throw error;
  }
};
