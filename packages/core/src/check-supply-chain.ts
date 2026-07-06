import crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as semver from "semver";
import {
  CACHE_FILENAME_HASH_LENGTH_CHARS,
  FETCH_TIMEOUT_MS,
  OSV_API_BASE,
  OSV_VULN_PAGE_BASE,
  SUPPLY_CHAIN_CACHE_SUBDIR,
  SUPPLY_CHAIN_CACHE_TTL_MS,
  SUPPLY_CHAIN_CATEGORY,
  SUPPLY_CHAIN_DEFAULT_FAIL_ON,
  SUPPLY_CHAIN_FETCH_CONCURRENCY,
  SUPPLY_CHAIN_FETCH_MAX_RETRIES,
  SUPPLY_CHAIN_FETCH_RETRY_BASE_MS,
  SUPPLY_CHAIN_IGNORED_PACKAGES,
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
  readonly totalTimeoutMs?: number;
}

interface ResolvedSupplyChainOptions {
  readonly severity: "error" | "warning";
  readonly includeDevDependencies: boolean;
  readonly failOn: OsvSeverity;
}

interface DependencyToScore {
  readonly name: string;
  readonly version: string;
  readonly spec: string;
  readonly line: number;
  readonly column: number;
}

interface OsvSeverityEntry {
  readonly type?: string;
  readonly score?: string;
}

interface OsvDatabaseSpecific {
  readonly severity?: string;
}

interface OsvVulnerabilityRecord {
  readonly id?: string;
  readonly summary?: string;
  readonly details?: string;
  readonly severity?: ReadonlyArray<OsvSeverityEntry>;
  readonly database_specific?: OsvDatabaseSpecific | null;
}

interface CachedOsvVulnerability {
  readonly id: string;
  readonly severity: OsvSeverity;
  readonly summary: string;
  readonly pageUrl: string;
}

type OsvSeverity = "low" | "moderate" | "high" | "critical";

const OSV_SEVERITY_ORDER: Record<OsvSeverity, number> = {
  low: 0,
  moderate: 1,
  high: 2,
  critical: 3,
};

const OSV_CVSS_AV_VALUES: Record<string, number> = {
  N: 0.85,
  A: 0.62,
  L: 0.55,
  P: 0.2,
};

const OSV_CVSS_AC_VALUES: Record<string, number> = {
  L: 0.77,
  H: 0.44,
};

const OSV_CVSS_PR_VALUES: Record<"U" | "C", Record<string, number>> = {
  U: {
    N: 0.85,
    L: 0.62,
    H: 0.27,
  },
  C: {
    N: 0.85,
    L: 0.68,
    H: 0.5,
  },
};

const OSV_CVSS_UI_VALUES: Record<string, number> = {
  N: 0.85,
  R: 0.62,
};

