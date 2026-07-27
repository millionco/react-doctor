import * as path from "node:path";
import {
  resolveResourceModuleFileFromAbsolutePath,
  resolveResourceRelativeImport,
} from "../../internal/resource-host/resolve-resource-module.js";
import { getCurrentResourceHost } from "../../internal/resource-host/resource-host-context.js";
import { getRealResourceHostBackend } from "../../internal/resource-host/real-resource-host-backend.js";

export const resolveModuleFileFromAbsolutePath = (importPath: string): string | null => {
  const currentResourceHost = getCurrentResourceHost();
  if (currentResourceHost) {
    const resolvedFilePath = currentResourceHost.resolveModuleFile(importPath);
    return resolvedFilePath === null ? null : path.normalize(resolvedFilePath);
  }
  const absoluteImportPath = path.resolve(importPath);
  const resolvedFilePath = resolveResourceModuleFileFromAbsolutePath(
    getRealResourceHostBackend(absoluteImportPath),
    absoluteImportPath,
  );
  return resolvedFilePath === null ? null : path.normalize(resolvedFilePath);
};

export const resolveRelativeImportPath = (filename: string, source: string): string | null => {
  const currentResourceHost = getCurrentResourceHost();
  if (currentResourceHost) {
    const resolvedFilePath = currentResourceHost.resolveRelativeImport(filename, source);
    return resolvedFilePath === null ? null : path.normalize(resolvedFilePath);
  }
  const absoluteFilename = path.resolve(filename);
  const resolvedFilePath = resolveResourceRelativeImport(
    getRealResourceHostBackend(absoluteFilename),
    absoluteFilename,
    source,
  );
  return resolvedFilePath === null ? null : path.normalize(resolvedFilePath);
};
