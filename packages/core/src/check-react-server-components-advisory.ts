import * as path from "node:path";
import * as semver from "semver";
import {
  REACT_BLOG_RSC_ADVISORY_URL,
  REACT_SERVER_DOM_PACKAGES,
  VERCEL_NEXTJS_SECURITY_RELEASE_URL,
} from "./constants.js";
import { findMonorepoRoot, isFile, readPackageJson } from "./project-info/index.js";
import { getWorkspacePatterns } from "./project-info/get-workspace-patterns.js";
import { resolveWorkspaceDirectories } from "./project-info/resolve-workspace-directories.js";
import type { Diagnostic, PackageJson, ProjectInfo } from "./types/index.js";

const RULE_KEY = "no-vulnerable-react-server-components";

const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

// Per-minor advisory thresholds for React's Server Components runtime
// (`react-server-dom-*`, versioned in lockstep with `react`/`react-dom`).
// `rceFixedVersion` patched the critical unauthenticated RCE (CVE-2025-55182);
// `latestSafeVersion` is the latest patched release for the line, which also
// closes the later high-severity DoS (CVE-2026-23870).
interface ReactServerComponentsAdvisory {
  readonly rceFixedVersion: string;
  readonly latestSafeVersion: string;
}

const REACT_RSC_ADVISORIES_BY_MINOR: Record<string, ReactServerComponentsAdvisory> = {
  "19.0": { rceFixedVersion: "19.0.1", latestSafeVersion: "19.0.6" },
  "19.1": { rceFixedVersion: "19.1.2", latestSafeVersion: "19.1.7" },
  "19.2": { rceFixedVersion: "19.2.1", latestSafeVersion: "19.2.6" },
};

// Next.js bundles its own (vendored) RSC runtime, so the fix ships by upgrading
// Next.js itself. App Router RSC predates these advisories back to 13.x; 13.x
// and 14.x have no patched release and must move to a supported major, while
// 15.x/16.x patched the RCE per minor.
const NEXTJS_OLDEST_AFFECTED_MAJOR = 13;
const NEXTJS_RCE_FIXED_BY_MINOR: Record<string, string> = {
  "15.0": "15.0.5",
  "15.1": "15.1.9",
  "15.2": "15.2.6",
  "15.3": "15.3.6",
  "15.4": "15.4.8",
  "15.5": "15.5.7",
  "16.0": "16.0.7",
};
const NEXTJS_LATEST_SAFE_BY_MAJOR: Record<number, string> = {
  15: "15.5.18",
  16: "16.2.6",
};
const NEXTJS_SUPPORTED_UPGRADE_TARGETS = "15.5.18 or 16.2.6";

interface BuildAdvisoryDiagnosticInput {
  readonly severity: Diagnostic["severity"];
  readonly message: string;
  readonly help: string;
}

const buildAdvisoryDiagnostic = (input: BuildAdvisoryDiagnosticInput): Diagnostic => ({
  filePath: "package.json",
  plugin: "react-doctor",
  rule: RULE_KEY,
  severity: input.severity,
  message: input.message,
  help: input.help,
  line: 0,
  column: 0,
  category: "Security",
});

// Every workspace package directory under `workspaceRoot`, unfiltered — unlike
// `listWorkspacePackages`, which keeps only React-bearing packages. A workspace
// that declares only a `react-server-dom-*` package (or `next` solely under
// `optionalDependencies`) must still have its `node_modules` probed.
const enumerateWorkspaceDirectories = (workspaceRoot: string): string[] => {
  const patterns = getWorkspacePatterns(
    workspaceRoot,
    readPackageJson(path.join(workspaceRoot, "package.json")),
  );
  const directories = new Set<string>();
  for (const pattern of patterns) {
    for (const directory of resolveWorkspaceDirectories(workspaceRoot, pattern)) {
      directories.add(directory);
    }
  }
  return [...directories];
};

const readDeclaredSpec = (packageJson: PackageJson, packageName: string): string | null => {
  for (const section of DEPENDENCY_SECTIONS) {
    const spec = packageJson[section]?.[packageName];
    if (typeof spec === "string") return spec;
  }
  return null;
};

