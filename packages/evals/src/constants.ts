export const DEFAULT_REACT_DOCTOR_REPOSITORY = "https://github.com/millionco/react-doctor.git";
export const DEFAULT_REACT_DOCTOR_REF = "main";
export const DEFAULT_REPOSITORIES_SOURCES: ReadonlyArray<string> = ["./repositories.json"];
export const DEFAULT_TARGET_REPOSITORY_REF = "HEAD";
export const DEFAULT_TARGET_ROOT_DIRECTORY = ".";
export const REPOSITORY_SOURCE_EXTENSIONS: ReadonlyArray<string> = [".json", ".ndjson", ".txt"];
export const PINNED_REPOSITORY_REF_PATTERN = /^[0-9a-f]{40}$/i;
export const DEFAULT_CORPUS_REPOSITORY_COUNT = 2_000;
export const DEFAULT_CORPUS_CONCURRENCY = 200;
export const DEFAULT_REPOSITORIES_PER_SANDBOX = 10;
export const DEFAULT_PROJECT_ROOTS_PER_REPOSITORY = 1;
export const DEFAULT_EVALUATION_MAX_DURATION_MINUTES = 30;
export const EVALUATION_CLEANUP_RESERVE_MINUTES = 2;
export const EVALUATION_RETRY_CONCURRENCIES: ReadonlyArray<number> = [50, 10];
export const EVALUATION_RETRY_ATTEMPT_RESERVE_MINUTES = 5;
export const EVALUATION_RETRY_REPOSITORIES_PER_SANDBOX = 1;

export const SANDBOX_IMAGE = "node:22-bookworm";
export const SANDBOX_CPU_CORES = 2;
export const SANDBOX_MEMORY_GIB = 4;
export const SANDBOX_DISK_GIB = 10;
export const SANDBOX_AUTO_STOP_INTERVAL_MINUTES = 60;
export const SANDBOX_CREATE_TIMEOUT_SECONDS = 600;
export const SANDBOX_SETUP_TIMEOUT_SECONDS = 1_800;
export const SANDBOX_SCAN_TIMEOUT_SECONDS = 1_800;
export const SANDBOX_DELETE_TIMEOUT_SECONDS = 120;
export const SANDBOX_CLEANUP_CONCURRENCY = 50;
export const SANDBOX_CREATE_CONCURRENCY = 20;

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

export const REACT_DOCTOR_WORK_DIRECTORY = "/workspace/react-doctor";
export const PREPARE_REACT_DOCTOR_COMMANDS: ReadonlyArray<string> = [
  `mkdir -p ${REACT_DOCTOR_WORK_DIRECTORY}`,
  `git -C ${REACT_DOCTOR_WORK_DIRECTORY} init -q`,
  `git -C ${REACT_DOCTOR_WORK_DIRECTORY} remote add origin "$REACT_DOCTOR_REPOSITORY"`,
  `git -C ${REACT_DOCTOR_WORK_DIRECTORY} fetch -q --depth 1 origin "$REACT_DOCTOR_REF"`,
  `git -C ${REACT_DOCTOR_WORK_DIRECTORY} checkout -q --detach FETCH_HEAD`,
];
export const BUILD_REACT_DOCTOR_COMMANDS: ReadonlyArray<string> = [
  "corepack enable",
  "npx --yes --package @antfu/ni ni --frozen",
  "./node_modules/.bin/turbo run build --filter=react-doctor",
];

export const SETUP_TARGET_REPOSITORY_COMMAND = `set -eu
rm -rf /workspace/target
mkdir -p /workspace/target
git -C /workspace/target init -q
git -C /workspace/target remote add origin "$TARGET_REPOSITORY"
git -C /workspace/target fetch -q --depth 1 origin "$TARGET_REF"
git -C /workspace/target checkout -q --detach FETCH_HEAD`;

export const RESOLVE_TARGET_REPOSITORY_REF_COMMAND = "git -C /workspace/target rev-parse HEAD";

export const MATERIALIZE_ALL_RULES_CONFIG_COMMAND = `node --input-type=module <<'REACT_DOCTOR_EVAL_CONFIG'
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const { REACT_COMPILER_RULES, REACT_DOCTOR_RULES } = await import(
  pathToFileURL(
    "/workspace/react-doctor/packages/oxlint-plugin-react-doctor/dist/index.js",
  ).href
);

const ruleKeys = [
  ...REACT_DOCTOR_RULES.map((registryEntry) => registryEntry.key),
  ...Object.keys(REACT_COMPILER_RULES),
];
const rules = Object.fromEntries(ruleKeys.map((ruleKey) => [ruleKey, "error"]));
const config = {
  adoptExistingLintConfig: false,
  respectInlineDisables: false,
  rules,
  warnings: true,
};
const configContents = "export default " + JSON.stringify(config) + ";\\n";
const CONFIG_FILE_MODE = 0o600;
const targetCheckoutDirectory = fs.realpathSync("/workspace/target");
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
${MATERIALIZE_ALL_RULES_CONFIG_COMMAND}
node /workspace/react-doctor/packages/react-doctor/bin/react-doctor.js \
  --json \
  --blocking none \
  --diff false \
  --no-dead-code \
  --no-supply-chain \
  --no-telemetry \
  --no-score \
  "/workspace/target/$TARGET_ROOT_DIRECTORY"`;
