import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMMAND_MAX_BUFFER_BYTES,
  COUNT_CHANGE_ALERT_MIN_ABSOLUTE_DELTA,
  COUNT_CHANGE_ALERT_RATIO,
  DEAD_RULE_BASELINE_MIN_FINDINGS,
  GIT_CLONE_TIMEOUT_MS,
  SCAN_MAX_ATTEMPTS,
  SCAN_TIMEOUT_MS,
  TEMP_DIR_PREFIX,
  type CorpusRepository,
  type DeltaAuditResults,
  type RepositoryAuditResult,
} from "./constants.ts";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "../..");
const CLI_BINARY_PATH = path.resolve(REPOSITORY_ROOT, "packages/react-doctor/dist/cli.js");
const CORPUS_PATH = path.resolve(SCRIPT_DIRECTORY, "corpus.json");

interface CliArguments {
  comparePath: string | null;
  outPath: string | null;
  onlySlugs: Set<string> | null;
}

const parseCliArguments = (argv: string[]): CliArguments => {
  const parsed: CliArguments = { comparePath: null, outPath: null, onlySlugs: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--compare") {
      index += 1;
      parsed.comparePath = argv[index] ?? null;
      if (!parsed.comparePath) throw new Error("--compare requires a baseline path");
    } else if (argument === "--out") {
      index += 1;
      parsed.outPath = argv[index] ?? null;
      if (!parsed.outPath) throw new Error("--out requires a file path");
    } else if (argument === "--only") {
      index += 1;
      const slugList = argv[index];
      if (!slugList) throw new Error("--only requires a comma-separated slug list");
      parsed.onlySlugs = new Set(slugList.split(",").map((slug) => slug.trim()));
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return parsed;
};

const log = (message: string): void => {
  process.stderr.write(`${message}\n`);
};

const scanEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  REACT_DOCTOR_NO_TELEMETRY: "1",
  REACT_DOCTOR_NO_CACHE: "1",
  SENTRY_TRACES_SAMPLE_RATE: "0",
};

const runGit = (gitArguments: string[], cwd: string): void => {
  execFileSync("git", gitArguments, {
    cwd,
    env: scanEnvironment,
    maxBuffer: COMMAND_MAX_BUFFER_BYTES,
    stdio: ["ignore", "ignore", "pipe"],
    timeout: GIT_CLONE_TIMEOUT_MS,
  });
};

const cloneAtPinnedSha = (repository: CorpusRepository, checkoutDirectory: string): void => {
  fs.mkdirSync(checkoutDirectory, { recursive: true });
  runGit(["init", "--quiet"], checkoutDirectory);
  runGit(["remote", "add", "origin", repository.url], checkoutDirectory);
  runGit(["fetch", "--quiet", "--depth=1", "origin", repository.sha], checkoutDirectory);
  runGit(["checkout", "--quiet", "--detach", "FETCH_HEAD"], checkoutDirectory);
};

const measureDirectorySizeMb = (directory: string): number => {
  const output = execFileSync("du", ["-sm", directory], { encoding: "utf8" });
  return Number.parseInt(output, 10);
};

// Scans must measure react-doctor's curated rule set only: adopting a corpus
// repo's own lint config would skew counts with third-party rules and fail on
// configs whose plugins aren't installed (no `pnpm install` is run in clones).
const writeScanConfig = (checkoutDirectory: string): void => {
  const configPath = path.join(checkoutDirectory, "doctor.config.json");
  fs.writeFileSync(
    configPath,
    `${JSON.stringify({ adoptExistingLintConfig: false, share: false }, null, 2)}\n`,
  );
};

interface JsonReportDiagnostic {
  plugin: string;
  rule: string;
}

interface JsonReportProject {
  skippedChecks: string[];
  skippedCheckReasons?: Record<string, string>;
}

const collectLintDegradations = (projects: JsonReportProject[]): string[] =>
  projects.flatMap((project) => [
    ...project.skippedChecks.filter((check) => check === "lint"),
    ...Object.entries(project.skippedCheckReasons ?? {})
      .filter(([reasonKey]) => reasonKey.startsWith("lint"))
      .map(([reasonKey, reason]) => `${reasonKey}: ${reason}`),
  ]);

