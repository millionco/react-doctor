import fs from "node:fs";
import path from "node:path";

// HACK: knip flags a source file as unused when no other source file
// imports it — but library entry points (CLI scripts, web/service
// workers, additional bundle entries) are imported by the BUILD
// process, not by other source files. They land in the dist tree
// under a matching path, get referenced from package.json
// `exports`/`main`/`module`/`bin`, and ship to consumers — so
// flagging them as dead code is a false positive.
//
// We detect this by checking, for each unused-source-file diagnostic,
// whether a matching artifact exists under any of the common build
// output directories (`dist`, `build`, `lib`, `out`, `esm`, `cjs`).
// "Matching" means: same path under the build dir as under `src/`,
// with the source extension swapped for a built one (`.js`, `.mjs`,
// `.cjs`).
const BUILD_OUTPUT_DIRECTORIES = ["dist", "build", "lib", "out", "esm", "cjs"];
const BUILD_OUTPUT_EXTENSIONS = ["js", "mjs", "cjs"];
const SOURCE_EXTENSION_PATTERN = /\.(?:[cm]?[jt]sx?)$/;

const stripSourcePrefix = (relativePath: string): string | null => {
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
  const srcMatch = normalized.match(/^src\/(.+)$/);
  return srcMatch ? srcMatch[1] : normalized.includes("/") ? null : normalized;
};

const buildOutputCandidates = (sourceRelativeTrunk: string): string[] => {
  const trunkWithoutExtension = sourceRelativeTrunk.replace(SOURCE_EXTENSION_PATTERN, "");
  if (trunkWithoutExtension === sourceRelativeTrunk) return [];
  return BUILD_OUTPUT_DIRECTORIES.flatMap((outputDir) =>
    BUILD_OUTPUT_EXTENSIONS.map(
      (extension) => `${outputDir}/${trunkWithoutExtension}.${extension}`,
    ),
  );
};

export const isLikelyBuildEntry = (sourceRelativePath: string, rootDirectory: string): boolean => {
  const sourceTrunk = stripSourcePrefix(sourceRelativePath);
  if (!sourceTrunk) return false;
  return buildOutputCandidates(sourceTrunk).some((candidate) =>
    fs.existsSync(path.join(rootDirectory, candidate)),
  );
};
