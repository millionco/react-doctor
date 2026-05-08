import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

const REPO = "millionco/react-doctor-benchmarks";
const ARTIFACT_PREFIX = "result-";

interface BenchmarkInstall {
  attempted: boolean;
  success: boolean;
  packageManager: string;
  durationMs: number;
}

interface BenchmarkResult {
  schemaVersion: number;
  slug: string;
  name: string;
  githubUrl: string;
  ref: string;
  commitSha: string;
  scannedAt: string;
  doctorVersion: string;
  score: number;
  scoreLabel: string;
  errorCount: number;
  warningCount: number;
  affectedFileCount: number;
  totalDiagnosticCount: number;
  scanElapsedMs: number;
  install: BenchmarkInstall;
  skipDeadCode: boolean;
  status: string;
  errorMessage: string | null;
}

const gh = (args: string): string => execSync(`gh ${args}`, { encoding: "utf-8" }).trim();

const getLatestRunId = (): number => {
  const output = gh(
    `run list --repo ${REPO} --branch main --limit 1 --json databaseId --jq '.[0].databaseId'`,
  );
  const runId = Number(output);
  if (Number.isNaN(runId)) {
    throw new Error(`Failed to get latest run ID: ${output}`);
  }
  return runId;
};

const getArtifactIds = (runId: number): Array<{ id: number; name: string }> => {
  const output = gh(
    `api repos/${REPO}/actions/runs/${runId}/artifacts --jq '.artifacts[] | select(.name | startswith("${ARTIFACT_PREFIX}")) | {id, name}'`,
  );
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { id: number; name: string });
};

const downloadAndParseArtifact = async (
  artifactId: number,
  tempDirectory: string,
): Promise<BenchmarkResult | null> => {
  const artifactDirectory = join(tempDirectory, String(artifactId));
  try {
    execSync(
      `mkdir -p "${artifactDirectory}" && cd "${artifactDirectory}" && gh api repos/${REPO}/actions/artifacts/${artifactId}/zip > artifact.zip && unzip -qo artifact.zip`,
      { encoding: "utf-8" },
    );
    const files = await readdir(artifactDirectory);
    const jsonFile = files.find((file) => file.endsWith(".json"));
    if (!jsonFile) return null;

    const content = await readFile(join(artifactDirectory, jsonFile), "utf-8");
    return JSON.parse(content) as BenchmarkResult;
  } catch {
    return null;
  }
};

const formatDuration = (milliseconds: number): string => {
  if (milliseconds < 1000) return `${milliseconds}ms`;
  return `${(milliseconds / 1000).toFixed(1)}s`;
};

const scoreColor = (score: number): string => {
  if (score >= 75) return "\x1b[32m";
  if (score >= 50) return "\x1b[33m";
  return "\x1b[31m";
};

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

const printResults = (results: BenchmarkResult[]): void => {
  const sorted = results.toSorted((left, right) => right.score - left.score);
  const maxNameLength = Math.max(...sorted.map((result) => result.name.length));

  console.log();
  console.log(
    `${BOLD}Benchmark Scores${RESET} ${DIM}(${results.length} repos, doctor v${sorted[0]?.doctorVersion ?? "?"})${RESET}`,
  );
  console.log(`${DIM}${"─".repeat(maxNameLength + 70)}${RESET}`);
  console.log(
    `${BOLD}${"Repo".padEnd(maxNameLength + 2)}${"Score".padStart(7)}  ${"Label".padEnd(12)}${"Errors".padStart(8)}${"Warns".padStart(8)}${"Files".padStart(8)}${"Time".padStart(8)}${RESET}`,
  );
  console.log(`${DIM}${"─".repeat(maxNameLength + 70)}${RESET}`);

  for (const result of sorted) {
    if (result.status !== "ok") {
      console.log(
        `${result.name.padEnd(maxNameLength + 2)}  ${"\x1b[31m"}FAILED${RESET}  ${DIM}${result.errorMessage ?? "unknown error"}${RESET}`,
      );
      continue;
    }
    const color = scoreColor(result.score);
    console.log(
      `${result.name.padEnd(maxNameLength + 2)}${color}${String(result.score).padStart(7)}${RESET}  ${result.scoreLabel.padEnd(12)}${String(result.errorCount).padStart(8)}${String(result.warningCount).padStart(8)}${String(result.affectedFileCount).padStart(8)}${formatDuration(result.scanElapsedMs).padStart(8)}`,
    );
  }

  console.log(`${DIM}${"─".repeat(maxNameLength + 70)}${RESET}`);

  const okResults = sorted.filter((result) => result.status === "ok");
  const averageScore = Math.round(
    okResults.reduce((sum, result) => sum + result.score, 0) / okResults.length,
  );
  const totalErrors = okResults.reduce((sum, result) => sum + result.errorCount, 0);
  const totalWarnings = okResults.reduce((sum, result) => sum + result.warningCount, 0);
  const averageColor = scoreColor(averageScore);

  console.log(
    `${"Average".padEnd(maxNameLength + 2)}${averageColor}${String(averageScore).padStart(7)}${RESET}${"".padStart(14)}${String(totalErrors).padStart(8)}${String(totalWarnings).padStart(8)}`,
  );
  console.log();

  const scannedAt = sorted[0]?.scannedAt;
  if (scannedAt) {
    console.log(`${DIM}Scanned at: ${new Date(scannedAt).toLocaleString()}${RESET}`);
  }
};

const main = async (): Promise<void> => {
  console.log(`${DIM}Fetching latest benchmark run from ${REPO}...${RESET}`);
  const runId = getLatestRunId();
  console.log(`${DIM}Run ID: ${runId}${RESET}`);

  const artifacts = getArtifactIds(runId);
  console.log(`${DIM}Found ${artifacts.length} result artifacts${RESET}`);

  const tempDirectory = await mkdtemp(join(tmpdir(), "bench-scores-"));

  try {
    const results = await Promise.all(
      artifacts.map(({ id }) => downloadAndParseArtifact(id, tempDirectory)),
    );
    const validResults = results.filter((result): result is BenchmarkResult => result !== null);

    if (validResults.length === 0) {
      console.error("No valid benchmark results found");
      process.exit(1);
    }

    printResults(validResults);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
};

main();
