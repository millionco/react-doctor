import crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as semver from "semver";
import {
  CACHE_FILENAME_HASH_LENGTH_CHARS,
  FETCH_TIMEOUT_MS,
  SOCKET_FREE_PURL_API_BASE,
  SOCKET_FREE_USER_AGENT,
  SOCKET_PACKAGE_PAGE_BASE,
  SOCKET_SCORE_SCALE,
  SUPPLY_CHAIN_ALERT_NOTE_MAX_CHARS,
  SUPPLY_CHAIN_CACHE_SUBDIR,
  SUPPLY_CHAIN_CACHE_TTL_MS,
  SUPPLY_CHAIN_CATEGORY,
  SUPPLY_CHAIN_DEFAULT_MIN_SCORE,
  SUPPLY_CHAIN_FETCH_CONCURRENCY,
  SUPPLY_CHAIN_IGNORED_PACKAGES,
  SUPPLY_CHAIN_MAX_ALERTS_SHOWN,
  SUPPLY_CHAIN_OVERLAP_TIMEOUT_MS,
  SUPPLY_CHAIN_PLUGIN,
  SUPPLY_CHAIN_RULE,
} from "./constants.js";
import { readPackageJson } from "./project-info/index.js";
import type { Diagnostic, PackageJson, ReactDoctorConfig } from "./types/index.js";
import { resolveReactDoctorCacheDir } from "./utils/resolve-react-doctor-cache-dir.js";
import { sanitizeTerminalText } from "./utils/sanitize-terminal-text.js";

export interface SupplyChainCheckInput {
  readonly rootDirectory: string;
  readonly userConfig: ReactDoctorConfig | null;
  /** Whole-check wall-clock cap; a many-socket pileup that ignores the per-fetch abort trips this and the check fails open ([]). Defaults to SUPPLY_CHAIN_OVERLAP_TIMEOUT_MS (the same budget the orchestrator's fork-level `SupplyChainOverlapTimeoutMs` ref defaults to — one source of truth). */
  readonly totalTimeoutMs?: number;
}

interface ResolvedSupplyChainOptions {
  readonly minScore: number;
  readonly severity: "error" | "warning";
  readonly includeDevDependencies: boolean;
}

/** How the scored `version` was derived from the declared `spec`. */
type VersionResolution = "pin" | "locked" | "floor";

interface DependencyToScore {
  readonly name: string;
  /** Concrete version queried against Socket (resolved from the spec). */
  readonly version: string;
  /** The range/spec exactly as declared in package.json (e.g. `^16.2.4`). */
  readonly spec: string;
  readonly section: DependencySection;
  readonly resolution: VersionResolution;
  /** 1-based line of the dependency's key in package.json; `0` if not located. */
  readonly line: number;
  /** 1-based column of the dependency's key in package.json; `0` if not located. */
  readonly column: number;
}

// The Socket score, all axes in the 0..1 range. Each artifact line carries
// many other fields (id, author, license, …) that `Schema.Struct` ignores;
// an unknown package/version comes back as a `synthetic:notFound:*` artifact
// with `score` absent, which the `optional` lets us skip.
const SocketScoreSchema = Schema.Struct({
  overall: Schema.Number,
  license: Schema.Number,
  maintenance: Schema.Number,
  quality: Schema.Number,
  supplyChain: Schema.Number,
  vulnerability: Schema.Number,
});

// A single Socket alert: the concrete "why" behind a low score (e.g. a
// `critical` `malware` alert in a named file with a human `note`). The free
// endpoint only attaches these for the highest-signal supply-chain threats;
// metric-driven dips (CVE-only scores, sparse maintenance) arrive with an
// empty `alerts` array. Optional fields are `NullOr` because the JSON endpoint
// sends an explicit `null` (not an absent key) for values it lacks, and
// `Schema.optional` alone rejects `null` — which would fail the whole decode.
const SocketAlertSchema = Schema.Struct({
  type: Schema.String,
  severity: Schema.String,
  file: Schema.optional(Schema.NullOr(Schema.String)),
  props: Schema.optional(
    Schema.NullOr(Schema.Struct({ note: Schema.optional(Schema.NullOr(Schema.String)) })),
  ),
});

// The score-bearing artifact line. Alerts are decoded SEPARATELY (see
// `extractAlerts`) rather than as a field here so that a single malformed or
// unknown-variant alert can never fail the artifact decode — which would treat
// the package as unscored and silently drop a real low-score finding.
const SocketArtifactSchema = Schema.Struct({
  score: Schema.optional(SocketScoreSchema),
});

// The raw alert list, kept as `Unknown` elements so one unparseable alert
// can't sink the array decode; each element is decoded resiliently below.
const RawAlertsSchema = Schema.Struct({
  alerts: Schema.optional(Schema.NullOr(Schema.Array(Schema.Unknown))),
});

