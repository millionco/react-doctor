import fs from "node:fs";

const reportPath = process.argv[2];
const status = Number(process.argv[3] ?? "1");

if (!reportPath) {
  process.exit(0);
}

const fallbackReport = {
  schemaVersion: 1,
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

try {
  const raw = fs.readFileSync(reportPath, "utf8").trim();
  const parsed = JSON.parse(raw);
  if (parsed && parsed.schemaVersion === 1 && typeof parsed.ok === "boolean") {
    process.exit(0);
  }
} catch {
  // Fall through to the fallback report.
}

fs.writeFileSync(reportPath, `${JSON.stringify(fallbackReport)}\n`);
process.exit(1);