const OSV_CVSS_IMPACT_VALUES: Record<string, number> = {
  N: 0,
  L: 0.22,
  H: 0.56,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const sanitizeSummaryText = (value: string): string =>
  sanitizeTerminalText(collapseWhitespace(value));

const normalizeSeverity = (value: string | undefined): OsvSeverity | null => {
  if (value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "low") return "low";
  if (normalized === "moderate" || normalized === "medium") return "moderate";
  if (normalized === "high") return "high";
  if (normalized === "critical") return "critical";
  return null;
};

const severityRank = (severity: OsvSeverity): number => OSV_SEVERITY_ORDER[severity];

const isMalwareAdvisory = (vulnerability: OsvVulnerabilityRecord): boolean => {
  const summaryText = `${vulnerability.summary ?? ""} ${vulnerability.details ?? ""}`.toLowerCase();
  return (
    (typeof vulnerability.id === "string" && vulnerability.id.toUpperCase().startsWith("MAL-")) ||
    summaryText.includes("malicious package")
  );
};

const roundUpToOneDecimal = (value: number): number => Math.ceil(value * 10) / 10;

const parseCvssV3BaseScore = (vectorOrScore: string): number | null => {
  const trimmed = vectorOrScore.trim();
  if (trimmed.length === 0) return null;

  const numericScore = Number(trimmed);
  if (Number.isFinite(numericScore)) return numericScore;
  if (!trimmed.startsWith("CVSS:3.")) return null;

  const metrics = new Map<string, string>();
  for (const segment of trimmed.split("/").slice(1)) {
    const separatorIndex = segment.indexOf(":");
    if (separatorIndex <= 0) return null;
    const metric = segment.slice(0, separatorIndex);
    const metricValue = segment.slice(separatorIndex + 1);
    if (metric.length === 0 || metricValue.length === 0) return null;
    metrics.set(metric, metricValue);
  }

  const attackVector = OSV_CVSS_AV_VALUES[metrics.get("AV") ?? ""];
  const attackComplexity = OSV_CVSS_AC_VALUES[metrics.get("AC") ?? ""];
  const privilegesRequiredValue = metrics.get("PR");
  const userInteraction = OSV_CVSS_UI_VALUES[metrics.get("UI") ?? ""];
  const scopeValue = metrics.get("S");
  const confidentialityImpact = OSV_CVSS_IMPACT_VALUES[metrics.get("C") ?? ""];
  const integrityImpact = OSV_CVSS_IMPACT_VALUES[metrics.get("I") ?? ""];
  const availabilityImpact = OSV_CVSS_IMPACT_VALUES[metrics.get("A") ?? ""];

  if (
    attackVector === undefined ||
    attackComplexity === undefined ||
    privilegesRequiredValue === undefined ||
    userInteraction === undefined ||
    scopeValue === undefined ||
    confidentialityImpact === undefined ||
    integrityImpact === undefined ||
    availabilityImpact === undefined
  ) {
    return null;
  }

  const scope = scopeValue === "C" ? "C" : scopeValue === "U" ? "U" : null;
  if (scope === null) return null;

  const privilegesRequired = OSV_CVSS_PR_VALUES[scope][privilegesRequiredValue];
  if (privilegesRequired === undefined) return null;

  const impactSubScore =
    1 - (1 - confidentialityImpact) * (1 - integrityImpact) * (1 - availabilityImpact);
  if (impactSubScore <= 0) return 0;

  const impactScore =
    scope === "U"
      ? 6.42 * impactSubScore
      : 7.52 * (impactSubScore - 0.029) - 3.25 * Math.pow(impactSubScore - 0.02, 15);
  const exploitabilityScore =
    8.22 * attackVector * attackComplexity * privilegesRequired * userInteraction;
  const rawScore =
    scope === "U" ? impactScore + exploitabilityScore : 1.08 * (impactScore + exploitabilityScore);
  return Math.min(roundUpToOneDecimal(rawScore), 10);
};

const bucketCvssBaseScore = (baseScore: number): OsvSeverity => {
  if (baseScore >= 9) return "critical";
  if (baseScore >= 7) return "high";
  if (baseScore >= 4) return "moderate";
  return "low";
};

const parseOsvSeverityEntries = (
  severityEntries: ReadonlyArray<unknown>,
): ReadonlyArray<OsvSeverityEntry> => {
  const parsedEntries: OsvSeverityEntry[] = [];
  for (const severityEntry of severityEntries) {
    if (!isRecord(severityEntry)) continue;
    const score = typeof severityEntry["score"] === "string" ? severityEntry["score"] : undefined;
    const type = typeof severityEntry["type"] === "string" ? severityEntry["type"] : undefined;
    if (score === undefined && type === undefined) continue;
    parsedEntries.push({ score, type });
  }
  return parsedEntries;
};

const resolveVulnerabilitySeverity = (vulnerability: OsvVulnerabilityRecord): OsvSeverity => {
  if (isMalwareAdvisory(vulnerability)) return "critical";

  const databaseSpecificSeverity = normalizeSeverity(vulnerability.database_specific?.severity);
  if (databaseSpecificSeverity !== null) return databaseSpecificSeverity;

  let highestSeverity: OsvSeverity | null = null;
  for (const severityEntry of vulnerability.severity ?? []) {
    const parsedBaseScore = parseCvssV3BaseScore(severityEntry.score ?? "");
    if (parsedBaseScore === null) continue;
    const parsedSeverity = bucketCvssBaseScore(parsedBaseScore);
    if (highestSeverity === null || severityRank(parsedSeverity) > severityRank(highestSeverity)) {
      highestSeverity = parsedSeverity;
    }
  }

  return highestSeverity ?? "moderate";
};

const SUPPLY_CHAIN_FETCH_RETRY_SCHEDULE = Schedule.exponential(
  SUPPLY_CHAIN_FETCH_RETRY_BASE_MS,
).pipe(Schedule.take(SUPPLY_CHAIN_FETCH_MAX_RETRIES));

const resolveOptions = (config: ReactDoctorConfig | null): ResolvedSupplyChainOptions => ({
  severity: config?.supplyChain?.severity === "warning" ? "warning" : "error",
  includeDevDependencies: config?.supplyChain?.includeDevDependencies !== false,
  failOn: normalizeSeverity(config?.supplyChain?.failOn) ?? SUPPLY_CHAIN_DEFAULT_FAIL_ON,
});

const resolveConcreteVersion = (spec: string): string | null => {
  const trimmed = spec.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.includes(":")) return null;

  const range = semver.validRange(trimmed);
  if (range === null || range === "*") return null;
  return semver.minVersion(trimmed)?.version ?? null;
};