type SocketScore = Schema.Schema.Type<typeof SocketScoreSchema>;
type SocketAlert = Schema.Schema.Type<typeof SocketAlertSchema>;

// A resolved artifact: a `score` is guaranteed (callers skip unscored
// packages) and `alerts` is normalized to a (possibly empty) array.
interface SocketArtifact {
  readonly score: SocketScore;
  readonly alerts: ReadonlyArray<SocketAlert>;
}

const decodeArtifact = Schema.decodeUnknownOption(SocketArtifactSchema);
const decodeRawAlerts = Schema.decodeUnknownOption(RawAlertsSchema);
const decodeAlert = Schema.decodeUnknownOption(SocketAlertSchema);

// Decodes each alert independently, dropping any that don't parse (an unknown
// variant or a malformed entry) rather than discarding the whole artifact —
// and with it the score that gates the check.
const extractAlerts = (parsed: unknown): ReadonlyArray<SocketAlert> => {
  const rawAlerts = Option.getOrNull(decodeRawAlerts(parsed))?.alerts;
  if (!rawAlerts) return [];
  const alerts: SocketAlert[] = [];
  for (const candidate of rawAlerts) {
    const alert = Option.getOrNull(decodeAlert(candidate));
    if (alert !== null) alerts.push(alert);
  }
  return alerts;
};

interface AxisGuidance {
  /**
   * Plain-English meaning of a low score on this axis, woven into the message
   * when Socket returns no explicit alerts to name (the common, metric-driven
   * case on the free endpoint).
   */
  readonly meaning: string;
  /** Axis-specific remediation phrase, woven into the diagnostic's help. */
  readonly remediation: string;
}

// A security axis that gates the check. Its guidance powers the failing-axis
// message's "why" and the help's remediation.
interface GatedAxis {
  readonly key: keyof SocketScore;
  readonly label: string;
  readonly guidance: AxisGuidance;
}

// A non-security axis: reported in the diagnostic's breakdown as context, but
// never gates the check.
interface ScoreAxis {
  readonly key: keyof SocketScore;
  readonly label: string;
}

// Only the security axes decide the gate. Socket's `overall` is its lowest
// axis, so gating on it let a pure quality/maintenance dip fail this
// Security-category check — e.g. `@types/bun@1.3.14` scores quality 48 with
// every security axis at 100 (issue #770). `supplyChain` covers typosquats /
// install scripts / compromised maintainers; `vulnerability` covers known
// CVEs (what flags the compromised `event-stream@3.3.6`). For
// devDependencies the vulnerability axis does NOT gate: a CVE in a dev-only
// tool (a vitest dev-server advisory) never ships to users, while the
// supply-chain axis (malware, typosquats, install scripts) still executes on
// dev machines and CI and keeps gating.
const GATED_AXES: ReadonlyArray<GatedAxis> = [
  {
    key: "supplyChain",
    label: "supply chain",
    guidance: {
      meaning:
        "risky install-time behavior — install scripts, obfuscated or native code, network/filesystem/shell access, or typosquatting",
      remediation:
        "Confirm this is the package you meant to install, and prefer a more established, audited alternative",
    },
  },
  {
    key: "vulnerability",
    label: "vulnerability",
    guidance: {
      meaning: "known security vulnerabilities (CVEs) affecting this version",
      remediation:
        "Upgrade to a version with no known advisories (run `npm audit` to find one), or replace it",
    },
  },
];

// The non-gating axes, reported in the breakdown as context so a developer
// sees which dimension dragged the score down.
const CONTEXT_AXES: ReadonlyArray<ScoreAxis> = [
  { key: "maintenance", label: "maintenance" },
  { key: "quality", label: "quality" },
  { key: "license", label: "license" },
];

// Every axis in display order (gated first), for the per-axis score breakdown
// and the fetch span attributes.
const SCORE_AXES: ReadonlyArray<ScoreAxis> = [...GATED_AXES, ...CONTEXT_AXES];

const gatedAxesForSection = (section: DependencySection): ReadonlyArray<GatedAxis> =>
  section === "devDependencies"
    ? GATED_AXES.filter((axis) => axis.key !== "vulnerability")
    : GATED_AXES;

// The axis that decides the gate for one score: the lowest of the gated
// axes. A tie keeps `supplyChain`, matching the rule's name.
const worstGatedAxis = (score: SocketScore, gatedAxes: ReadonlyArray<GatedAxis>): GatedAxis => {
  let worst = gatedAxes[0];
  for (const axis of gatedAxes) {
    if (score[axis.key] < score[worst.key]) worst = axis;
  }
  return worst;
};

const clampScore = (value: number): number => {
  if (!Number.isFinite(value)) return SUPPLY_CHAIN_DEFAULT_MIN_SCORE;
  return Math.min(Math.max(value, 0), SOCKET_SCORE_SCALE);
};

