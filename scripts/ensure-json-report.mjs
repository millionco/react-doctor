import * as fs from "node:fs";

const reportPath = process.argv[2];
const status = Number(process.argv[3] ?? "1");

if (!reportPath) {
  process.exit(0);
}

const fallbackReport = {
  schemaVersion: 3,
  version: "unknown",
  ok: false,
  directory: process.cwd(),
  mode: "full",
  diff: null,
  projects: [],
  diagnostics: [],
  summary: {
    errorCount: 0,
    warningCount: 0,
    affectedFileCount: 0,
    totalDiagnosticCount: 0,
    score: null,
    scoreLabel: null,
  },
  elapsedMilliseconds: 0,
  error: {
    name: "ReactDoctorActionError",
    message: `react-doctor exited with status ${Number.isFinite(status) ? status : 1} before producing a JSON report.`,
    chain: [],
  },
};

// Known JsonReport schema versions remain valid CLI output; only an
// unparseable or unrecognized payload is treated as a failed scan.
const KNOWN_SCHEMA_VERSIONS = new Set([1, 2, 3]);

const findValidReport = (raw) => {
  const candidateStarts = [0];
  for (const match of raw.matchAll(/\r?\n(?=\s*\{)/g)) {
    candidateStarts.push(match.index + match[0].length);
  }

  for (const candidateStart of candidateStarts) {
    const candidate = raw.slice(candidateStart).trim();
    try {
      const parsed = JSON.parse(candidate);
      if (
        parsed &&
        KNOWN_SCHEMA_VERSIONS.has(parsed.schemaVersion) &&
        typeof parsed.ok === "boolean"
      ) {
        return candidate;
      }
    } catch {}
  }

  return null;
};

try {
  const raw = fs.readFileSync(reportPath, "utf8").trim();
  const validReport = findValidReport(raw);
  if (validReport !== null) {
    if (validReport !== raw) fs.writeFileSync(reportPath, `${validReport}\n`);
    process.exit(0);
  }
} catch {
  // Fall through to the fallback report.
}

fs.writeFileSync(reportPath, `${JSON.stringify(fallbackReport)}\n`);
process.exit(1);
