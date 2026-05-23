import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as Schema from "effect/Schema";
import { JsonReport } from "@react-doctor/core/schemas";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const CLI_BINARY_PATH = resolve(REPOSITORY_ROOT, "packages/react-doctor/dist/cli.js");
const FIXTURE_DIRECTORY = resolve(
  REPOSITORY_ROOT,
  "packages/react-doctor/tests/fixtures/basic-react",
);

if (!existsSync(CLI_BINARY_PATH)) {
  console.error(`Built CLI missing at ${CLI_BINARY_PATH}. Run \`pnpm build\` first.`);
  process.exit(1);
}

if (!existsSync(FIXTURE_DIRECTORY)) {
  console.error(`Fixture missing at ${FIXTURE_DIRECTORY}.`);
  process.exit(1);
}

// `--offline --no-lint --no-dead-code` keeps the run fast and
// deterministic — we're checking that the CLI plumbing produces a
// schema-valid v1 JsonReport, not that any particular rule fires.
// The eval harness (react-doctor-evals parity check) is the right
// tool for diagnostic-set comparison; this smoke catches structural
// regressions to the JSON output across refactor PRs.
const result = spawnSync(
  process.execPath,
  [CLI_BINARY_PATH, FIXTURE_DIRECTORY, "--offline", "--no-lint", "--no-dead-code", "--json"],
  { encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 },
);

if (result.status !== 0 && result.status !== 1) {
  console.error(`CLI exited with unexpected status ${result.status}`);
  console.error("stderr:", result.stderr);
  process.exit(1);
}

let parsed: unknown;
try {
  parsed = JSON.parse(result.stdout);
} catch (cause) {
  console.error("CLI did not produce parseable JSON on stdout.");
  console.error("stdout:", result.stdout.slice(0, 2_000));
  console.error("cause:", cause);
  process.exit(1);
}

let decoded: ReturnType<typeof Schema.decodeUnknownSync<typeof JsonReport>>;
try {
  decoded = Schema.decodeUnknownSync(JsonReport)(parsed);
} catch (cause) {
  console.error("CLI output did not validate against the JsonReport schema.");
  console.error("cause:", cause);
  process.exit(1);
}

if (decoded.schemaVersion !== 1) {
  console.error(`Expected schemaVersion 1, got ${decoded.schemaVersion}`);
  process.exit(1);
}

if (decoded.mode !== "full") {
  console.error(`Expected mode "full", got "${decoded.mode}"`);
  process.exit(1);
}

if (decoded.summary.totalDiagnosticCount !== decoded.diagnostics.length) {
  console.error(
    `summary.totalDiagnosticCount (${decoded.summary.totalDiagnosticCount}) does not match diagnostics.length (${decoded.diagnostics.length})`,
  );
  process.exit(1);
}

console.log(
  `Smoke OK: schemaVersion=${decoded.schemaVersion} mode=${decoded.mode} projects=${decoded.projects.length} diagnostics=${decoded.diagnostics.length}`,
);