// Socket scores arrive normalized 0..1; present them on the familiar 0..100
// scale used everywhere else (diagnostics, span attributes).
const toHundred = (normalizedScore: number): number =>
  Math.round(clampScore(normalizedScore * SOCKET_SCORE_SCALE));

const resolveOptions = (config: ReactDoctorConfig | null): ResolvedSupplyChainOptions => {
  const supplyChain = config?.supplyChain ?? {};
  return {
    minScore:
      typeof supplyChain.minScore === "number"
        ? clampScore(supplyChain.minScore)
        : SUPPLY_CHAIN_DEFAULT_MIN_SCORE,
    // Coerce anything that isn't exactly `"warning"` (e.g. a JSON config
    // that wrote `"warn"`) to the stricter `"error"` default.
    severity: supplyChain.severity === "warning" ? "warning" : "error",
    includeDevDependencies: supplyChain.includeDevDependencies !== false,
  };
};

// package.json declares ranges (`^4.17.21`, `~1.2.0`, `>=2 <3`), but the
// Socket lookup needs one concrete version. Score the floor of the range — the
// lowest version it permits, a real published version — via `semver.minVersion`,
// which resolves caret/tilde/OR/upper-bound ranges correctly (the old
// "first semver token" scan mis-scored `<2.0.0 >=1.5.0` and `2.0.0 || 1.0.0`).
// Specs with no parseable floor (`latest`, `*`, a URL) or a non-registry
// protocol (`workspace:`, `file:`, `link:`, `npm:`, `git+…`) are skipped:
// nothing to score.
const resolveConcreteVersion = (spec: string): string | null => {
  const trimmed = spec.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.includes(":")) return null;
  // `semver.minVersion` *throws* on a bare dist-tag (`latest`, `next`) rather
  // than returning null, so validate first. `validRange` collapses a pure
  // wildcard to `"*"`, whose only floor is a synthetic `0.0.0` — skip it too.
  const range = semver.validRange(trimmed);
  if (range === null || range === "*") return null;
  return semver.minVersion(trimmed)?.version ?? null;
};

type DependencySection = "dependencies" | "devDependencies";

/** Looks up the version the project's lockfile resolves `name@spec` to. */
type LockedVersionLookup = (name: string, spec: string) => string | null;

const readTextFileOrNull = (filePath: string): string | null => {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
};

// npm lockfile v2/v3: the hoisted root entry `packages["node_modules/<name>"]`
// is the resolution a direct dependency gets; v1 keeps the same shape under
// `dependencies`.
const buildNpmLockLookup = (lockText: string): LockedVersionLookup | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(lockText);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const lock = parsed as {
    packages?: Record<string, { version?: unknown }>;
    dependencies?: Record<string, { version?: unknown }>;
  };
  return (name) => {
    const entry = lock.packages?.[`node_modules/${name}`] ?? lock.dependencies?.[name];
    return typeof entry?.version === "string" ? entry.version : null;
  };
};

// yarn.lock, classic and berry: an entry header names the descriptors it
// resolves (`"jspdf@npm:^4.0.0":` / `jspdf@^4.0.0, jspdf@^3:`) and the body
// carries `version "4.2.1"` (classic) or `version: 4.2.1` (berry).
const buildYarnLockLookup = (lockText: string): LockedVersionLookup => {
  const lines = lockText.split(/\r?\n/);
  return (name, spec) => {
    const descriptor = `${name}@${spec}`;
    const berryDescriptor = `${name}@npm:${spec}`;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      if (line.startsWith(" ") || line.startsWith("#") || !line.includes(":")) continue;
      const header = line.replace(/:\s*$/, "");
      const descriptors = header.split(",").map((part) => part.trim().replace(/^"|"$/g, ""));
      if (!descriptors.includes(descriptor) && !descriptors.includes(berryDescriptor)) continue;
      for (
        let bodyIndex = lineIndex + 1;
        bodyIndex < lines.length && (lines[bodyIndex].startsWith(" ") || lines[bodyIndex] === "");
        bodyIndex += 1
      ) {
        const versionMatch = /^\s+version:?\s+"?([^"\s]+)"?/.exec(lines[bodyIndex]);
        if (versionMatch) return versionMatch[1];
      }
      return null;
    }
    return null;
  };
};

