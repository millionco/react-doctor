import { getClosedJsonSnapshotYarnSelectors } from "./get-closed-json-snapshot-yarn-selectors.js";
import { SNAPSHOT_ROLE_MAX_LOCK_LINES } from "./closed-json-snapshot-role/constants.js";

export interface ClosedJsonSnapshotYarnResolution {
  readonly version: string;
  readonly resolved: string;
  readonly integrity: string | null;
  readonly selectors: readonly string[];
  readonly dependencies: ReadonlyMap<string, string>;
}

export interface ClosedJsonSnapshotYarnResolutionInput {
  readonly lockText: string;
  readonly packageName: string;
  readonly declaration: string;
  readonly allowGroupedSelectors?: boolean;
  readonly satisfiesDeclaration?: (version: string, declaration: string) => boolean;
}

export const readClosedJsonSnapshotYarnResolution = ({
  lockText,
  packageName,
  declaration,
  allowGroupedSelectors = false,
  satisfiesDeclaration,
}: ClosedJsonSnapshotYarnResolutionInput): ClosedJsonSnapshotYarnResolution | null => {
  if (!/^# yarn lockfile v1\r?$/m.test(lockText)) return null;
  const lines = lockText.split(/\r?\n/);
  if (lines.length > SNAPSHOT_ROLE_MAX_LOCK_LINES) return null;
  const selector = `${packageName}@${declaration}`;
  let result: ClosedJsonSnapshotYarnResolution | null = null;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!line || /^[ #]/.test(line)) continue;
    if (!line.endsWith(":")) return null;
    const selectors = getClosedJsonSnapshotYarnSelectors(line.slice(0, -1));
    if (!selectors) return null;
    if (!selectors.includes(selector)) continue;
    if (
      result ||
      selectors.filter((value) => value === selector).length !== 1 ||
      (!allowGroupedSelectors && selectors.length !== 1)
    )
      return null;
    let version: string | null = null;
    let resolved: string | null = null;
    let integrity: string | null = null;
    let readingDependencies = false;
    let didSeeDependencies = false;
    const dependencies = new Map<string, string>();
    for (
      let bodyIndex = lineIndex + 1;
      bodyIndex < lines.length && (!lines[bodyIndex] || lines[bodyIndex].startsWith(" "));
      bodyIndex += 1
    ) {
      const bodyLine = lines[bodyIndex];
      if (!bodyLine) continue;
      const versionMatch = /^  version "([^"\\]+)"$/.exec(bodyLine);
      const resolvedMatch = /^  resolved "([^"\\]+)"$/.exec(bodyLine);
      const integrityMatch = /^  integrity ([^\s]+)$/.exec(bodyLine);
      if (versionMatch) {
        if (version !== null) return null;
        version = versionMatch[1];
        readingDependencies = false;
        continue;
      }
      if (resolvedMatch) {
        if (resolved !== null) return null;
        resolved = resolvedMatch[1];
        readingDependencies = false;
        continue;
      }
      if (integrityMatch) {
        if (integrity !== null) return null;
        integrity = integrityMatch[1];
        readingDependencies = false;
        continue;
      }
      if (!allowGroupedSelectors) {
        if (/^  \S/.test(bodyLine) && !/^  (?:optionalDependencies|dependencies):$/.test(bodyLine))
          return null;
        continue;
      }
      if (bodyLine === "  dependencies:") {
        if (didSeeDependencies) return null;
        didSeeDependencies = true;
        readingDependencies = true;
        continue;
      }
      if (bodyLine === "  optionalDependencies:") return null;
      if (readingDependencies) {
        const match = /^    (?:"([^"\\]+)"|([^\s":]+)) "([^"\\]+)"$/.exec(bodyLine);
        const name = match?.[1] ?? match?.[2];
        if (!match || !name || dependencies.has(name)) return null;
        dependencies.set(name, match[3]);
      } else if (allowGroupedSelectors || /^  \S/.test(bodyLine)) return null;
    }
    if (!version || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version) || !resolved)
      return null;
    if (
      allowGroupedSelectors &&
      (!satisfiesDeclaration ||
        selectors.some(
          (value) =>
            !value.startsWith(`${packageName}@`) ||
            !satisfiesDeclaration(version, value.slice(packageName.length + 1)),
        ))
    )
      return null;
    try {
      const url = new URL(resolved);
      if (
        url.protocol !== "https:" ||
        !["registry.yarnpkg.com", "registry.npmjs.org"].includes(url.hostname) ||
        url.pathname !== `/${packageName}/-/${packageName}-${version}.tgz` ||
        url.search ||
        !/^#[a-f\d]{40}$/i.test(url.hash) ||
        url.username ||
        url.password ||
        url.port
      )
        return null;
    } catch {
      return null;
    }
    result = { version, resolved, integrity, selectors, dependencies };
  }
  return result;
};
