export const DEFAULT_REACT_DOCTOR_REPOSITORY = "https://github.com/millionco/react-doctor.git";
export const DEFAULT_REACT_DOCTOR_REF = "main";
export const DEFAULT_REPOSITORIES_SOURCES: ReadonlyArray<string> = ["./repositories.json"];
export const DEFAULT_TARGET_REPOSITORY_REF = "HEAD";
export const DEFAULT_TARGET_ROOT_DIRECTORY = ".";
export const REPOSITORY_SOURCE_EXTENSIONS: ReadonlyArray<string> = [".json", ".ndjson", ".txt"];
export const PINNED_REPOSITORY_REF_PATTERN = /^[0-9a-f]{40}$/i;
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;
export const EVALUATION_RULE_KEY_PATTERN = /^[a-z0-9][a-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9-]*$/;
export const DEFAULT_CORPUS_REPOSITORY_COUNT = 2_000;
export const DEFAULT_CORPUS_CONCURRENCY = 200;
export const DEFAULT_REPOSITORIES_PER_SANDBOX = 10;
export const DEFAULT_PROJECT_ROOTS_PER_REPOSITORY = 1;
export const DEFAULT_EVALUATION_MAX_DURATION_MINUTES = 45;
export const EVALUATION_CLEANUP_RESERVE_MINUTES = 2;
export const EVALUATION_RETRY_CONCURRENCIES: ReadonlyArray<number> = [50, 10, 2];
export const EVALUATION_RETRY_ATTEMPT_RESERVE_MINUTES = 5;
export const EVALUATION_MAXIMUM_RETRY_RESERVE_RATIO = 0.25;
export const EVALUATION_RETRY_REPOSITORIES_PER_SANDBOX = 1;
export const EVALUATION_CONFIG_CONTRACT = "revision-local-rule-config-v1";

export const DAYTONA_RUN_NAME = "react-doctor";
export const SANDBOX_IMAGE = "node:22-bookworm";
export const SANDBOX_CPU_CORES = 2;
export const SANDBOX_MEMORY_GIB = 4;
export const SANDBOX_DISK_GIB = 10;
export const PAIRED_SANDBOX_CPU_CORES = 4;
export const PAIRED_SANDBOX_MEMORY_GIB = 8;
export const PAIRED_SANDBOX_DISK_GIB = 20;
export const PAIRED_SCAN_MINIMUM_PARALLEL_CPU_CORES = 4;
export const DEFAULT_PAIRED_CORPUS_CONCURRENCY = 50;
export const DEFAULT_MATRIX_WAVE_WIDTH = 2;
export const MATRIX_MAXIMUM_CONCURRENCY = 50;
export const MATRIX_MAXIMUM_TREATMENTS = 8;
export const MATRIX_MAXIMUM_CPU_CORES = 400;
export const MATRIX_CPU_CORES_PER_LANE = 2;
export const MATRIX_MEMORY_GIB_PER_LANE = 4;
export const MATRIX_DISK_GIB_PER_DETECTOR = 10;
export const MATRIX_DESCRIPTOR_SCHEMA_VERSION = 1;
export const MATRIX_DESCRIPTOR_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
export const MATRIX_SCAN_CONTRACT = "react-doctor-json-full-v1";
export const MATRIX_REPORT_CONTRACT = "react-doctor-complete-report-v1";
export const MATRIX_PROJECT_ROOT_POLICY = "manifest-root-dir-v1";
export const MATRIX_BASE_LANE_ID = "matrix-base";
export const MATRIX_BASE_ARTIFACT_CONTRACT = "matrix-base-artifact-v1";
export const MATRIX_FULL_PARITY_RULE_KEYS = ["react-doctor/react-compiler-no-manual-memoization"];
export const MATRIX_LOCAL_COMMAND_TIMEOUT_SECONDS = 120;
export const MATRIX_CLEANUP_VERIFICATION_POLL_INTERVAL_MS = 500;
export const MATRIX_REACT_DOCTOR_DIRECTORY = "/workspace/react-doctor-matrix";
export const MATRIX_PROVENANCE_DIRECTORY = "/workspace/react-doctor-matrix-provenance";
export const MATRIX_TARGET_REPOSITORY_DIRECTORY = "/workspace/target-matrix.git";
export const MATRIX_TARGET_WORKTREE_DIRECTORY = "/workspace/target-matrix-lanes";
export const MATRIX_REPORT_DIRECTORY = "/tmp/react-doctor-matrix-reports";
export const SANDBOX_AUTO_STOP_INTERVAL_MINUTES = 60;
export const SANDBOX_CREATE_TIMEOUT_SECONDS = 600;
export const SANDBOX_SETUP_TIMEOUT_SECONDS = 1_800;
export const SANDBOX_SCAN_TIMEOUT_SECONDS = 1_800;
export const PAIRED_SANDBOX_SCAN_TIMEOUT_SECONDS = 300;
export const SANDBOX_REPORT_DOWNLOAD_TIMEOUT_SECONDS = 1_800;
export const SANDBOX_DELETE_TIMEOUT_SECONDS = 120;
export const SANDBOX_CLEANUP_CONCURRENCY = 50;
export const SANDBOX_CREATE_CONCURRENCY = 20;
export const SANDBOX_REPORT_PATH = "/tmp/react-doctor-report.json";
export const REACT_DOCTOR_EVALUATION_PROVENANCE_PATH =
  "/workspace/react-doctor-evaluation-provenance.json";