// pnpm-lock.yaml v6/v9 importer entry: the bare dependency name (4-space
// indent in a single-package lock, 6 with a root importer), then
// `specifier:` / `version:` at deeper indent. The `packages:` section can't
// collide: its keys carry an `@<version>` suffix. The version may carry a
// peer-resolution suffix (`1.2.3(react@19.0.0)`) that is stripped.
const buildPnpmLockLookup = (lockText: string): LockedVersionLookup => {
  return (name) => {
    const entryPattern = new RegExp(
      `^ {4,8}['"]?${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}['"]?:\\s*$`,
    );
    const lines = lockText.split(/\r?\n/);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      if (!entryPattern.test(lines[lineIndex])) continue;
      for (
        let bodyIndex = lineIndex + 1;
        bodyIndex < lines.length && /^ {5,}\S/.test(lines[bodyIndex]);
        bodyIndex += 1
      ) {
        const versionMatch = /^\s+version:\s+['"]?([^'"\s(]+)/.exec(lines[bodyIndex]);
        if (versionMatch) return versionMatch[1];
      }
    }
    return null;
  };
};

// The lockfile is what the project actually installs; scoring the range floor
// when the lockfile resolves higher anchors the finding to a version the
// project doesn't run (the doc's stale-floor false positive). One lookup per
// scan; fail-open to null (floor scoring) when no lockfile parses.
const buildLockedVersionLookup = (rootDirectory: string): LockedVersionLookup | null => {
  const npmLockText = readTextFileOrNull(path.join(rootDirectory, "package-lock.json"));
  if (npmLockText !== null) return buildNpmLockLookup(npmLockText);
  const yarnLockText = readTextFileOrNull(path.join(rootDirectory, "yarn.lock"));
  if (yarnLockText !== null) return buildYarnLockLookup(yarnLockText);
  const pnpmLockText = readTextFileOrNull(path.join(rootDirectory, "pnpm-lock.yaml"));
  if (pnpmLockText !== null) return buildPnpmLockLookup(pnpmLockText);
  return null;
};

// Locates the 1-based line/column of a dependency's key *within its declaring
// section* in the raw package.json text, so the diagnostic anchors to the
// exact entry the user must edit rather than the top of the file — and never
// to a same-named key under `overrides` / `resolutions` / `pnpm.overrides`.
// Scopes by the `"<section>": {` header and tracks brace depth so the match
// stays inside that object; the literal `"name"` + colon means `react` never
// matches `react-dom`.
const locateDependencyKey = (
  packageJsonText: string,
  section: DependencySection,
  name: string,
): { line: number; column: number } | null => {
  const needle = `"${name}"`;
  const sectionHeader = new RegExp(`"${section}"\\s*:\\s*\\{`);
  const lines = packageJsonText.split(/\r?\n/);

  let depth = 0;
  let insideSection = false;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const lineText = lines[lineIndex];
    if (!insideSection) {
      if (sectionHeader.test(lineText)) {
        insideSection = true;
        depth = 1;
      }
      continue;
    }

    const columnIndex = lineText.indexOf(needle);
    if (columnIndex >= 0 && /^\s*:/.test(lineText.slice(columnIndex + needle.length))) {
      return { line: lineIndex + 1, column: columnIndex + 1 };
    }

    for (const character of lineText) {
      if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
    }
    if (depth <= 0) return null;
  }
  return null;
};

const collectDependenciesToScore = (
  packageJson: PackageJson,
  packageJsonText: string,
  includeDevDependencies: boolean,
  lockedVersionLookup: LockedVersionLookup | null,
): DependencyToScore[] => {
  const sectionByName = new Map<string, DependencySection>();
  for (const name of Object.keys(packageJson.dependencies ?? {})) {
    sectionByName.set(name, "dependencies");
  }
  if (includeDevDependencies) {
    for (const name of Object.keys(packageJson.devDependencies ?? {})) {
      if (!sectionByName.has(name)) sectionByName.set(name, "devDependencies");
    }
  }

  const dependencies: DependencyToScore[] = [];
  for (const [name, section] of sectionByName) {
    if (SUPPLY_CHAIN_IGNORED_PACKAGES.has(name)) continue;
    const spec = (packageJson[section] ?? {})[name] ?? "";
    const floorVersion = resolveConcreteVersion(spec);
    if (floorVersion === null) continue;

    // Prefer the lockfile resolution over the range floor, but only when it
    // actually satisfies the declared range — a mismatched lockfile entry
    // (stale lock, aliased descriptor) must not swap in an unrelated version.
    const lockedVersion = lockedVersionLookup?.(name, spec) ?? null;
    const lockSatisfiesSpec =
      lockedVersion !== null &&
      semver.valid(lockedVersion) !== null &&
      semver.satisfies(lockedVersion, spec);

    const isExactPin = semver.valid(spec.trim()) !== null;
    const location = locateDependencyKey(packageJsonText, section, name);
    dependencies.push({
      name,
      version: lockSatisfiesSpec ? lockedVersion : floorVersion,
      spec,
      section,
      resolution: isExactPin ? "pin" : lockSatisfiesSpec ? "locked" : "floor",
      line: location?.line ?? 0,
      column: location?.column ?? 0,
    });
  }
  return dependencies;
};

