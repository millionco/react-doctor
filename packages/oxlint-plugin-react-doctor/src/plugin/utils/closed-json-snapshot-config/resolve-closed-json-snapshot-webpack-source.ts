import * as fs from "node:fs";
import * as path from "node:path";
import type { SourceProjectModule } from "../build-source-project-index.js";
import type { ClosedJsonSnapshotSourceResolutionPolicy } from "./interfaces.js";
import { SNAPSHOT_CONFIG_MAX_BYTES } from "./constants.js";

export interface ResolveClosedJsonSnapshotWebpackSourceInput {
  readonly fromFilePath: string;
  readonly source: string;
  readonly modules: ReadonlyMap<string, SourceProjectModule>;
  readonly resolutionPolicy: ClosedJsonSnapshotSourceResolutionPolicy;
}

export const resolveClosedJsonSnapshotWebpackSource = ({
  fromFilePath,
  source,
  modules,
  resolutionPolicy,
}: ResolveClosedJsonSnapshotWebpackSourceInput): string | null => {
  if (/[!?\\]/.test(source) || source.endsWith("/") || path.isAbsolute(source)) return null;
  const alias = resolutionPolicy.aliases.find(
    (candidate) =>
      source === candidate.name || (!candidate.exact && source.startsWith(`${candidate.name}/`)),
  );
  let requested: string;
  if (alias)
    requested = path.resolve(alias.targetAbsolutePath, `.${source.slice(alias.name.length)}`);
  else if (source.startsWith("./") || source.startsWith("../"))
    requested = path.resolve(path.dirname(fromFilePath), source);
  else return null;
  const relative = path.relative(resolutionPolicy.rootDirectory, requested);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    return null;
  try {
    let directory =
      requested === resolutionPolicy.rootDirectory ? requested : path.dirname(requested);
    while (true) {
      const manifestPath = path.join(directory, "package.json");
      if (fs.existsSync(manifestPath)) {
        if (fs.statSync(manifestPath).size > SNAPSHOT_CONFIG_MAX_BYTES) return null;
        const metadata: unknown = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        if (
          !metadata ||
          typeof metadata !== "object" ||
          Array.isArray(metadata) ||
          ["browser", "imports", "concord"].some((name) => name in metadata)
        )
          return null;
      }
      if (directory === resolutionPolicy.rootDirectory) break;
      const parent = path.dirname(directory);
      if (parent === directory) return null;
      directory = parent;
    }
    if (fs.statSync(requested, { throwIfNoEntry: false })?.isFile())
      return modules.has(requested) ? requested : null;
    const candidates = resolutionPolicy.extensions
      .map((extension) => `${requested}${extension}`)
      .filter(
        (filename) =>
          modules.has(filename) ||
          (filename.startsWith(`${resolutionPolicy.rootDirectory}${path.sep}`) &&
            fs.statSync(filename, { throwIfNoEntry: false })?.isFile()),
      );
    if (candidates.length > 0)
      return candidates.length === 1 && modules.has(candidates[0]) ? candidates[0] : null;
    if (fs.existsSync(path.join(requested, "package.json"))) return null;
    const indexCandidates = resolutionPolicy.extensions
      .map((extension) => path.join(requested, `index${extension}`))
      .filter((filename) => fs.statSync(filename, { throwIfNoEntry: false })?.isFile());
    return indexCandidates.length === 1 && modules.has(indexCandidates[0])
      ? indexCandidates[0]
      : null;
  } catch {
    return null;
  }
};