const scanRepositoryOnce = (
  repository: CorpusRepository,
  checkoutDirectory: string,
  scanDirectory: string,
): RepositoryAuditResult => {
  const reportPath = path.join(
    checkoutDirectory,
    "..",
    `${path.basename(checkoutDirectory)}.report.json`,
  );
  const scanResult = spawnSync(
    process.execPath,
    [
      CLI_BINARY_PATH,
      scanDirectory,
      "--json",
      "--json-out",
      reportPath,
      "--no-score",
      "--no-dead-code",
      "--no-supply-chain",
    ],
    {
      encoding: "utf8",
      env: scanEnvironment,
      maxBuffer: COMMAND_MAX_BUFFER_BYTES,
      timeout: SCAN_TIMEOUT_MS,
    },
  );
  if (scanResult.status !== 0 && scanResult.status !== 1) {
    throw new Error(
      `react-doctor exited with status ${scanResult.status} for ${repository.slug}\n${scanResult.stderr}`,
    );
  }
  if (!fs.existsSync(reportPath)) {
    throw new Error(
      `react-doctor exited with status ${scanResult.status} for ${repository.slug} but wrote no report\nstdout: ${scanResult.stdout.slice(0, 4_000)}\nstderr: ${scanResult.stderr.slice(0, 4_000)}`,
    );
  }
  const report: { diagnostics: JsonReportDiagnostic[]; projects: JsonReportProject[] } = JSON.parse(
    fs.readFileSync(reportPath, "utf8"),
  );
  const lintDegradations = collectLintDegradations(report.projects);
  if (lintDegradations.length > 0) {
    throw new Error(`lint pass degraded for ${repository.slug}: ${lintDegradations.join("; ")}`);
  }
  const ruleCounts: Record<string, number> = {};
  for (const diagnostic of report.diagnostics) {
    const ruleId = `${diagnostic.plugin}/${diagnostic.rule}`;
    ruleCounts[ruleId] = (ruleCounts[ruleId] ?? 0) + 1;
  }
  return { repo: repository.slug, sha: repository.sha, ruleCounts };
};