// Reads the package.json text for line-location; tolerates a missing /
// unreadable file (the parsed object is read separately and resiliently by
// `readPackageJson`, which returns `{}` on the same failures).
const readPackageJsonText = (packageJsonPath: string): string => {
  try {
    return fs.readFileSync(packageJsonPath, "utf-8");
  } catch {
    return "";
  }
};

const toPurl = (dependency: DependencyToScore): string =>
  `pkg:npm/${dependency.name}@${dependency.version}`;

// The endpoint streams newline-delimited JSON (one artifact per line); take
// the first line that decodes to an artifact carrying a score. Alerts are
// decoded separately and resiliently (`extractAlerts`) so a malformed alert
// can never discard the score that gates the check.
const parseArtifactFromBody = (body: string): SocketArtifact | null => {
  for (const line of body.split("\n")) {
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const artifact = Option.getOrNull(decodeArtifact(parsed));
    if (artifact?.score) return { score: artifact.score, alerts: extractAlerts(parsed) };
  }
  return null;
};

// Per-PURL on-disk Socket cache (TTL-bounded), so unchanged dependencies skip
// the network on a repeated scan (the recurring CI win + faster local re-scans).
// Disabled by the global `REACT_DOCTOR_NO_CACHE` off-switch.
const isSupplyChainCacheDisabled = (): boolean => {
  const noCache = process.env["REACT_DOCTOR_NO_CACHE"]?.toLowerCase() ?? "";
  return noCache === "1" || noCache === "true";
};

const supplyChainCacheFile = (cacheDirectory: string, dependency: DependencyToScore): string => {
  const purlHash = crypto
    .createHash("sha256")
    .update(toPurl(dependency))
    .digest("hex")
    .slice(0, CACHE_FILENAME_HASH_LENGTH_CHARS);
  return path.join(cacheDirectory, SUPPLY_CHAIN_CACHE_SUBDIR, `${purlHash}.json`);
};

// Returns the cached raw response body when present and within the TTL, else
// null. Fail-open: a missing / malformed / expired entry reads as a miss. We
// cache the raw body (not the parsed artifact) and re-parse on a hit, so the
// cached and live paths produce byte-identical artifacts through one parser.
const readCachedSocketBody = (cacheFile: string): string | null => {
  try {
    const entry: unknown = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
    if (
      typeof entry === "object" &&
      entry !== null &&
      "fetchedAtMs" in entry &&
      "body" in entry &&
      typeof entry.fetchedAtMs === "number" &&
      typeof entry.body === "string" &&
      Date.now() - entry.fetchedAtMs <= SUPPLY_CHAIN_CACHE_TTL_MS
    ) {
      return entry.body;
    }
  } catch {
    // unreadable / malformed → treat as a miss
  }
  return null;
};

const writeCachedSocketBody = (cacheFile: string, body: string): void => {
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify({ fetchedAtMs: Date.now(), body }));
  } catch {
    // A cache write failure must never sink the scan.
  }
};

// Drops cache files past the TTL. A live dependency's expired entry would
// re-fetch anyway; without this, entries for purls that stop being looked up
// (version bumps, removed dependencies) accumulate forever — a slow monotonic
// leak in CI, where the whole cache directory is persisted and restored across
// runs. File mtime stands in for `fetchedAtMs` (same clock: the file is
// written when the entry is fetched, and both local disks and the CI cache's
// tar round-trip preserve it), so pruning stats instead of parsing every file.
const pruneExpiredSocketCache = (cacheDirectory: string): void => {
  try {
    const supplyChainCacheDirectory = path.join(cacheDirectory, SUPPLY_CHAIN_CACHE_SUBDIR);
    const expiryThresholdMs = Date.now() - SUPPLY_CHAIN_CACHE_TTL_MS;
    for (const entryName of fs.readdirSync(supplyChainCacheDirectory)) {
      const entryPath = path.join(supplyChainCacheDirectory, entryName);
      try {
        if (fs.statSync(entryPath).mtimeMs < expiryThresholdMs) fs.rmSync(entryPath);
      } catch {
        continue;
      }
    }
  } catch {
    // A prune failure must never sink the scan.
  }
};

