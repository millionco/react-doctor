import * as path from "node:path";

export const isLocalModuleSpecifier = (moduleSpecifier: string): boolean =>
  moduleSpecifier === "." ||
  moduleSpecifier === ".." ||
  moduleSpecifier.startsWith("./") ||
  moduleSpecifier.startsWith("../") ||
  path.isAbsolute(moduleSpecifier);
