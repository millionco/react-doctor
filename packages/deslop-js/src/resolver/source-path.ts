import { resolve, relative, dirname, basename } from "node:path";
import { existsSync } from "node:fs";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs"];

const OUTPUT_DIR_PREFIXES = [
  "dist/esm/",
  "dist/cjs/",
  "dist/es/",
  "dist/lib/",
  "dist/",
  "build/",
  "lib/",
  "lib-dist/",
  "esm/",
  "cjs/",
  "out/",
];
const DIST_WILDCARD_PATTERN = /^dist-[^/]+\//;
const SOURCE_INDEX_FALLBACK_STEMS = ["src/index", "src/main"];

const matchesOutputDirectory = (relativePath: string): boolean =>
  OUTPUT_DIR_PREFIXES.some((prefix) => relativePath.startsWith(prefix)) ||
  DIST_WILDCARD_PATTERN.test(relativePath);

export const resolveSourcePath = (distPath: string, directory: string): string | undefined => {
  if (existsSync(distPath)) return distPath;

  const relativeToDist = relative(directory, distPath);
  const sourceReplacements = ["src/"];

  const allPrefixes = [...OUTPUT_DIR_PREFIXES];
  const wildcardMatch = DIST_WILDCARD_PATTERN.exec(relativeToDist);
  if (wildcardMatch) {
    allPrefixes.push(wildcardMatch[0]);
  }

  const sourceVariants = allPrefixes
    .flatMap((prefix) =>
      sourceReplacements.map((replacement) =>
        relativeToDist.replace(
          new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
          replacement,
        ),
      ),
    )
    .filter((variant) => variant !== relativeToDist);

  for (const variant of sourceVariants) {
    const withoutExtension = variant.replace(/\.[^.]+$/, "");
    for (const sourceExtension of SOURCE_EXTENSIONS) {
      const sourceCandidate = resolve(directory, withoutExtension + sourceExtension);
      if (existsSync(sourceCandidate)) {
        return sourceCandidate;
      }
    }
    const indexPrefixedCandidate = resolveWithIndexPrefix(withoutExtension, directory);
    if (indexPrefixedCandidate) return indexPrefixedCandidate;
  }

  if (matchesOutputDirectory(relativeToDist)) {
    for (const stem of SOURCE_INDEX_FALLBACK_STEMS) {
      for (const sourceExtension of SOURCE_EXTENSIONS) {
        const fallbackCandidate = resolve(directory, stem + sourceExtension);
        if (existsSync(fallbackCandidate)) {
          return fallbackCandidate;
        }
      }
    }
  }

  const withoutExtension = relativeToDist.replace(/\.[cm]?js$/, "");
  if (withoutExtension !== relativeToDist) {
    for (const sourceExtension of SOURCE_EXTENSIONS) {
      const directSourceCandidate = resolve(directory, withoutExtension + sourceExtension);
      if (existsSync(directSourceCandidate)) {
        return directSourceCandidate;
      }
    }
    const indexCandidate = resolve(directory, withoutExtension, "index.ts");
    if (existsSync(indexCandidate)) return indexCandidate;

    const indexPrefixedCandidate = resolveWithIndexPrefix(withoutExtension, directory);
    if (indexPrefixedCandidate) return indexPrefixedCandidate;
  }

  return undefined;
};

const resolveWithIndexPrefix = (stemPath: string, directory: string): string | undefined => {
  const parentDirectory = dirname(stemPath);
  const stemBasename = basename(stemPath);
  const indexPrefixedStem = `${parentDirectory}/index.${stemBasename}`;
  for (const sourceExtension of SOURCE_EXTENSIONS) {
    const candidate = resolve(directory, indexPrefixedStem + sourceExtension);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
};