// Fetches the free, keyless Socket artifact (score + alerts) for one
// dependency — the same `firewall-api.socket.dev/purl/<encoded-purl>` endpoint
// Socket Firewall's free tier hits. `Effect.tryPromise` hands `fetch` an
// `AbortSignal` that `Effect.timeout` trips on the deadline (cancelling the
// request), and `Effect.orElseSucceed` makes the lookup fail-open: an unscored
// / unknown package, a timeout, or any network/parse failure yields `null`
// (skip) rather than sinking the scan. Each lookup is its own
// `SupplyChain.fetchScore` span: the package identity rides the initial
// attributes, and the resolved axis scores (overall + each SCORE_AXES
// dimension, 0..100) plus the alert count are annotated once the lookup
// settles. Dotted `socket.*` namespacing per the observability conventions, so
// a trace backend can group by package or query score / alert distributions
// across a scan. No-op without a tracer.
const fetchSocketArtifact = (
  dependency: DependencyToScore,
  cacheDirectory: string | null,
): Effect.Effect<SocketArtifact | null> =>
  Effect.tryPromise(async (signal) => {
    const cacheFile =
      cacheDirectory === null ? null : supplyChainCacheFile(cacheDirectory, dependency);
    if (cacheFile !== null) {
      const cachedBody = readCachedSocketBody(cacheFile);
      if (cachedBody !== null) {
        const cachedArtifact = parseArtifactFromBody(cachedBody);
        // An unparseable cached body (Socket schema drift / a corrupted restore)
        // is a MISS, not a null result — fall through to the network rather than
        // silently skipping the advisory until the TTL expires.
        if (cachedArtifact !== null) return cachedArtifact;
      }
    }
    const requestUrl = `${SOCKET_FREE_PURL_API_BASE}/${encodeURIComponent(toPurl(dependency))}`;
    const response = await fetch(requestUrl, {
      headers: { "User-Agent": SOCKET_FREE_USER_AGENT },
      signal,
    });
    if (!response.ok) return null;
    const body = await response.text();
    const artifact = parseArtifactFromBody(body);
    // Cache only a genuine hit — a null (unknown/unscored package) re-checks next
    // run rather than pinning a stale negative for the whole TTL.
    if (artifact !== null && cacheFile !== null) writeCachedSocketBody(cacheFile, body);
    return artifact;
  }).pipe(
    Effect.timeout(FETCH_TIMEOUT_MS),
    Effect.orElseSucceed(() => null),
    Effect.tap((artifact) => {
      const scoreAttributes: Record<string, string | number | boolean> = {};
      if (artifact !== null) {
        scoreAttributes["socket.score.overall"] = toHundred(artifact.score.overall);
        for (const axis of SCORE_AXES) {
          scoreAttributes[`socket.score.${axis.key}`] = toHundred(artifact.score[axis.key]);
        }
        scoreAttributes["socket.alert.count"] = artifact.alerts.length;
      }
      return Effect.annotateCurrentSpan({
        "socket.scored": artifact !== null,
        ...scoreAttributes,
      });
    }),
    Effect.withSpan("SupplyChain.fetchScore", {
      attributes: {
        "socket.package": dependency.name,
        "socket.version": dependency.version,
        "socket.purl": toPurl(dependency),
      },
    }),
  );

// The non-failing axes (the failing one already leads the message), e.g.
// "supply chain 100, maintenance 86, quality 100, license 100".
const formatOtherAxisScores = (score: SocketScore, failingKey: keyof SocketScore): string =>
  SCORE_AXES.filter((axis) => axis.key !== failingKey)
    .map((axis) => `${axis.label} ${toHundred(score[axis.key])}`)
    .join(", ");

// Socket alert severities, most to least severe. "middle" is Socket's wire
// spelling for the docs' "medium" band; both map to the same rank.
const ALERT_SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  middle: 2,
  medium: 2,
  low: 1,
};

// `Object.hasOwn`, not bare index access: `severity` / `type` come off the
// wire, so `"constructor"` would read an inherited `Object.prototype` member
// (#920's rule-key crash class).
const severityRank = (severity: string): number => {
  const normalized = severity.toLowerCase();
  return Object.hasOwn(ALERT_SEVERITY_RANK, normalized) ? ALERT_SEVERITY_RANK[normalized] : 0;
};

// Display spelling for a severity: normalize Socket's "middle" to "medium",
// otherwise lowercase the (remote, sanitized) wire value.
const displaySeverity = (severity: string): string => {
  const normalized = sanitizeTerminalText(severity.toLowerCase());
  return normalized === "middle" ? "medium" : normalized;
};

// Labels for the alert types whose friendly name differs from the humanized
// identifier. Everything else (`installScript` -> "install script",
// `networkAccess` -> "network access", …) is left to the camelCase fallback,
// which also keeps a brand-new alert type readable.
const ALERT_TYPE_LABELS: Record<string, string> = {
  malware: "known malware",
  gptMalware: "AI-detected malware",
  gptSecurity: "AI-detected security risk",
  gptAnomaly: "AI-detected code anomaly",
  envVars: "environment-variable access",
  usesEval: "use of eval",
  troll: "protestware",
  didYouMean: "possible typosquat",
  typosquat: "possible typosquat",
};

const humanizeAlertType = (type: string): string =>
  type
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .trim();