// A lint pass can degrade transiently (worker crash, resource pressure) while
// the CLI still exits 0/1 with a near-empty report — without this guard a
// degraded scan silently corrupts the baseline or fires bogus delta alerts.
const scanRepository = (
  repository: CorpusRepository,
  checkoutDirectory: string,
  scanDirectory: string,
): RepositoryAuditResult => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= SCAN_MAX_ATTEMPTS; attempt += 1) {
    try {
      return scanRepositoryOnce(repository, checkoutDirectory, scanDirectory);
    } catch (error) {
      lastError = error;
      log(
        `[${repository.slug}] scan attempt ${attempt}/${SCAN_MAX_ATTEMPTS} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  throw lastError;
};

const readCliVersion = (): string => {
  const versionResult = spawnSync(process.execPath, [CLI_BINARY_PATH, "--version"], {
    encoding: "utf8",
    env: scanEnvironment,
  });
  return versionResult.stdout.trim() || "unknown";
};

const runAudit = (corpus: CorpusRepository[]): DeltaAuditResults => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_DIR_PREFIX));
  const repositories: RepositoryAuditResult[] = [];
  try {
    for (const repository of corpus) {
      const checkoutDirectory = path.join(
        temporaryDirectory,
        repository.slug.replaceAll("/", "__").replaceAll(".", "-"),
      );
      const cloneStartedAt = Date.now();
      cloneAtPinnedSha(repository, checkoutDirectory);
      const cloneSizeMb = measureDirectorySizeMb(checkoutDirectory);
      log(
        `[${repository.slug}] cloned @ ${repository.sha.slice(0, 10)} in ${Math.round((Date.now() - cloneStartedAt) / 1000)}s (${cloneSizeMb} MB)`,
      );
      const scanDirectory = repository.subdirectory
        ? path.join(checkoutDirectory, repository.subdirectory)
        : checkoutDirectory;
      writeScanConfig(scanDirectory);
      const scanStartedAt = Date.now();
      const result = scanRepository(repository, checkoutDirectory, scanDirectory);
      const findingTotal = Object.values(result.ruleCounts).reduce((sum, count) => sum + count, 0);
      log(
        `[${repository.slug}] scanned in ${Math.round((Date.now() - scanStartedAt) / 1000)}s — ${findingTotal} findings across ${Object.keys(result.ruleCounts).length} rules`,
      );
      repositories.push(result);
      fs.rmSync(checkoutDirectory, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
  return {
    generatedAt: new Date().toISOString(),
    cliVersion: readCliVersion(),
    repositories,
  };
};

const aggregateRuleTotals = (results: DeltaAuditResults): Map<string, number> => {
  const totals = new Map<string, number>();
  for (const repository of results.repositories) {
    for (const [ruleId, count] of Object.entries(repository.ruleCounts)) {
      totals.set(ruleId, (totals.get(ruleId) ?? 0) + count);
    }
  }
  return totals;
};

interface RuleDelta {
  ruleId: string;
  baselineCount: number;
  currentCount: number;
  status: "dead-rule" | "spike" | "drop" | "new" | "changed" | "unchanged";
}

const classifyRuleDelta = (baselineCount: number, currentCount: number): RuleDelta["status"] => {
  if (baselineCount === 0 && currentCount > 0) return "new";
  if (baselineCount >= DEAD_RULE_BASELINE_MIN_FINDINGS && currentCount === 0) return "dead-rule";
  const absoluteDelta = Math.abs(currentCount - baselineCount);
  if (baselineCount > 0 && absoluteDelta >= COUNT_CHANGE_ALERT_MIN_ABSOLUTE_DELTA) {
    if (currentCount >= baselineCount * COUNT_CHANGE_ALERT_RATIO) return "spike";
    if (currentCount * COUNT_CHANGE_ALERT_RATIO <= baselineCount) return "drop";
  }
  return baselineCount === currentCount ? "unchanged" : "changed";
};

const isAlertStatus = (status: RuleDelta["status"]): boolean =>
  status === "dead-rule" || status === "spike" || status === "drop";

const formatRatio = (baselineCount: number, currentCount: number): string => {
  if (baselineCount === 0) return "—";
  return `${(currentCount / baselineCount).toFixed(2)}x`;
};

const printDeltaTable = (deltas: RuleDelta[]): void => {
  const visibleDeltas = deltas.filter((delta) => delta.status !== "unchanged");
  const unchangedCount = deltas.length - visibleDeltas.length;
  console.log("| Rule | Baseline | Current | Delta | Ratio | Status |");
  console.log("| --- | ---: | ---: | ---: | ---: | --- |");
  for (const delta of visibleDeltas) {
    const signedDelta = delta.currentCount - delta.baselineCount;
    const statusLabel = isAlertStatus(delta.status)
      ? `**${delta.status.toUpperCase()}**`
      : delta.status;
    console.log(
      `| ${delta.ruleId} | ${delta.baselineCount} | ${delta.currentCount} | ${signedDelta >= 0 ? "+" : ""}${signedDelta} | ${formatRatio(delta.baselineCount, delta.currentCount)} | ${statusLabel} |`,
    );
  }
  console.log("");
  console.log(`${unchangedCount} rule(s) unchanged, ${visibleDeltas.length} rule(s) shown.`);
};

const compareAgainstBaseline = (
  baseline: DeltaAuditResults,
  current: DeltaAuditResults,
): number => {
  const baselinePins = baseline.repositories
    .map((repository) => `${repository.repo}@${repository.sha}`)
    .sort();
  const currentPins = current.repositories
    .map((repository) => `${repository.repo}@${repository.sha}`)
    .sort();
  if (JSON.stringify(baselinePins) !== JSON.stringify(currentPins)) {
    console.log("Corpus does not match the baseline. Refresh the baseline (see README.md).");
    console.log(`Baseline pins: ${baselinePins.join(", ")}`);
    console.log(`Current pins: ${currentPins.join(", ")}`);
    return 1;
  }

  const baselineTotals = aggregateRuleTotals(baseline);
  const currentTotals = aggregateRuleTotals(current);
  const allRuleIds = [...new Set([...baselineTotals.keys(), ...currentTotals.keys()])];

  const deltas: RuleDelta[] = allRuleIds
    .map((ruleId) => {
      const baselineCount = baselineTotals.get(ruleId) ?? 0;
      const currentCount = currentTotals.get(ruleId) ?? 0;
      return {
        ruleId,
        baselineCount,
        currentCount,
        status: classifyRuleDelta(baselineCount, currentCount),
      };
    })
    .sort(
      (left, right) =>
        Math.abs(right.currentCount - right.baselineCount) -
        Math.abs(left.currentCount - left.baselineCount),
    );

  console.log(`## Delta audit: ${current.cliVersion} vs baseline (${baseline.cliVersion})`);
  console.log("");
  printDeltaTable(deltas);

  const alerts = deltas.filter((delta) => isAlertStatus(delta.status));
  if (alerts.length > 0) {
    console.log("");
    console.log(
      `FAIL: ${alerts.length} rule(s) tripped delta thresholds (dead-rule: baseline >= ${DEAD_RULE_BASELINE_MIN_FINDINGS} -> 0; spike/drop: >= ${COUNT_CHANGE_ALERT_RATIO}x change with absolute delta >= ${COUNT_CHANGE_ALERT_MIN_ABSOLUTE_DELTA}).`,
    );
    return 1;
  }
  console.log("");
  console.log("PASS: no rule tripped delta thresholds.");
  return 0;
};

const main = (): void => {
  if (!fs.existsSync(CLI_BINARY_PATH)) {
    log(`Built CLI missing at ${CLI_BINARY_PATH}. Run \`pnpm build\` first.`);
    process.exit(1);
  }
  const cliArguments = parseCliArguments(process.argv.slice(2));
  const corpus: CorpusRepository[] = JSON.parse(fs.readFileSync(CORPUS_PATH, "utf8"));
  const selectedCorpus = cliArguments.onlySlugs
    ? corpus.filter((repository) => cliArguments.onlySlugs?.has(repository.slug))
    : corpus;
  if (selectedCorpus.length === 0) {
    log("No corpus repositories selected.");
    process.exit(1);
  }

  const auditStartedAt = Date.now();
  const results = runAudit(selectedCorpus);
  log(`Audit finished in ${Math.round((Date.now() - auditStartedAt) / 1000)}s.`);

  if (cliArguments.comparePath) {
    const baseline: DeltaAuditResults = JSON.parse(
      fs.readFileSync(cliArguments.comparePath, "utf8"),
    );
    process.exit(compareAgainstBaseline(baseline, results));
  }

  const serializedResults = `${JSON.stringify(results, null, 2)}\n`;
  if (cliArguments.outPath) {
    fs.writeFileSync(cliArguments.outPath, serializedResults);
    log(`Results written to ${cliArguments.outPath}`);
  } else {
    process.stdout.write(serializedResults);
  }
};

main();