export const BASE_REACT_DOCTOR_WORK_DIRECTORY = "/workspace/react-doctor-base";
export const TREATMENT_REACT_DOCTOR_WORK_DIRECTORY = "/workspace/react-doctor-treatment";
export const BASE_REACT_DOCTOR_EVALUATION_PROVENANCE_PATH =
  "/workspace/react-doctor-base-evaluation-provenance.json";
export const TREATMENT_REACT_DOCTOR_EVALUATION_PROVENANCE_PATH =
  "/workspace/react-doctor-treatment-evaluation-provenance.json";
export const TARGET_REPOSITORY_DIRECTORY = "/workspace/target-repository.git";
export const BASE_TARGET_WORK_DIRECTORY = "/workspace/target-base";
export const TREATMENT_TARGET_WORK_DIRECTORY = "/workspace/target-treatment";
export const BASE_SANDBOX_REPORT_PATH = "/tmp/react-doctor-base-report.json";
export const TREATMENT_SANDBOX_REPORT_PATH = "/tmp/react-doctor-treatment-report.json";

export const EVALUATION_SCHEMA_VERSION = 1;
export const REACT_DOCTOR_REPORT_SCHEMA_VERSIONS: ReadonlySet<number> = new Set([1, 2, 3]);
export const REACT_DOCTOR_BASELINE_REPORT_SCHEMA_VERSION = 2;
export const REACT_DOCTOR_COMPLETE_REPORT_SCHEMA_VERSION = 3;
export const REACT_DOCTOR_REPORT_MODES: ReadonlySet<string> = new Set([
  "full",
  "diff",
  "staged",
  "baseline",
]);
export const REACT_DOCTOR_REPORT_FRAMEWORKS: ReadonlySet<string> = new Set([
  "nextjs",
  "astro",
  "vite",
  "cra",
  "remix",
  "gatsby",
  "expo",
  "react-native",
  "tanstack-start",
  "preact",
  "unknown",
]);
export const SUCCESS_EXIT_CODE = 0;
export const FAILURE_EXIT_CODE = 1;
export const PROGRESS_INTERVAL_PROJECTS = 100;
export const MILLISECONDS_PER_SECOND = 1_000;
export const MILLISECONDS_PER_MINUTE = 60_000;
export const PERCENT_MULTIPLIER = 100;
export const SUMMARY_DECIMAL_PLACES = 1;
export const EVALUATION_ARTIFACT_FILE_MODE = 0o600;

