import * as fs from "node:fs";

const reportPath = process.argv[2];
const status = Number(process.argv[3] ?? "1");

if (!reportPath) {
  process.exit(0);
}

const buildFallbackReport = (errorMessage) => ({
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
    message: errorMessage,
    chain: [],
  },
});

const KNOWN_SCHEMA_VERSIONS = new Set([1, 2, 3]);

try {
  const raw = fs.readFileSync(reportPath, "utf8").trim();
  
  if (!raw) {
    const fallbackReport = buildFallbackReport(
      `react-doctor exited with status ${Number.isFinite(status) ? status : 1} but produced an empty report. This may occur when no files were scanned or an unexpected error occurred.`,
    );
    fs.writeFileSync(reportPath, `${JSON.stringify(fallbackReport)}\n`);
    process.exit(1);
  }
  
  const parsed = JSON.parse(raw);
  
  if (!parsed || typeof parsed !== "object") {
    const fallbackReport = buildFallbackReport(
      `react-doctor produced invalid JSON output. This may indicate a crash or unexpected error during the scan.`,
    );
    fs.writeFileSync(reportPath, `${JSON.stringify(fallbackReport)}\n`);
    process.exit(1);
  }
  
  if (typeof parsed.schemaVersion !== "number") {
    const fallbackReport = buildFallbackReport(
      `react-doctor produced a JSON report without a schemaVersion field. The installed react-doctor version may be incompatible with this GitHub Action version.`,
    );
    fs.writeFileSync(reportPath, `${JSON.stringify(fallbackReport)}\n`);
    process.exit(1);
  }
  
  if (!KNOWN_SCHEMA_VERSIONS.has(parsed.schemaVersion)) {
    const fallbackReport = buildFallbackReport(
      `react-doctor produced a JSON report with schema version ${parsed.schemaVersion}, which is not supported by this GitHub Action version (supports: ${Array.from(KNOWN_SCHEMA_VERSIONS).sort().join(", ")}). Please update the GitHub Action to the latest version (millionco/react-doctor@v2) or pin the react-doctor version to match this Action release.`,
    );
    fs.writeFileSync(reportPath, `${JSON.stringify(fallbackReport)}\n`);
    process.exit(1);
  }
  
  if (typeof parsed.ok !== "boolean") {
    const fallbackReport = buildFallbackReport(
      `react-doctor produced a JSON report with schema version ${parsed.schemaVersion} but is missing the required 'ok' field. The report may be corrupted.`,
    );
    fs.writeFileSync(reportPath, `${JSON.stringify(fallbackReport)}\n`);
    process.exit(1);
  }
  
  process.exit(0);
} catch (parseError) {
  const fallbackReport = buildFallbackReport(
    `react-doctor produced unparseable JSON output. Parse error: ${parseError.message}`,
  );
  fs.writeFileSync(reportPath, `${JSON.stringify(fallbackReport)}\n`);
  process.exit(1);
}
