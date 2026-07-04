import * as path from "node:path";

/**
 * True when `childAbsolutePath` resolves to a location at or below
 * `parentAbsolutePath` — i.e. inside the directory subtree, never the
 * directory itself and never an escaping `..` path. Both arguments must be
 * absolute. Used as a containment guard: zip-slip defense when writing a
 * materialized tree, and to keep node-resolution fallbacks from trusting a
 * package installed outside the enclosing repo.
 */
export const isPathInsideDirectory = (
  childAbsolutePath: string,
  parentAbsolutePath: string,
): boolean => {
  const relativePath = path.relative(parentAbsolutePath, childAbsolutePath);
  return Boolean(relativePath) && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
};