export const REACT_DOCTOR_WORK_DIRECTORY = "/workspace/react-doctor";
export const TARGET_WORK_DIRECTORY = "/workspace/target";
export const PREPARE_REACT_DOCTOR_COMMANDS: ReadonlyArray<string> = [
  `mkdir -p ${REACT_DOCTOR_WORK_DIRECTORY}`,
  `git -C ${REACT_DOCTOR_WORK_DIRECTORY} init -q`,
  `git -C ${REACT_DOCTOR_WORK_DIRECTORY} remote add origin "$REACT_DOCTOR_REPOSITORY"`,
  `git -C ${REACT_DOCTOR_WORK_DIRECTORY} fetch -q --depth 1 origin "$REACT_DOCTOR_REF"`,
  `git -C ${REACT_DOCTOR_WORK_DIRECTORY} checkout -q --detach FETCH_HEAD`,
];
const EVALUATION_RULE_CONFIGURATION_SOURCE = `const buildEvaluationRuleConfiguration = ({
  reactCompilerRules,
  reactDoctorRules,
  requestedRuleKeysJson,
}) => {
  const availableRuleKeys = [
    ...reactDoctorRules.map((registryEntry) => registryEntry.key),
    ...Object.keys(reactCompilerRules),
  ].sort();
  const requestedRuleKeys = JSON.parse(requestedRuleKeysJson ?? "[]");
  if (!Array.isArray(requestedRuleKeys) || !requestedRuleKeys.every((ruleKey) => typeof ruleKey === "string")) {
    throw new Error("REACT_DOCTOR_RULE_KEYS must be a JSON array of rule keys");
  }
  const availableRuleKeySet = new Set(availableRuleKeys);
  const requestedRuleKeySet = new Set(requestedRuleKeys);
  const unknownRuleKeys = requestedRuleKeys.filter((ruleKey) => !availableRuleKeySet.has(ruleKey));
  if (unknownRuleKeys.length > 0) {
    throw new Error("Unknown React Doctor eval rules: " + unknownRuleKeys.join(", "));
  }
  const isScopedEvaluation = requestedRuleKeys.length > 0;
  const hasSelectedSecurityScanRule = reactDoctorRules.some(
    (registryEntry) =>
      registryEntry.rule.isScanRule === true && requestedRuleKeySet.has(registryEntry.key),
  );
  const rules = Object.fromEntries(
    availableRuleKeys.map((ruleKey) => [
      ruleKey,
      !isScopedEvaluation || requestedRuleKeySet.has(ruleKey) ? "error" : "off",
    ]),
  );
  const config = {
    adoptExistingLintConfig: false,
    respectInlineDisables: false,
    ...(isScopedEvaluation && !hasSelectedSecurityScanRule
      ? { ignore: { tags: ["security-scan"] } }
      : {}),
    rules,
    warnings: true,
  };
  return { config, requestedRuleKeySet };
};`;
export const MATERIALIZE_REACT_DOCTOR_EVALUATION_PROVENANCE_COMMAND = `node --input-type=module <<'REACT_DOCTOR_EVAL_PROVENANCE'
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { pathToFileURL } from "node:url";

const { REACT_COMPILER_RULES, REACT_DOCTOR_RULES } = await import(
  pathToFileURL(
    process.env.REACT_DOCTOR_WORK_DIRECTORY + "/packages/oxlint-plugin-react-doctor/dist/index.js",
  ).href
);
${EVALUATION_RULE_CONFIGURATION_SOURCE}
const { config, requestedRuleKeySet } = buildEvaluationRuleConfiguration({
  reactCompilerRules: REACT_COMPILER_RULES,
  reactDoctorRules: REACT_DOCTOR_RULES,
  requestedRuleKeysJson: process.env.REACT_DOCTOR_RULE_KEYS,
});
const ruleSetHash = createHash("sha256")
  .update(JSON.stringify({
    configContract: "${EVALUATION_CONFIG_CONTRACT}",
    config,
  }))
  .digest("hex");
const provenance = {
  reactDoctorRepository: process.env.REACT_DOCTOR_REPOSITORY,
  reactDoctorCommit: execFileSync(
    "git",
    ["-C", process.env.REACT_DOCTOR_WORK_DIRECTORY, "rev-parse", "HEAD"],
    { encoding: "utf8" },
  ).trim(),
  configContract: "${EVALUATION_CONFIG_CONTRACT}",
  ruleSetHash,
  ruleKeys: [...requestedRuleKeySet].sort(),
};
fs.writeFileSync(
  process.env.REACT_DOCTOR_EVALUATION_PROVENANCE_PATH,
  JSON.stringify(provenance) + "\\n",
  { mode: 0o600 },
);
REACT_DOCTOR_EVAL_PROVENANCE`;
export const BUILD_REACT_DOCTOR_COMMANDS: ReadonlyArray<string> = [
  "corepack enable",
  "npx --yes --package @antfu/ni ni --frozen",
  "./node_modules/.bin/turbo run build --filter=react-doctor",
  MATERIALIZE_REACT_DOCTOR_EVALUATION_PROVENANCE_COMMAND,
];

