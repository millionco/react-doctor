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

const failWithReport = (errorMessage) => {
  fs.writeFileSync(reportPath, `${JSON.stringify(buildFallbackReport(errorMessage))}\n`);
  process.exit(1);
};

const KNOWN_SCHEMA_VERSIONS = new Set([1, 2, 3]);

let raw;

try {
  raw = fs.readFileSync(reportPath, "utf8").trim();
} catch {
  failWithReport(
    `react-doctor exited with status ${Number.isFinite(status) ? status : 1} without producing a readable JSON report.`,
  );
}

if (!raw) {
  failWithReport(
    `react-doctor exited with status ${Number.isFinite(status) ? status : 1} but produced an empty report.`,
  );
}

let parsed;

try {
  parsed = JSON.parse(raw);
} catch {
  failWithReport("react-doctor produced output that is not valid JSON.");
}

if (!parsed || typeof parsed !== "object") {
  failWithReport("react-doctor produced JSON that is not a report object.");
}

if (typeof parsed.schemaVersion !== "number") {
  failWithReport(
    "react-doctor produced a JSON report without a schemaVersion. The installed CLI may be incompatible with this GitHub Action version.",
  );
}

if (!KNOWN_SCHEMA_VERSIONS.has(parsed.schemaVersion)) {
  failWithReport(
    `react-doctor produced schema version ${parsed.schemaVersion}, but this GitHub Action supports ${Array.from(KNOWN_SCHEMA_VERSIONS).sort().join(", ")}. Update millionco/react-doctor@v2 or pin the CLI version to match the Action release.`,
  );
}

if (typeof parsed.ok !== "boolean") {
  failWithReport(
    `react-doctor produced a schema version ${parsed.schemaVersion} report without the required ok field.`,
  );
}

process.exit(0);