// Resolves the concrete version a package runs *in a single directory*,
// preferring the installed manifest under that directory's `node_modules`
// (authoritative, always concrete) and falling back to an exact pin declared in
// that directory's own `package.json`. `semver.valid` rejects range specs
// (`^19.2.0`), so the check never guesses off an ambiguous range whose lockfile
// may resolve higher. The caller probes every candidate directory (scan root +
// each workspace package) so heterogeneous monorepo installs are all seen.
const resolveVersionInDirectory = (
  directory: string,
  packageName: string,
  declaredSpecOverride: string | null,
): string | null => {
  const manifestPath = path.join(directory, "node_modules", packageName, "package.json");
  if (isFile(manifestPath)) {
    const installedVersion = semver.valid(readPackageJson(manifestPath).version ?? null);
    if (installedVersion !== null) return installedVersion;
  }

  // Fall through to the first spec that is actually a concrete version. The
  // directory's own declaration is tried first, then the seed (discovery's
  // catalog-resolved `project.nextjsVersion`) — so an unparseable manifest spec
  // like `catalog:` doesn't shadow an already-resolved concrete pin.
  const candidateSpecs = [
    readDeclaredSpec(readPackageJson(path.join(directory, "package.json")), packageName),
    declaredSpecOverride,
  ];
  for (const spec of candidateSpecs) {
    const pinnedVersion = spec === null ? null : semver.valid(spec);
    if (pinnedVersion !== null) return pinnedVersion;
  }
  return null;
};

const checkReactServerDomAdvisory = (packageName: string, version: string): Diagnostic[] => {
  const advisory =
    REACT_RSC_ADVISORIES_BY_MINOR[`${semver.major(version)}.${semver.minor(version)}`];
  if (advisory === undefined) return [];

  const installedDisplay = `${packageName}@${version}`;
  const lineDisplay = `${semver.major(version)}.${semver.minor(version)}`;

  if (semver.lt(version, advisory.rceFixedVersion)) {
    return [
      buildAdvisoryDiagnostic({
        severity: "error",
        message: `${installedDisplay} has the critical React Server Components remote code execution vulnerability (CVE-2025-55182, CVSS 10.0) — an unauthenticated attacker can run arbitrary code on your server by sending a crafted payload to any Server Function endpoint`,
        help: `Upgrade React's Server Components runtime to ${advisory.latestSafeVersion} — a patch-level bump within ${lineDisplay} with no breaking changes. Run \`npm install ${packageName}@${advisory.latestSafeVersion}\` and pin \`react\`/\`react-dom\` to ${advisory.latestSafeVersion} too. See ${REACT_BLOG_RSC_ADVISORY_URL}`,
      }),
    ];
  }

  if (semver.lt(version, advisory.latestSafeVersion)) {
    return [
      buildAdvisoryDiagnostic({
        severity: "warning",
        message: `${installedDisplay} is affected by a high-severity React Server Components denial-of-service vulnerability (CVE-2026-23870) patched in ${advisory.latestSafeVersion}`,
        help: `Upgrade to ${advisory.latestSafeVersion} — a patch-level bump within ${lineDisplay}. Run \`npm install ${packageName}@${advisory.latestSafeVersion}\` and align \`react\`/\`react-dom\`. See ${VERCEL_NEXTJS_SECURITY_RELEASE_URL}`,
      }),
    ];
  }

  return [];
};

const checkNextjsAdvisory = (version: string): Diagnostic[] => {
  const major = semver.major(version);
  if (major < NEXTJS_OLDEST_AFFECTED_MAJOR) return [];

  const installedDisplay = `next@${version}`;

  const latestSafeVersion = NEXTJS_LATEST_SAFE_BY_MAJOR[major];
  if (latestSafeVersion === undefined) {
    // 13.x / 14.x have no patched release on their own line — the fix is a
    // major upgrade. Majors newer than the advisory table (a future 17.x) are
    // treated as safe.
    if (major >= 15) return [];
    return [
      buildAdvisoryDiagnostic({
        severity: "warning",
        message: `${installedDisplay} is on an unsupported Next.js release line affected by the React Server Components security advisories — there is no patched ${major}.x release`,
        help: `Upgrade to a patched Next.js release (${NEXTJS_SUPPORTED_UPGRADE_TARGETS}). Next.js bundles its own React Server Components runtime, so upgrading Next.js is what ships the fix. See ${VERCEL_NEXTJS_SECURITY_RELEASE_URL}`,
      }),
    ];
  }

  const rceFixedVersion = NEXTJS_RCE_FIXED_BY_MINOR[`${major}.${semver.minor(version)}`];
  if (rceFixedVersion !== undefined && semver.lt(version, rceFixedVersion)) {
    return [
      buildAdvisoryDiagnostic({
        severity: "error",
        message: `${installedDisplay} bundles the React Server Components runtime affected by the critical remote code execution vulnerability (CVE-2025-55182, CVSS 10.0) — an unauthenticated attacker can run arbitrary code on your server by sending a crafted payload to any Server Function or Server Action endpoint`,
        help: `Upgrade Next.js to ${latestSafeVersion} (or newer). Next.js bundles its own React Server Components runtime, so bumping Next.js — not \`react\` — ships the fix. Run \`npm install next@${latestSafeVersion}\`. See ${VERCEL_NEXTJS_SECURITY_RELEASE_URL}`,
      }),
    ];
  }

  if (semver.lt(version, latestSafeVersion)) {
    return [
      buildAdvisoryDiagnostic({
        severity: "warning",
        message: `${installedDisplay} bundles a React Server Components runtime affected by a high-severity denial-of-service vulnerability (CVE-2026-23870) patched in Next.js ${latestSafeVersion}`,
        help: `Upgrade Next.js to ${latestSafeVersion} (or newer). Next.js bundles its own React Server Components runtime, so bumping Next.js ships the fix. Run \`npm install next@${latestSafeVersion}\`. See ${VERCEL_NEXTJS_SECURITY_RELEASE_URL}`,
      }),
    ];
  }

  return [];
};