export const PREPARE_PAIRED_REACT_DOCTOR_COMMANDS: ReadonlyArray<string> = [
  `mkdir -p "${BASE_REACT_DOCTOR_WORK_DIRECTORY}"`,
  `git -C "${BASE_REACT_DOCTOR_WORK_DIRECTORY}" init -q`,
  `git -C "${BASE_REACT_DOCTOR_WORK_DIRECTORY}" remote add origin "$BASE_REACT_DOCTOR_REPOSITORY"`,
  `git -C "${BASE_REACT_DOCTOR_WORK_DIRECTORY}" fetch -q --depth 1 origin "$BASE_REACT_DOCTOR_REF"`,
  `git -C "${BASE_REACT_DOCTOR_WORK_DIRECTORY}" checkout -q --detach FETCH_HEAD`,
  `mkdir -p "${TREATMENT_REACT_DOCTOR_WORK_DIRECTORY}"`,
  `git -C "${TREATMENT_REACT_DOCTOR_WORK_DIRECTORY}" init -q`,
  `git -C "${TREATMENT_REACT_DOCTOR_WORK_DIRECTORY}" remote add origin "$TREATMENT_REACT_DOCTOR_REPOSITORY"`,
  `git -C "${TREATMENT_REACT_DOCTOR_WORK_DIRECTORY}" fetch -q --depth 1 origin "$TREATMENT_REACT_DOCTOR_REF"`,
  `git -C "${TREATMENT_REACT_DOCTOR_WORK_DIRECTORY}" checkout -q --detach FETCH_HEAD`,
];

export const BUILD_PAIRED_REACT_DOCTOR_COMMANDS: ReadonlyArray<string> = [
  "corepack enable",
  `cd "${BASE_REACT_DOCTOR_WORK_DIRECTORY}" && npx --yes --package @antfu/ni ni --frozen`,
  `cd "${BASE_REACT_DOCTOR_WORK_DIRECTORY}" && ./node_modules/.bin/turbo run build --filter=react-doctor`,
  `cd "${TREATMENT_REACT_DOCTOR_WORK_DIRECTORY}" && npx --yes --package @antfu/ni ni --frozen`,
  `cd "${TREATMENT_REACT_DOCTOR_WORK_DIRECTORY}" && ./node_modules/.bin/turbo run build --filter=react-doctor`,
  `REACT_DOCTOR_WORK_DIRECTORY="${BASE_REACT_DOCTOR_WORK_DIRECTORY}" REACT_DOCTOR_REPOSITORY="$BASE_REACT_DOCTOR_REPOSITORY" REACT_DOCTOR_RULE_KEYS="$BASE_REACT_DOCTOR_RULE_KEYS" REACT_DOCTOR_EVALUATION_PROVENANCE_PATH="${BASE_REACT_DOCTOR_EVALUATION_PROVENANCE_PATH}" ${MATERIALIZE_REACT_DOCTOR_EVALUATION_PROVENANCE_COMMAND}`,
  `REACT_DOCTOR_WORK_DIRECTORY="${TREATMENT_REACT_DOCTOR_WORK_DIRECTORY}" REACT_DOCTOR_REPOSITORY="$TREATMENT_REACT_DOCTOR_REPOSITORY" REACT_DOCTOR_RULE_KEYS="$TREATMENT_REACT_DOCTOR_RULE_KEYS" REACT_DOCTOR_EVALUATION_PROVENANCE_PATH="${TREATMENT_REACT_DOCTOR_EVALUATION_PROVENANCE_PATH}" ${MATERIALIZE_REACT_DOCTOR_EVALUATION_PROVENANCE_COMMAND}`,
];

