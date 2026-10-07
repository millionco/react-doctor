import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const hasExpoReactServerFunctions = (rootDirectory: string): boolean => {
  try {
    const appConfig = JSON.parse(readFileSync(resolve(rootDirectory, "app.json"), "utf-8"));
    return appConfig?.expo?.experiments?.reactServerFunctions === true;
  } catch {
    return false;
  }
};
