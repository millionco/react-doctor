import * as fs from "node:fs";
import * as path from "node:path";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  FETCH_TIMEOUT_MS,
  SOCKET_FREE_PURL_API_BASE,
  SOCKET_FREE_USER_AGENT,
  SOCKET_PACKAGE_PAGE_BASE,
  SOCKET_SCORE_SCALE,
  SUPPLY_CHAIN_CATEGORY,
  SUPPLY_CHAIN_DEFAULT_MIN_SCORE,
  SUPPLY_CHAIN_FETCH_CONCURRENCY,
  SUPPLY_CHAIN_IGNORED_PACKAGES,
  SUPPLY_CHAIN_PLUGIN,
  SUPPLY_CHAIN_RULE,
} from "./constants.js";
import { findMonorepoRoot, isMonorepoRoot, readPackageJson } from "./project-info/index.js";
import { getWorkspacePatterns } from "./project-info/get-workspace-patterns.js";
import { resolveWorkspaceDirectories } from "./project-info/resolve-workspace-directories.js";
import type { Diagnostic, PackageJson, ReactDoctorConfig } from "./types/index.js";

export interface SupplyChainCheckInput {
  readonly rootDirectory: string;
  readonly userConfig: ReactDoctorConfig | null;
}

interface ResolvedSupplyChainOptions {
  readonly minScore: number;
  readonly severity: "error" | "warning";
  readonly includeDevDependencies: boolean;
}

interface DependencyToScore {
  readonly name: string;
  /** Concrete version queried against Socket (resolved from the spec). */
  readonly version: string;
  /** The range/spec exactly as declared in package.json (e.g. `^16.2.4`). */
  readonly spec: string;
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

const SocketArtifactSchema = Schema.Struct({
  score: Schema.optional(SocketScoreSchema),
});

type SocketScore = Schema.Schema.Type<typeof SocketScoreSchema>;

const decodeArtifact = Schema.decodeUnknownOption(SocketArtifactSchema);

interface ScoreAxis {
  readonly key: keyof SocketScore;
  readonly label: string;
  /** Whether a low value on this axis fails the check (see GATED_AXES). */
  readonly gates: boolean;
}

// The non-`overall` axes, paired with the label shown in the diagnostic so a
// developer immediately sees which dimension dragged the score down.
const SCORE_AXES: ReadonlyArray<ScoreAxis> = [
  { key: "supplyChain", label: "supply chain", gates: true },
  { key: "vulnerability", label: "vulnerability", gates: true },
  { key: "maintenance", label: "maintenance", gates: false },
  { key: "quality", label: "quality", gates: false },
  { key: "license", label: "license", gates: false },
];

// Only the security axes decide the gate. Socket's `overall` is its lowest
// axis, so gating on it let a pure quality/maintenance dip fail this
// Security-category check — e.g. `@types/bun@1.3.14` scores quality 48 with
// every security axis at 100 (issue #770). `supplyChain` covers typosquats /
// install scripts / compromised maintainers; `vulnerability` covers known
// CVEs (what flags the compromised `event-stream@3.3.6`). The remaining axes
// still appear in the diagnostic's axis breakdown as context.
const GATED_AXES: ReadonlyArray<ScoreAxis> = SCORE_AXES.filter((axis) => axis.gates);

// The axis that decides the gate for one score: the lowest of the gated
// axes. A tie keeps `supplyChain`, matching the rule's name.
const worstGatedAxis = (score: SocketScore): ScoreAxis => {
  let worst = GATED_AXES[0];
  for (const axis of GATED_AXES) {
    if (score[axis.key] < score[worst.key]) worst = axis;
  }
  return worst;
};

const clampScore = (value: number): number => {
  if (!Number.isFinite(value)) return SUPPLY_CHAIN_DEFAULT_MIN_SCORE;
  return Math.min(Math.max(value, 0), SOCKET_SCORE_SCALE);
};

// Socket scores arrive normalized 0..1; present them on the familiar 0..100
// scale used everywhere else (diagnostics, the `--sfw` table, span attributes).
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
// Socket lookup needs a concrete version. Take the first semver-looking
// token in the spec — the floor of a caret/tilde range, which is a real
// published version. Specs with no concrete version (`*`, `latest`,
// `1.x`) or a non-registry protocol (`workspace:`, `file:`, `link:`,
// `npm:`, `git+…`, a URL) are skipped: there's nothing to score.
const resolveConcreteVersion = (spec: string): string | null => {
  const trimmed = spec.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.includes(":")) return null;
  const match = trimmed.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/);
  return match ? match[0] : null;
};