type DependencySection = "dependencies" | "devDependencies";

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

const readPackageJsonText = (packageJsonPath: string): string => {
  try {
    return fs.readFileSync(packageJsonPath, "utf-8");
  } catch {
    return "";
  }
};

const toPurl = (dependency: DependencyToScore): string =>
  `pkg:npm/${dependency.name}@${dependency.version}`;

const parseOsvQueryBatchResult = (result: unknown): ReadonlyArray<string> => {
  if (!isRecord(result)) return [];
  const vulns = result["vulns"];
  if (!Array.isArray(vulns)) return [];

  const ids: string[] = [];
  for (const vuln of vulns) {
    if (!isRecord(vuln)) continue;
    const vulnId = vuln["id"];
    if (typeof vulnId === "string" && vulnId.trim().length > 0) ids.push(vulnId);
  }
  return ids;
};

const parseOsvQueryBatchResponse = (
  payload: unknown,
  dependencyCount: number,
): ReadonlyArray<ReadonlyArray<string>> | null => {
  if (!isRecord(payload)) return null;
  const results = payload["results"];
  if (!Array.isArray(results)) return null;

  return Array.from({ length: dependencyCount }, (_, index) =>
    parseOsvQueryBatchResult(results[index]),
  );
};

const parseOsvQueryResponse = (payload: unknown): ReadonlyArray<CachedOsvVulnerability> | null => {
  if (!isRecord(payload)) return null;
  const vulns = payload["vulns"];
  if (!Array.isArray(vulns)) return null;

  const parsedVulnerabilities: CachedOsvVulnerability[] = [];
  for (const vuln of vulns) {
    if (!isRecord(vuln) || typeof vuln["id"] !== "string" || vuln["id"].trim().length === 0) {
      return null;
    }
    const parsedVulnerability = parseOsvVulnerabilityRecord(vuln["id"], vuln);
    if (parsedVulnerability === null) return null;
    parsedVulnerabilities.push(parsedVulnerability);
  }

  return parsedVulnerabilities;
};

const buildCachedVulnerability = (
  id: string,
  severity: OsvSeverity,
  summary: string,
): CachedOsvVulnerability => ({
  id,
  severity,
  summary,
  pageUrl: `${OSV_VULN_PAGE_BASE}/${encodeURIComponent(id)}`,
});

