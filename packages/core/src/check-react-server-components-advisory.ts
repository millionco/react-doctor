import * as path from "node:path";
import {
  REACT_BLOG_RSC_ADVISORY_URL,
  REACT_SERVER_DOM_PACKAGES,
  VERCEL_NEXTJS_SECURITY_RELEASE_URL,
} from "./constants.js";
import { isFile, readPackageJson } from "./project-info/index.js";
import type { Diagnostic, PackageJson, ProjectInfo } from "./types/index.js";
import {
  type ConcreteSemver,
  compareConcreteSemver,
  formatConcreteSemver,
  parseConcreteSemver,
} from "./utils/concrete-semver.js";

const RULE_KEY = "no-vulnerable-react-server-components";

const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

// Per-minor advisory thresholds for React's Server Components runtime
// (`react-server-dom-*`, versioned in lockstep with `react`/`react-dom`).
//
// `rceFixedVersion` is the release that patched the critical unauthenticated
// RCE (CVE-2025-55182, CVSS 10.0). `latestSafeVersion` is the latest patched
// release for the line — it also closes the later high-severity DoS
// (CVE-2026-23870) and the other advisories rolled up alongside it. A version
// below `rceFixedVersion` is the critical case; one at/above it but below
// `latestSafeVersion` still carries the DoS.
interface ReactServerComponentsAdvisory {
  readonly rceFixedVersion: string;
  readonly latestSafeVersion: string;
}

const REACT_RSC_ADVISORIES_BY_MINOR: Record<string, ReactServerComponentsAdvisory> = {
  "19.0": { rceFixedVersion: "19.0.1", latestSafeVersion: "19.0.6" },
  "19.1": { rceFixedVersion: "19.1.2", latestSafeVersion: "19.1.7" },
  "19.2": { rceFixedVersion: "19.2.1", latestSafeVersion: "19.2.6" },
};

// Next.js bundles its own (vendored) React Server Components runtime, so the
// project's `react-server-dom-*` packages do not reflect what Next.js runs —
// the fix ships by upgrading Next.js itself. App Router RSC predates these
// advisories back to the 13.x line; 13.x and 14.x have no patched release and
// must move to a supported major. For 15.x/16.x the RCE was patched per minor.
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

const readDeclaredSpec = (packageJson: PackageJson, packageName: string): string | null => {
  for (const section of DEPENDENCY_SECTIONS) {
    const spec = packageJson[section]?.[packageName];
    if (typeof spec === "string") return spec;
  }
  return null;
};

// Resolves the concrete version a package will actually run, preferring the
// installed manifest under `node_modules` (authoritative, always concrete)
// and falling back to an exact pin declared in the root manifest. Range specs
// (`^19.2.0`) resolve to `null` rather than guessing, so the check never
// false-positives off an ambiguous range whose lockfile may resolve higher.
const resolveInstalledVersion = (
  candidateDirectories: ReadonlyArray<string>,
  rootPackageJson: PackageJson,
  packageName: string,
  declaredSpec: string | null,
): ConcreteSemver | null => {
  for (const directory of candidateDirectories) {
    const installedManifestPath = path.join(directory, "node_modules", packageName, "package.json");
    if (!isFile(installedManifestPath)) continue;
    const installedVersion = parseConcreteSemver(readPackageJson(installedManifestPath).version);
    if (installedVersion !== null) return installedVersion;
  }
  return parseConcreteSemver(declaredSpec ?? readDeclaredSpec(rootPackageJson, packageName));
};

const checkReactServerDomPackages = (
  candidateDirectories: ReadonlyArray<string>,
  rootPackageJson: PackageJson,
): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];

  for (const packageName of REACT_SERVER_DOM_PACKAGES) {
    const version = resolveInstalledVersion(
      candidateDirectories,
      rootPackageJson,
      packageName,
      null,
    );
    if (version === null) continue;

    const advisory = REACT_RSC_ADVISORIES_BY_MINOR[`${version.major}.${version.minor}`];
    if (advisory === undefined) continue;

    const rceFixed = parseConcreteSemver(advisory.rceFixedVersion);
    const latestSafe = parseConcreteSemver(advisory.latestSafeVersion);
    if (rceFixed === null || latestSafe === null) continue;

    const installedDisplay = `${packageName}@${formatConcreteSemver(version)}`;

    if (compareConcreteSemver(version, rceFixed) < 0) {
      diagnostics.push(
        buildAdvisoryDiagnostic({
          severity: "error",
          message: `${installedDisplay} has the critical React Server Components remote code execution vulnerability (CVE-2025-55182, CVSS 10.0) — an unauthenticated attacker can run arbitrary code on your server by sending a crafted payload to any Server Function endpoint`,
          help: `Upgrade React's Server Components runtime to ${advisory.latestSafeVersion} — a patch-level bump within ${version.major}.${version.minor} with no breaking changes. Run \`npm install ${packageName}@${advisory.latestSafeVersion}\` and pin \`react\`/\`react-dom\` to ${advisory.latestSafeVersion} too. See ${REACT_BLOG_RSC_ADVISORY_URL}`,
        }),
      );
      continue;
    }

    if (compareConcreteSemver(version, latestSafe) < 0) {
      diagnostics.push(
        buildAdvisoryDiagnostic({
          severity: "warning",
          message: `${installedDisplay} is affected by a high-severity React Server Components denial-of-service vulnerability (CVE-2026-23870) patched in ${advisory.latestSafeVersion}`,
          help: `Upgrade to ${advisory.latestSafeVersion} — a patch-level bump within ${version.major}.${version.minor}. Run \`npm install ${packageName}@${advisory.latestSafeVersion}\` and align \`react\`/\`react-dom\`. See ${VERCEL_NEXTJS_SECURITY_RELEASE_URL}`,
        }),
      );
    }
  }

  return diagnostics;
};