export const SETUP_TARGET_REPOSITORY_COMMAND = `set -eu
rm -rf "${TARGET_WORK_DIRECTORY}"
mkdir -p "${TARGET_WORK_DIRECTORY}"
git -C "${TARGET_WORK_DIRECTORY}" init -q
git -C "${TARGET_WORK_DIRECTORY}" remote add origin "$TARGET_REPOSITORY"
git -C "${TARGET_WORK_DIRECTORY}" fetch -q --depth 1 origin "$TARGET_REF"
git -C "${TARGET_WORK_DIRECTORY}" checkout -q --detach FETCH_HEAD`;

export const RESOLVE_TARGET_REPOSITORY_REF_COMMAND = `git -C "${TARGET_WORK_DIRECTORY}" rev-parse HEAD`;

export const SETUP_PAIRED_TARGET_REPOSITORY_COMMAND = `set -eu
rm -rf "${TARGET_REPOSITORY_DIRECTORY}" "${BASE_TARGET_WORK_DIRECTORY}" "${TREATMENT_TARGET_WORK_DIRECTORY}"
git init -q --bare "${TARGET_REPOSITORY_DIRECTORY}"
git -C "${TARGET_REPOSITORY_DIRECTORY}" remote add origin "$TARGET_REPOSITORY"
git -C "${TARGET_REPOSITORY_DIRECTORY}" fetch -q --depth 1 origin "$TARGET_REF"
resolved_ref=$(git -C "${TARGET_REPOSITORY_DIRECTORY}" rev-parse FETCH_HEAD)
git -C "${TARGET_REPOSITORY_DIRECTORY}" worktree add -q --detach "${BASE_TARGET_WORK_DIRECTORY}" "$resolved_ref"
git -C "${TARGET_REPOSITORY_DIRECTORY}" worktree add -q --detach "${TREATMENT_TARGET_WORK_DIRECTORY}" "$resolved_ref"`;

export const RESOLVE_PAIRED_TARGET_REPOSITORY_REF_COMMAND = `git -C "${TARGET_REPOSITORY_DIRECTORY}" rev-parse FETCH_HEAD`;

export const SETUP_MATRIX_TARGET_REPOSITORY_COMMAND = `set -eu
rm -rf "${MATRIX_TARGET_REPOSITORY_DIRECTORY}" "${MATRIX_TARGET_WORKTREE_DIRECTORY}" "${MATRIX_REPORT_DIRECTORY}"
mkdir -p "${MATRIX_TARGET_WORKTREE_DIRECTORY}" "${MATRIX_REPORT_DIRECTORY}"
git init -q --bare "${MATRIX_TARGET_REPOSITORY_DIRECTORY}"
git -C "${MATRIX_TARGET_REPOSITORY_DIRECTORY}" remote add origin "$TARGET_REPOSITORY"
git -C "${MATRIX_TARGET_REPOSITORY_DIRECTORY}" fetch -q --depth 1 origin "$TARGET_REF"
resolved_ref=$(git -C "${MATRIX_TARGET_REPOSITORY_DIRECTORY}" rev-parse FETCH_HEAD)
node --input-type=module -e 'for (const laneId of JSON.parse(process.env.MATRIX_ACTIVE_LANE_IDS)) process.stdout.write(laneId + "\\n")' | while IFS= read -r lane_id; do
  git -C "${MATRIX_TARGET_REPOSITORY_DIRECTORY}" worktree add -q --detach "${MATRIX_TARGET_WORKTREE_DIRECTORY}/$lane_id" "$resolved_ref"
done`;

export const RESOLVE_MATRIX_TARGET_REPOSITORY_REF_COMMAND = `git -C "${MATRIX_TARGET_REPOSITORY_DIRECTORY}" rev-parse FETCH_HEAD`;