const parseOsvVulnerabilityRecord = (
  requestedId: string,
  payload: unknown,
): CachedOsvVulnerability | null => {
  if (!isRecord(payload)) return null;

  const payloadId =
    typeof payload["id"] === "string" && payload["id"].trim().length > 0
      ? payload["id"]
      : requestedId;
  const databaseSpecific = isRecord(payload["database_specific"])
    ? payload["database_specific"]
    : null;
  const summaryValue =
    typeof payload["summary"] === "string" && payload["summary"].trim().length > 0
      ? payload["summary"]
      : typeof payload["details"] === "string" && payload["details"].trim().length > 0
        ? payload["details"]
        : payloadId;
  const severity = resolveVulnerabilitySeverity({
    id: payloadId,
    summary: typeof payload["summary"] === "string" ? payload["summary"] : undefined,
    details: typeof payload["details"] === "string" ? payload["details"] : undefined,
    severity: Array.isArray(payload["severity"])
      ? parseOsvSeverityEntries(payload["severity"])
      : undefined,
    database_specific:
      databaseSpecific !== null
        ? {
            severity:
              typeof databaseSpecific["severity"] === "string"
                ? databaseSpecific["severity"]
                : undefined,
          }
        : undefined,
  });

  return buildCachedVulnerability(payloadId, severity, sanitizeSummaryText(summaryValue));
};

const readCachedOsvVulns = (cacheFile: string): ReadonlyArray<CachedOsvVulnerability> | null => {
  try {
    const entry: unknown = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
    if (
      isRecord(entry) &&
      typeof entry["fetchedAtMs"] === "number" &&
      Array.isArray(entry["vulns"]) &&
      Date.now() - entry["fetchedAtMs"] <= SUPPLY_CHAIN_CACHE_TTL_MS
    ) {
      const vulns: CachedOsvVulnerability[] = [];
      for (const vuln of entry["vulns"]) {
        if (!isRecord(vuln)) return null;
        if (
          typeof vuln["id"] !== "string" ||
          vuln["id"].trim().length === 0 ||
          typeof vuln["summary"] !== "string" ||
          typeof vuln["pageUrl"] !== "string"
        ) {
          return null;
        }
        const severity = normalizeSeverity(
          typeof vuln["severity"] === "string" ? vuln["severity"] : undefined,
        );
        if (severity === null) return null;
        vulns.push({
          id: vuln["id"],
          severity,
          summary: vuln["summary"],
          pageUrl: vuln["pageUrl"],
        });
      }
      return vulns;
    }
  } catch {
    // unreadable or malformed entries are treated as a miss.
  }

  return null;
};

const writeCachedOsvVulns = (
  cacheFile: string,
  vulns: ReadonlyArray<CachedOsvVulnerability>,
): void => {
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify({ fetchedAtMs: Date.now(), vulns }));
  } catch {
    // A cache write failure must never sink the scan.
  }
};

const pruneExpiredOsvCache = (cacheDirectory: string): void => {
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

const supplyChainCacheFile = (cacheDirectory: string, dependency: DependencyToScore): string => {
  const purlHash = crypto
    .createHash("sha256")
    .update(toPurl(dependency))
    .digest("hex")
    .slice(0, CACHE_FILENAME_HASH_LENGTH_CHARS);
  return path.join(cacheDirectory, SUPPLY_CHAIN_CACHE_SUBDIR, `${purlHash}.json`);
};

const isSupplyChainCacheDisabled = (): boolean => {
  const noCache = process.env["REACT_DOCTOR_NO_CACHE"]?.toLowerCase() ?? "";
  return noCache === "1" || noCache === "true";
};

const fetchJson = (url: string, init?: RequestInit): Effect.Effect<unknown | null> =>
  Effect.retry(
    Effect.tryPromise(async (signal) => {
      const response = await fetch(url, { ...init, signal });
      if (!response.ok) {
        throw new Error(`OSV request failed with status ${response.status}`);
      }

      return response.json();
    }).pipe(Effect.timeout(FETCH_TIMEOUT_MS)),
    SUPPLY_CHAIN_FETCH_RETRY_SCHEDULE,
  ).pipe(Effect.orElseSucceed(() => null));

const fetchOsvQueryBatch = (
  dependencies: ReadonlyArray<DependencyToScore>,
): Effect.Effect<ReadonlyArray<ReadonlyArray<string>> | null> =>
  fetchJson(`${OSV_API_BASE}/v1/querybatch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      queries: dependencies.map((dependency) => ({
        version: dependency.version,
        package: {
          name: dependency.name,
          ecosystem: "npm",
        },
      })),
    }),
  }).pipe(Effect.map((payload) => parseOsvQueryBatchResponse(payload, dependencies.length)));

const fetchOsvQuery = (
  dependency: DependencyToScore,
): Effect.Effect<ReadonlyArray<CachedOsvVulnerability> | null> =>
  fetchJson(`${OSV_API_BASE}/v1/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      version: dependency.version,
      package: {
        name: dependency.name,
        ecosystem: "npm",
      },
    }),
  }).pipe(Effect.map((payload) => parseOsvQueryResponse(payload)));