type DependencySection = "dependencies" | "devDependencies";

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
    const version = resolveConcreteVersion(spec);
    if (version === null) continue;
    const location = locateDependencyKey(packageJsonText, section, name);
    dependencies.push({
      name,
      version,
      spec,
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

// Every package.json directory across a monorepo: the workspace root plus
// each workspace package matched by its globs (pnpm / npm / yarn / nx, via
// the shared project-info resolvers). Anchors at the true monorepo root even
// when invoked from a sub-package, so `--sfw` from anywhere lists the whole
// tree. A non-monorepo project resolves to just its own directory.
const collectWorkspaceDirectories = (startDirectory: string): string[] => {
  const monorepoRoot = isMonorepoRoot(startDirectory)
    ? startDirectory
    : (findMonorepoRoot(startDirectory) ?? startDirectory);
  const rootPackageJson = readPackageJson(path.join(monorepoRoot, "package.json"));

  const directories = [monorepoRoot];
  const visited = new Set<string>([monorepoRoot]);
  for (const pattern of getWorkspacePatterns(monorepoRoot, rootPackageJson)) {
    for (const workspaceDirectory of resolveWorkspaceDirectories(monorepoRoot, pattern)) {
      if (visited.has(workspaceDirectory)) continue;
      visited.add(workspaceDirectory);
      directories.push(workspaceDirectory);
    }
  }
  return directories;
};

// Union of the direct dependencies declared across every package.json in the
// monorepo, de-duplicated by `name@version` (the same dependency pinned to
// the same version in several packages is scored once; differing versions are
// kept and scored separately). Backs the `--sfw` listing.
const collectMonorepoDependencies = (
  startDirectory: string,
  includeDevDependencies: boolean,
): DependencyToScore[] => {
  const dependenciesByKey = new Map<string, DependencyToScore>();
  for (const directory of collectWorkspaceDirectories(startDirectory)) {
    const packageJsonPath = path.join(directory, "package.json");
    const packageJson = readPackageJson(packageJsonPath);
    const packageJsonText = readPackageJsonText(packageJsonPath);
    for (const dependency of collectDependenciesToScore(
      packageJson,
      packageJsonText,
      includeDevDependencies,
    )) {
      const key = `${dependency.name}@${dependency.version}`;
      if (!dependenciesByKey.has(key)) dependenciesByKey.set(key, dependency);
    }
  }
  return [...dependenciesByKey.values()];
};

const toPurl = (dependency: DependencyToScore): string =>
  `pkg:npm/${dependency.name}@${dependency.version}`;

// The endpoint streams newline-delimited JSON (one artifact per line); take
// the first line that decodes to an artifact carrying a score.
const parseScoreFromBody = (body: string): SocketScore | null => {
  for (const line of body.split("\n")) {
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const artifact = Option.getOrNull(decodeArtifact(parsed));
    if (artifact?.score) return artifact.score;
  }
  return null;
};

// Fetches the free, keyless Socket score for one dependency — the same
// `firewall-api.socket.dev/purl/<encoded-purl>` endpoint Socket Firewall's
// free tier hits. `Effect.tryPromise` hands `fetch` an `AbortSignal` that
// `Effect.timeout` trips on the deadline (cancelling the request), and
// `Effect.orElseSucceed` makes the lookup fail-open: an unscored / unknown
// package, a timeout, or any network/parse failure yields `null` (skip)
// rather than sinking the scan. Each lookup is its own `SupplyChain.fetchScore`
// span: the package identity rides the initial attributes, and the resolved
// axis scores (overall + each SCORE_AXES dimension, 0..100) are annotated once
// the lookup settles. Dotted `socket.*` namespacing per the observability
// conventions, so a trace backend can group by package or query score
// distributions across a scan. No-op without a tracer.
const fetchSocketScore = (dependency: DependencyToScore): Effect.Effect<SocketScore | null> =>
  Effect.tryPromise(async (signal) => {
    const requestUrl = `${SOCKET_FREE_PURL_API_BASE}/${encodeURIComponent(toPurl(dependency))}`;
    const response = await fetch(requestUrl, {
      headers: { "User-Agent": SOCKET_FREE_USER_AGENT },
      signal,
    });
    if (!response.ok) return null;
    return parseScoreFromBody(await response.text());
  }).pipe(
    Effect.timeout(FETCH_TIMEOUT_MS),
    Effect.orElseSucceed(() => null),
    Effect.tap((score) => {
      const scoreAttributes: Record<string, string | number | boolean> = {};
      if (score !== null) {
        scoreAttributes["socket.score.overall"] = toHundred(score.overall);
        for (const axis of SCORE_AXES) {
          scoreAttributes[`socket.score.${axis.key}`] = toHundred(score[axis.key]);
        }
      }
      return Effect.annotateCurrentSpan({ "socket.scored": score !== null, ...scoreAttributes });
    }),
    Effect.withSpan("SupplyChain.fetchScore", {
      attributes: {
        "socket.package": dependency.name,
        "socket.version": dependency.version,
        "socket.purl": toPurl(dependency),
      },
    }),
  );

// Per-axis scores on the 0..100 scale, e.g.
// "supply chain 80, vulnerability 25, maintenance 82, quality 86, license 100".
const formatAxisScores = (score: SocketScore): string =>
  SCORE_AXES.map((axis) => `${axis.label} ${toHundred(score[axis.key])}`).join(", ");

const buildLowScoreDiagnostic = (
  dependency: DependencyToScore,
  score: SocketScore,
  failingAxis: ScoreAxis,
  options: ResolvedSupplyChainOptions,
): Diagnostic => {
  const packagePageUrl = `${SOCKET_PACKAGE_PAGE_BASE}/${dependency.name}/overview/${dependency.version}`;
  return {
    filePath: "package.json",
    plugin: SUPPLY_CHAIN_PLUGIN,
    rule: SUPPLY_CHAIN_RULE,
    severity: options.severity,
    // Name the exact axis that failed so the number matches what the user
    // sees on the socket.dev package page (issue #770: calling `overall` a
    // "supply-chain score" read as a false positive when the supplyChain
    // axis itself was 100).
    message: `\`${dependency.name}\` (declared in package.json as "${dependency.spec}", scored at ${dependency.version}) has a Socket ${failingAxis.label} score of ${toHundred(score[failingAxis.key])}/${SOCKET_SCORE_SCALE} (below the minimum of ${options.minScore}). Axis scores — ${formatAxisScores(score)}.`,
    help: `Update or replace the \`"${dependency.name}": "${dependency.spec}"\` entry in package.json. Review ${dependency.name} on Socket: ${packagePageUrl}. Or raise \`supplyChain.minScore\` if you have vetted and accepted this package.`,
    url: packagePageUrl,
    // Anchor to the dependency's declaration so the CLI / editor points at the
    // exact entry to change rather than the top of the file.
    line: dependency.line,
    column: dependency.column,
    category: SUPPLY_CHAIN_CATEGORY,
  };
};

export interface DependencyScore {
  readonly name: string;
  readonly version: string;
  /**
   * Socket `overall` score on a 0–100 scale, or `null` when the
   * package/version is unknown to Socket or the lookup failed.
   */
  readonly overall: number | null;
}

/**
 * Fetches the Socket score of every direct dependency declared across the
 * whole monorepo (the workspace root plus every workspace package.json),
 * de-duplicated by `name@version` — not just the ones below a threshold —
 * via the same free, keyless endpoint as {@link checkSupplyChain}. Backs the
 * CLI's `--sfw` demo listing. Unknown packages and per-package failures come
 * back with `overall: null` rather than being dropped, so the caller can show
 * them explicitly.
 */
export const collectSupplyChainScores = (
  input: SupplyChainCheckInput,
): Effect.Effect<DependencyScore[]> =>
  Effect.gen(function* () {
    const options = resolveOptions(input.userConfig);
    const dependencies = collectMonorepoDependencies(
      input.rootDirectory,
      options.includeDevDependencies,
    );
    if (dependencies.length === 0) return [];

    const scores = yield* Effect.forEach(dependencies, fetchSocketScore, {
      concurrency: SUPPLY_CHAIN_FETCH_CONCURRENCY,
    });

    return dependencies.map((dependency, index) => {
      const score = scores[index];
      return {
        name: dependency.name,
        version: dependency.version,
        overall: score ? toHundred(score.overall) : null,
      };
    });
  });

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
    );
    if (dependencies.length === 0) return [];

    const scores = yield* Effect.forEach(dependencies, fetchSocketScore, {
      concurrency: SUPPLY_CHAIN_FETCH_CONCURRENCY,
    });

    const diagnostics: Diagnostic[] = [];
    for (let index = 0; index < dependencies.length; index += 1) {
      const score = scores[index];
      if (!score) continue;
      const worstAxis = worstGatedAxis(score);
      if (toHundred(score[worstAxis.key]) >= options.minScore) continue;
      diagnostics.push(buildLowScoreDiagnostic(dependencies[index], score, worstAxis, options));
    }
    return diagnostics;
  });