/**
 * Flags a project running React Server Components on a version with a known
 * security advisory — primarily the critical unauthenticated RCE
 * (CVE-2025-55182), plus the later high-severity DoS (CVE-2026-23870).
 *
 * Every candidate directory — the scan root and each workspace package — is
 * probed independently, so heterogeneous monorepo installs are all seen (a
 * vulnerable `next` in one workspace isn't masked by an inert one elsewhere).
 * Next.js vendors its own RSC runtime, so an affected `next` install in a
 * directory is reported by its `next` version (the fix is a Next.js bump) and
 * suppresses the standalone `react-server-dom-*` check for that directory only;
 * every other framework or bundler — Vite, Parcel, React Router, Waku,
 * RedwoodSDK — is reported by its `react-server-dom-*` version. Dispatch keys
 * on resolved installs rather than the root framework classification, so a
 * monorepo whose root is Vite but whose workspace runs Next.js is still
 * covered. Pure client-side React apps (no RSC packages, no Next.js) are not
 * affected and stay quiet.
 */
export const checkReactServerComponentsAdvisory = (
  scanDirectory: string,
  project: ProjectInfo,
): Diagnostic[] => {
  // `project.rootDirectory` is the scanned directory, not necessarily the
  // monorepo root, so walk up to the real root: it enumerates every sibling
  // workspace and is itself where a hoisted `next` / `react-server-dom-*`
  // install lands when scanning a nested package.
  const workspaceRoot = findMonorepoRoot(scanDirectory) ?? project.rootDirectory;
  const candidateDirectories = [
    ...new Set([
      scanDirectory,
      project.rootDirectory,
      workspaceRoot,
      ...enumerateWorkspaceDirectories(workspaceRoot),
    ]),
  ];

  const diagnostics: Diagnostic[] = [];
  const seenMessages = new Set<string>();
  const pushUnique = (candidates: ReadonlyArray<Diagnostic>): void => {
    for (const candidate of candidates) {
      if (seenMessages.has(candidate.message)) continue;
      seenMessages.add(candidate.message);
      diagnostics.push(candidate);
    }
  };

  for (const directory of candidateDirectories) {
    // `project.nextjsVersion` is the workspace-resolved declared spec; let it
    // seed the scan root so an exact pin without an install still counts.
    const nextVersion = resolveVersionInDirectory(
      directory,
      "next",
      directory === scanDirectory ? project.nextjsVersion : null,
    );
    if (nextVersion !== null) pushUnique(checkNextjsAdvisory(nextVersion));

    // A Next.js install in this directory vendors its own RSC runtime and is
    // covered by the Next.js advisory, so don't also flag a standalone
    // `react-server-dom-*` here — but only when that Next is in the affected
    // range; a pre-13 Next must not mask a vulnerable standalone runtime.
    const nextGovernsRsc =
      nextVersion !== null && semver.major(nextVersion) >= NEXTJS_OLDEST_AFFECTED_MAJOR;
    if (nextGovernsRsc) continue;

    for (const packageName of REACT_SERVER_DOM_PACKAGES) {
      const version = resolveVersionInDirectory(directory, packageName, null);
      if (version !== null) pushUnique(checkReactServerDomAdvisory(packageName, version));
    }
  }

  return diagnostics;
};