const selectMatchingVulnerabilities = (
  vulnerabilities: ReadonlyArray<CachedOsvVulnerability>,
  failOn: OsvSeverity,
): ReadonlyArray<CachedOsvVulnerability> => {
  const matching = vulnerabilities.filter(
    (vulnerability) => severityRank(vulnerability.severity) >= severityRank(failOn),
  );
  return [...matching].sort((left, right) => {
    const severityDelta = severityRank(right.severity) - severityRank(left.severity);
    if (severityDelta !== 0) return severityDelta;
    return left.id.localeCompare(right.id);
  });
};

const formatDependencyIdentity = (dependency: DependencyToScore): string =>
  semver.valid(dependency.spec) !== null
    ? `${dependency.name}@${dependency.version}`
    : `${dependency.name}@${dependency.version} (lowest version "${dependency.spec}" allows)`;

const buildSupplyChainHelp = (
  dependency: DependencyToScore,
  worstVulnerability: CachedOsvVulnerability,
  options: ResolvedSupplyChainOptions,
  hasMalware: boolean,
): string => {
  const entry = `"${dependency.name}": "${dependency.spec}"`;
  if (hasMalware) {
    return `Treat ${dependency.name} as compromised — do not ship it. Remove ${entry} from package.json and your lockfile, then audit anything it ran. Full report: ${worstVulnerability.pageUrl}. Only if you've confirmed this is a false positive, set \`supplyChain.enabled: false\`.`;
  }

  return `Upgrade ${entry} in package.json, or remove it if you don't need it. Full report: ${worstVulnerability.pageUrl}. If you've reviewed and accepted this package, raise \`supplyChain.failOn\` (currently ${options.failOn}) or set \`supplyChain.severity: "warning"\`.`;
};

const buildOsvDiagnostic = (
  dependency: DependencyToScore,
  matchingVulnerabilities: ReadonlyArray<CachedOsvVulnerability>,
  options: ResolvedSupplyChainOptions,
): Diagnostic => {
  const worstVulnerability = matchingVulnerabilities[0];
  const worstSeverity = worstVulnerability.severity;
  const hasMalware = matchingVulnerabilities.some(
    (vulnerability) =>
      vulnerability.id.toUpperCase().startsWith("MAL-") ||
      vulnerability.summary.toLowerCase().includes("malicious package"),
  );
  const issueLabel = hasMalware
    ? matchingVulnerabilities.length === 1
      ? "known malicious package advisory"
      : "known malicious package advisories"
    : matchingVulnerabilities.length === 1
      ? "known vulnerability"
      : "known vulnerabilities";
  const advisoryIds = matchingVulnerabilities
    .map((vulnerability) => sanitizeTerminalText(vulnerability.id))
    .join(", ");

  return {
    filePath: "package.json",
    plugin: SUPPLY_CHAIN_PLUGIN,
    rule: SUPPLY_CHAIN_RULE,
    severity: options.severity,
    message: `\`${formatDependencyIdentity(dependency)}\` has ${matchingVulnerabilities.length} ${worstSeverity}-severity ${issueLabel}: ${advisoryIds}.`,
    help: buildSupplyChainHelp(dependency, worstVulnerability, options, hasMalware),
    url: worstVulnerability.pageUrl,
    line: dependency.line,
    column: dependency.column,
    category: SUPPLY_CHAIN_CATEGORY,
  };
};