const checkNextjsAdvisory = (version: ConcreteSemver): Diagnostic[] => {
  if (version.major < NEXTJS_OLDEST_AFFECTED_MAJOR) return [];

  const installedDisplay = `next@${formatConcreteSemver(version)}`;

  const latestSafeSpec = NEXTJS_LATEST_SAFE_BY_MAJOR[version.major];
  if (latestSafeSpec === undefined) {
    // 13.x / 14.x have no patched release on their own line — the fix is a
    // major upgrade. (Majors newer than the advisory table, e.g. a future
    // 17.x, are treated as safe.)
    if (version.major >= 15) return [];
    return [
      buildAdvisoryDiagnostic({
        severity: "warning",
        message: `${installedDisplay} is on an unsupported Next.js release line affected by the React Server Components security advisories — there is no patched ${version.major}.x release`,
        help: `Upgrade to a patched Next.js release (${NEXTJS_SUPPORTED_UPGRADE_TARGETS}). Next.js bundles its own React Server Components runtime, so upgrading Next.js is what ships the fix. See ${VERCEL_NEXTJS_SECURITY_RELEASE_URL}`,
      }),
    ];
  }

  const latestSafe = parseConcreteSemver(latestSafeSpec);
  if (latestSafe === null) return [];

  const rceFixed = parseConcreteSemver(
    NEXTJS_RCE_FIXED_BY_MINOR[`${version.major}.${version.minor}`],
  );
  if (rceFixed !== null && compareConcreteSemver(version, rceFixed) < 0) {
    return [
      buildAdvisoryDiagnostic({
        severity: "error",
        message: `${installedDisplay} bundles the React Server Components runtime affected by the critical remote code execution vulnerability (CVE-2025-55182, CVSS 10.0) — an unauthenticated attacker can run arbitrary code on your server by sending a crafted payload to any Server Function or Server Action endpoint`,
        help: `Upgrade Next.js to ${latestSafeSpec} (or newer). Next.js bundles its own React Server Components runtime, so bumping Next.js — not \`react\` — ships the fix. Run \`npm install next@${latestSafeSpec}\`. See ${VERCEL_NEXTJS_SECURITY_RELEASE_URL}`,
      }),
    ];
  }

  if (compareConcreteSemver(version, latestSafe) < 0) {
    return [
      buildAdvisoryDiagnostic({
        severity: "warning",
        message: `${installedDisplay} bundles a React Server Components runtime affected by a high-severity denial-of-service vulnerability (CVE-2026-23870) patched in Next.js ${latestSafeSpec}`,
        help: `Upgrade Next.js to ${latestSafeSpec} (or newer). Next.js bundles its own React Server Components runtime, so bumping Next.js ships the fix. Run \`npm install next@${latestSafeSpec}\`. See ${VERCEL_NEXTJS_SECURITY_RELEASE_URL}`,
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
 * Next.js vendors its own RSC runtime, so a Next.js project is checked by its
 * `next` version (the fix is a Next.js bump); every other framework or bundler
 * — Vite, Parcel, React Router, Waku, RedwoodSDK — is checked by the resolved
 * version of its `react-server-dom-*` package. Pure client-side React apps
 * (no RSC packages, no Next.js) are not affected and stay quiet.
 */
export const checkReactServerComponentsAdvisory = (
  scanDirectory: string,
  project: ProjectInfo,
): Diagnostic[] => {
  const candidateDirectories =
    scanDirectory === project.rootDirectory
      ? [scanDirectory]
      : [scanDirectory, project.rootDirectory];

  const rootPackageJson = readPackageJson(path.join(scanDirectory, "package.json"));

  const isNextjsProject = project.framework === "nextjs" || project.nextjsVersion !== null;
  if (isNextjsProject) {
    const nextVersion = resolveInstalledVersion(
      candidateDirectories,
      rootPackageJson,
      "next",
      project.nextjsVersion,
    );
    return nextVersion === null ? [] : checkNextjsAdvisory(nextVersion);
  }

  return checkReactServerDomPackages(candidateDirectories, rootPackageJson);
};