const friendlyAlertType = (type: string): string =>
  Object.hasOwn(ALERT_TYPE_LABELS, type)
    ? ALERT_TYPE_LABELS[type]
    : sanitizeTerminalText(humanizeAlertType(type));

// First sentence of a Socket alert note, whitespace-collapsed and capped so a
// paragraph-long malware description doesn't blow out the diagnostic line.
const summarizeAlertNote = (note: string): string => {
  // Collapse whitespace first (so legitimate newlines/tabs become spaces),
  // then strip remaining control chars/backticks from the remote note.
  const collapsed = sanitizeTerminalText(note.replace(/\s+/g, " ").trim());
  const firstSentence = collapsed.split(/(?<=\.)\s/)[0] || collapsed;
  if (firstSentence.length <= SUPPLY_CHAIN_ALERT_NOTE_MAX_CHARS) {
    return firstSentence.replace(/\.$/, "");
  }
  return `${firstSentence.slice(0, SUPPLY_CHAIN_ALERT_NOTE_MAX_CHARS).trimEnd()}…`;
};

// The most severe alerts first (stable within a severity), capped so a noisy
// package doesn't flood the message.
const selectTopAlerts = (alerts: ReadonlyArray<SocketAlert>): ReadonlyArray<SocketAlert> =>
  [...alerts]
    .sort((left, right) => severityRank(right.severity) - severityRank(left.severity))
    .slice(0, SUPPLY_CHAIN_MAX_ALERTS_SHOWN);

// The message's "why" clause when Socket returned concrete alerts: one alert
// gets its file + note spelled out; several collapse to a labelled list with
// the worst severity and a "+N more" tail.
const formatAlertReason = (topAlerts: ReadonlyArray<SocketAlert>, totalCount: number): string => {
  if (topAlerts.length === 1) {
    const [alert] = topAlerts;
    const location = alert.file ? ` in \`${sanitizeTerminalText(alert.file)}\`` : "";
    const note = alert.props?.note ? summarizeAlertNote(alert.props.note) : null;
    const detail = note ? `: "${note}"` : "";
    return `Socket flagged a ${displaySeverity(alert.severity)} ${friendlyAlertType(alert.type)} alert${location}${detail}.`;
  }
  const labels = topAlerts.map((alert) => friendlyAlertType(alert.type)).join(", ");
  const more = totalCount > topAlerts.length ? ` (+${totalCount - topAlerts.length} more)` : "";
  return `Socket flagged ${totalCount} alerts (${labels}${more}); most severe: ${displaySeverity(topAlerts[0].severity)}.`;
};

// "react@18.2.0" for an exact pin; for a range, names the scored version and
// how it was derived — the lockfile's resolution when one exists, otherwise
// the floor the range allows (which may differ from what's installed).
const formatDependencyIdentity = (dependency: DependencyToScore): string => {
  if (dependency.resolution === "pin") return `${dependency.name}@${dependency.version}`;
  if (dependency.resolution === "locked") {
    return `${dependency.name}@${dependency.version} (lockfile resolution of "${dependency.spec}")`;
  }
  return `${dependency.name}@${dependency.version} (lowest version "${dependency.spec}" allows)`;
};

// Axis-aware remediation. A critical alert (active malware) overrides the
// axis's generic advice with "treat as compromised"; otherwise the failing
// axis's own remediation drives the action, and the escape hatch is the
// gentler "raise the threshold / downgrade to a warning".
const buildSupplyChainHelp = (
  dependency: DependencyToScore,
  failingAxis: GatedAxis,
  topAlerts: ReadonlyArray<SocketAlert>,
  packagePageUrl: string,
  options: ResolvedSupplyChainOptions,
): string => {
  const hasCriticalAlert = topAlerts.some((alert) => alert.severity.toLowerCase() === "critical");
  const entry = `\`"${dependency.name}": "${dependency.spec}"\``;

  const action = hasCriticalAlert
    ? `Treat ${dependency.name} as compromised — do not ship it. Remove ${entry} from package.json and your lockfile, then audit anything it ran.`
    : `${failingAxis.guidance.remediation}; update ${entry} in package.json.`;

  const escapeHatch = hasCriticalAlert
    ? `Only if you've confirmed this is a false positive, set \`supplyChain.enabled: false\`.`
    : `If you've reviewed and accepted this package, raise \`supplyChain.minScore\` (currently ${options.minScore}) or set \`supplyChain.severity: "warning"\`.`;

  return `${action} Full report: ${packagePageUrl}. ${escapeHatch}`;
};