export const MATERIALIZE_ALL_RULES_CONFIG_COMMAND = `node --input-type=module <<'REACT_DOCTOR_EVAL_CONFIG'
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const { REACT_COMPILER_RULES, REACT_DOCTOR_RULES } = await import(
  pathToFileURL(
    process.env.REACT_DOCTOR_WORK_DIRECTORY + "/packages/oxlint-plugin-react-doctor/dist/index.js",
  ).href
);

${EVALUATION_RULE_CONFIGURATION_SOURCE}
const { config } = buildEvaluationRuleConfiguration({
  reactCompilerRules: REACT_COMPILER_RULES,
  reactDoctorRules: REACT_DOCTOR_RULES,
  requestedRuleKeysJson: process.env.REACT_DOCTOR_RULE_KEYS,
});
const configContents = "export default " + JSON.stringify(config) + ";\\n";
const CONFIG_FILE_MODE = 0o600;
const targetCheckoutDirectory = fs.realpathSync(process.env.TARGET_CHECKOUT_DIRECTORY);
const targetRootDirectory = path.join(
  targetCheckoutDirectory,
  process.env.TARGET_ROOT_DIRECTORY ?? ".",
);
const targetRootStats = fs.lstatSync(targetRootDirectory);
const resolvedTargetRootDirectory = fs.realpathSync(targetRootDirectory);
const targetRootRelativePath = path.relative(
  targetCheckoutDirectory,
  resolvedTargetRootDirectory,
);
if (
  !targetRootStats.isDirectory() ||
  targetRootRelativePath === ".." ||
  targetRootRelativePath.startsWith(".." + path.sep) ||
  path.isAbsolute(targetRootRelativePath)
) {
  throw new Error("Target root must be a real directory inside the target checkout");
}
const pendingDirectories = [resolvedTargetRootDirectory];
const configuredDirectories = new Set([resolvedTargetRootDirectory]);

while (pendingDirectories.length > 0) {
  const currentDirectory = pendingDirectories.pop();
  for (const entry of fs.readdirSync(currentDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === ".git" || entry.name === "node_modules") continue;
    const childDirectory = path.join(currentDirectory, entry.name);
    pendingDirectories.push(childDirectory);
    if (fs.existsSync(path.join(childDirectory, "package.json"))) {
      configuredDirectories.add(childDirectory);
    }
  }
}

for (const configuredDirectory of configuredDirectories) {
  const resolvedConfiguredDirectory = fs.realpathSync(configuredDirectory);
  const configuredDirectoryRelativePath = path.relative(
    resolvedTargetRootDirectory,
    resolvedConfiguredDirectory,
  );
  if (
    configuredDirectoryRelativePath === ".." ||
    configuredDirectoryRelativePath.startsWith(".." + path.sep) ||
    path.isAbsolute(configuredDirectoryRelativePath)
  ) {
    throw new Error("Config directory escaped the target root");
  }
  const configPath = path.join(resolvedConfiguredDirectory, "doctor.config.ts");
  const temporaryConfigPath = path.join(
    resolvedConfiguredDirectory,
    ".doctor.config.ts." + process.pid + "." + randomUUID(),
  );
  try {
    fs.writeFileSync(temporaryConfigPath, configContents, { flag: "wx", mode: CONFIG_FILE_MODE });
    fs.renameSync(temporaryConfigPath, configPath);
  } finally {
    fs.rmSync(temporaryConfigPath, { force: true });
  }
}
REACT_DOCTOR_EVAL_CONFIG`;

export const SCAN_COMMAND = `set -eu
: "\${REACT_DOCTOR_WORK_DIRECTORY:?}"
: "\${REACT_DOCTOR_RULE_KEYS:?}"
: "\${TARGET_CHECKOUT_DIRECTORY:?}"
: "\${TARGET_ROOT_DIRECTORY:?}"
: "\${SANDBOX_REPORT_PATH:?}"
${MATERIALIZE_ALL_RULES_CONFIG_COMMAND}
node "$REACT_DOCTOR_WORK_DIRECTORY/packages/react-doctor/bin/react-doctor.js" \
  --json \
  --blocking none \
  --diff false \
  --no-dead-code \
  --no-supply-chain \
  --no-telemetry \
  --no-score \
  "$TARGET_CHECKOUT_DIRECTORY/$TARGET_ROOT_DIRECTORY" \
  > "$SANDBOX_REPORT_PATH"`;
