import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ALLOWED_PATH_PREFIXES = [
  ".changeset/",
  "packages/core/",
  "packages/fuzz/",
  "packages/oxlint-plugin-react-doctor/",
];
const REQUIRED_EVIDENCE_KEYS = [
  "focusedTests",
  "auditReplay",
  "coverageLedger",
  "strictFuzz",
  "fullFuzz",
  "repositoryChecks",
  "daytonaParity",
];

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

const run = (command, argumentsList) =>
  execFileSync(command, argumentsList, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const [rule, cohort, evidencePath, parityPath] = process.argv.slice(2);
if (![rule, cohort, evidencePath, parityPath].every((value) => value?.length > 0)) {
  fail("Usage: complete.mjs <rule> <cohort> <evidence.json> <parity.json>");
}

const branch = run("git", ["branch", "--show-current"]);
const head = run("git", ["rev-parse", "HEAD"]);
const status = run("git", ["status", "--porcelain=v1"]);
if (!branch.startsWith("loop/")) fail("The current branch must start with loop/.");
if (status.length > 0) fail("Commit the validated cohort before marking it complete.");

const changedFiles = run("git", ["diff", "--name-only", "origin/main...HEAD"])
  .split("\n")
  .filter(Boolean);
const disallowedFile = changedFiles.find(
  (filePath) => !ALLOWED_PATH_PREFIXES.some((prefix) => filePath.startsWith(prefix)),
);
if (disallowedFile !== undefined) fail(`Disallowed changed file: ${disallowedFile}`);
if (!changedFiles.some((filePath) => /(?:\.test|\.regressions\.test)\.tsx?$/.test(filePath))) {
  fail("The cohort needs a regression test.");
}
if (!changedFiles.some((filePath) => filePath.startsWith("packages/fuzz/corpus/"))) {
  fail("The cohort needs a deduplicated fuzz fixture.");
}
if (
  !changedFiles.some((filePath) => filePath.startsWith(".changeset/") && filePath.endsWith(".md"))
) {
  fail("The cohort needs a patch changeset.");
}

const evidence = JSON.parse(await readFile(path.resolve(evidencePath), "utf8"));
if (evidence.rule !== rule || evidence.cohort !== cohort) fail("Evidence identity does not match.");
for (const key of REQUIRED_EVIDENCE_KEYS) {
  const expectedExitCode = key === "daytonaParity" ? 1 : 0;
  if (evidence[key]?.exitCode !== expectedExitCode || typeof evidence[key]?.command !== "string") {
    fail(`Evidence step ${key} is missing or failed.`);
  }
}
if (
  !Array.isArray(evidence.coverageLedger.memberships) ||
  evidence.coverageLedger.memberships.length === 0
) {
  fail("The coverage ledger must list every cohort membership.");
}
if (
  (evidence.coverageLedger.missing?.length ?? 0) > 0 ||
  (evidence.coverageLedger.extra?.length ?? 0) > 0
) {
  fail("The coverage ledger has missing or extra memberships.");
}

const parity = JSON.parse(await readFile(path.resolve(parityPath), "utf8"));
if (
  !Array.isArray(parity.added) ||
  !Array.isArray(parity.removed) ||
  !Array.isArray(parity.skippedProjects)
) {
  fail("Invalid Daytona parity report.");
}
if (parity.skippedProjects.length > 0) fail("Daytona parity excluded failed projects.");
const { added, removed } = parity;
if (added.length > 0) fail("RDE parity introduced diagnostics.");
if (removed.length === 0) fail("RDE parity did not reproduce the intended removal.");
const unrelatedRemoval = removed.find(
  (entry) => entry.diagnostic?.rule !== rule && !entry.diagnostic?.rule?.endsWith(`/${rule}`),
);
if (unrelatedRemoval !== undefined)
  fail(`Daytona parity changed unrelated rule ${unrelatedRemoval.diagnostic?.rule}.`);

const pullRequest = JSON.parse(
  run("gh", ["pr", "view", "--json", "headRefOid,isDraft,state,title,url"]),
);
if (pullRequest.state !== "OPEN" || pullRequest.isDraft !== true)
  fail("The pull request must be an open draft.");
if (!pullRequest.title.startsWith("[loop]")) fail("The pull request title must start with [loop].");
if (pullRequest.headRefOid !== head) fail("The draft pull request is not at the validated commit.");

const completion = {
  branch,
  cohort,
  completedAt: new Date().toISOString(),
  evidence,
  head,
  pullRequestUrl: pullRequest.url,
  rule,
};
const completionPath = path.join(process.cwd(), ".react-doctor-loop", "completed.json");
await mkdir(path.dirname(completionPath), { recursive: true });
await writeFile(completionPath, `${JSON.stringify(completion, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${pullRequest.url}\n`);