const buildLowScoreDiagnostic = (
  dependency: DependencyToScore,
  artifact: SocketArtifact,
  failingAxis: GatedAxis,
  options: ResolvedSupplyChainOptions,
): Diagnostic => {
  const packagePageUrl = `${SOCKET_PACKAGE_PAGE_BASE}/${dependency.name}/overview/${dependency.version}`;
  const failingScore = toHundred(artifact.score[failingAxis.key]);
  const topAlerts = selectTopAlerts(artifact.alerts);

  // The "why": name Socket's concrete alerts when it returned any, otherwise
  // fall back to the plain-English meaning of the failing axis — the free
  // endpoint omits alerts for metric-driven dips (e.g. CVE-only vulnerability
  // scores), so the number alone would leave the user guessing.
  const reason =
    topAlerts.length > 0
      ? formatAlertReason(topAlerts, artifact.alerts.length)
      : `This points to ${failingAxis.guidance.meaning}.`;

  // Lead with the exact axis that failed so the number matches what the user
  // sees on the socket.dev package page (issue #770: calling `overall` a
  // "supply-chain score" read as a false positive when the supplyChain axis
  // itself was 100); the remaining axes follow as context.
  const headline = `\`${formatDependencyIdentity(dependency)}\` scored ${failingScore}/${SOCKET_SCORE_SCALE} on Socket's ${failingAxis.label} axis (minimum ${options.minScore}).`;
  const otherAxes = `Other axes — ${formatOtherAxisScores(artifact.score, failingAxis.key)}.`;

  return {
    filePath: "package.json",
    plugin: SUPPLY_CHAIN_PLUGIN,
    rule: SUPPLY_CHAIN_RULE,
    severity: options.severity,
    message: `${headline} ${reason} ${otherAxes}`,
    help: buildSupplyChainHelp(dependency, failingAxis, topAlerts, packagePageUrl, options),
    url: packagePageUrl,
    // Anchor to the dependency's declaration so the CLI / editor points at the
    // exact entry to change rather than the top of the file.
    line: dependency.line,
    column: dependency.column,
    category: SUPPLY_CHAIN_CATEGORY,
  };
};

/**
 * Scores every direct dependency in the project's `package.json` against
 * Socket.dev's free PURL endpoint (the same one Socket Firewall's free tier
 * uses — no API key) and returns a diagnostic for each dependency whose
 * worst Socket *security* axis — supply chain or vulnerability — is below
 * the configured `minScore`. The quality / maintenance / license axes are
 * reported as context but never gate (see GATED_AXES).
 *
 * Lookups run with bounded concurrency via `Effect.forEach`. The check is
 * total/fail-open: each per-package lookup already recovers to `null`
 * (skip) on timeout or network/parse failure, so a flaky Socket API never
 * sinks the scan. Diagnostics default to `"error"` severity, so a low score
 * fails the run at the standard `blocking` gate.
 */
export const checkSupplyChain = (input: SupplyChainCheckInput): Effect.Effect<Diagnostic[]> =>
  Effect.gen(function* () {
    const options = resolveOptions(input.userConfig);
    const packageJsonPath = path.join(input.rootDirectory, "package.json");
    const packageJson = readPackageJson(packageJsonPath);
    const dependencies = collectDependenciesToScore(
      packageJson,
      readPackageJsonText(packageJsonPath),
      options.includeDevDependencies,
      buildLockedVersionLookup(input.rootDirectory),
    );
    if (dependencies.length === 0) return [];

    // One cache dir for the whole check; `null` disables it (NO_CACHE).
    const cacheDirectory = isSupplyChainCacheDisabled()
      ? null
      : resolveReactDoctorCacheDir(input.rootDirectory);
    if (cacheDirectory !== null) pruneExpiredSocketCache(cacheDirectory);

    const artifacts = yield* Effect.forEach(
      dependencies,
      (dependency) => fetchSocketArtifact(dependency, cacheDirectory),
      { concurrency: SUPPLY_CHAIN_FETCH_CONCURRENCY },
    ).pipe(
      // A many-socket pileup (sockets that ignore the per-fetch abort) trips the
      // whole-check cap; recover to "no artifacts scored" — identical fail-open
      // contract to the per-fetch `orElseSucceed(() => null)`.
      Effect.timeoutOption(input.totalTimeoutMs ?? SUPPLY_CHAIN_OVERLAP_TIMEOUT_MS),
      Effect.map((maybeArtifacts) => Option.getOrElse(maybeArtifacts, () => [])),
    );

    const diagnostics: Diagnostic[] = [];
    for (let index = 0; index < dependencies.length; index += 1) {
      const artifact = artifacts[index];
      if (!artifact) continue;
      const worstAxis = worstGatedAxis(
        artifact.score,
        gatedAxesForSection(dependencies[index].section),
      );
      if (toHundred(artifact.score[worstAxis.key]) >= options.minScore) continue;
      diagnostics.push(buildLowScoreDiagnostic(dependencies[index], artifact, worstAxis, options));
    }
    return diagnostics;
  });