const getVulnerabilityIdsForDependency = (
  batchResults: ReadonlyArray<ReadonlyArray<string>>,
  dependencyIndex: number,
): ReadonlyArray<string> => {
  const ids = batchResults[dependencyIndex] ?? [];
  return [...new Set(ids)];
};

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

    const cacheDirectory = isSupplyChainCacheDisabled()
      ? null
      : resolveReactDoctorCacheDir(input.rootDirectory);
    if (cacheDirectory !== null) pruneExpiredOsvCache(cacheDirectory);

    const vulnerabilitiesByPurl = new Map<string, ReadonlyArray<CachedOsvVulnerability>>();
    const cacheEntriesByPurl = new Map<string, string>();
    const missedDependencies: DependencyToScore[] = [];
    const queryableMissedDependencies: Array<{
      readonly dependency: DependencyToScore;
      readonly cacheFile?: string;
    }> = [];

    for (const dependency of dependencies) {
      const purl = toPurl(dependency);
      if (cacheDirectory !== null) {
        const cacheFile = supplyChainCacheFile(cacheDirectory, dependency);
        cacheEntriesByPurl.set(purl, cacheFile);
        const cachedVulnerabilities = readCachedOsvVulns(cacheFile);
        if (cachedVulnerabilities !== null) {
          vulnerabilitiesByPurl.set(purl, cachedVulnerabilities);
          continue;
        }
      }
      missedDependencies.push(dependency);
    }

    if (missedDependencies.length > 0) {
      const batchResults = yield* fetchOsvQueryBatch(missedDependencies);
      if (batchResults !== null) {
        for (
          let dependencyIndex = 0;
          dependencyIndex < missedDependencies.length;
          dependencyIndex += 1
        ) {
          const dependency = missedDependencies[dependencyIndex];
          const purl = toPurl(dependency);
          const vulnerabilityIds = getVulnerabilityIdsForDependency(batchResults, dependencyIndex);
          if (vulnerabilityIds.length === 0) {
            vulnerabilitiesByPurl.set(purl, []);
            const cacheFile = cacheEntriesByPurl.get(purl);
            if (cacheFile !== undefined) writeCachedOsvVulns(cacheFile, []);
            continue;
          }

          queryableMissedDependencies.push({
            dependency,
            cacheFile: cacheEntriesByPurl.get(purl),
          });
        }
      }
    }

    if (queryableMissedDependencies.length > 0) {
      const queryResults = yield* Effect.forEach(
        queryableMissedDependencies,
        ({ dependency }) => fetchOsvQuery(dependency),
        { concurrency: SUPPLY_CHAIN_FETCH_CONCURRENCY },
      );

      for (
        let dependencyIndex = 0;
        dependencyIndex < queryableMissedDependencies.length;
        dependencyIndex += 1
      ) {
        const queryResult = queryResults[dependencyIndex];
        if (queryResult === null) continue;

        const { dependency, cacheFile } = queryableMissedDependencies[dependencyIndex];
        const purl = toPurl(dependency);
        vulnerabilitiesByPurl.set(purl, queryResult);
        if (cacheFile !== undefined) writeCachedOsvVulns(cacheFile, queryResult);
      }
    }

    const diagnostics: Diagnostic[] = [];
    for (const dependency of dependencies) {
      const purl = toPurl(dependency);
      const vulnerabilities = vulnerabilitiesByPurl.get(purl) ?? [];
      const matchingVulnerabilities = selectMatchingVulnerabilities(
        vulnerabilities,
        options.failOn,
      );
      if (matchingVulnerabilities.length === 0) continue;
      diagnostics.push(buildOsvDiagnostic(dependency, matchingVulnerabilities, options));
    }

    return diagnostics;
  }).pipe(
    Effect.timeoutOption(input.totalTimeoutMs ?? SUPPLY_CHAIN_OVERLAP_TIMEOUT_MS),
    Effect.map((maybeDiagnostics) => Option.getOrElse(maybeDiagnostics, () => [])),
  );
