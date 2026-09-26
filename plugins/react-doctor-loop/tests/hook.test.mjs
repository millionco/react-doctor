import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const HOOK_PATH = path.resolve(import.meta.dirname, "../scripts/hook.mjs");

const runHook = (pluginData, input) =>
  spawnSync("node", [HOOK_PATH], {
    encoding: "utf8",
    env: { ...process.env, PLUGIN_DATA: pluginData },
    input: JSON.stringify(input),
  });

test("activates only for the loop skill and blocks merge", () => {
  const pluginData = mkdtempSync(path.join(os.tmpdir(), "react-doctor-loop-hook-"));
  const sessionId = "session-1";
  const activation = runHook(pluginData, {
    hook_event_name: "UserPromptSubmit",
    prompt: "Use $react-doctor-loop for the next cohort",
    session_id: sessionId,
  });
  assert.equal(activation.status, 0);
  assert.match(activation.stdout, /React Doctor Loop is active/);

  const blocked = runHook(pluginData, {
    hook_event_name: "PreToolUse",
    session_id: sessionId,
    tool_input: { command: "gh pr merge 123" },
    tool_name: "Bash",
  });
  const output = JSON.parse(blocked.stdout);
  assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
});

test("does not affect unrelated Codex sessions", () => {
  const pluginData = mkdtempSync(path.join(os.tmpdir(), "react-doctor-loop-hook-"));
  const result = runHook(pluginData, {
    hook_event_name: "PreToolUse",
    session_id: "unrelated",
    tool_input: { command: "gh pr merge 123" },
    tool_name: "Bash",
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
});

test("requires draft pull requests through non-shell tools", () => {
  const pluginData = mkdtempSync(path.join(os.tmpdir(), "react-doctor-loop-hook-"));
  const sessionId = "session-pr";
  runHook(pluginData, {
    hook_event_name: "UserPromptSubmit",
    prompt: "Start the React Doctor Loop",
    session_id: sessionId,
  });
  const result = runHook(pluginData, {
    hook_event_name: "PreToolUse",
    session_id: sessionId,
    tool_input: { draft: false, title: "fix: unsafe" },
    tool_name: "mcp__github__create_pull_request",
  });
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, "deny");
});

test("requires the bounded Daytona wrapper", () => {
  const pluginData = mkdtempSync(path.join(os.tmpdir(), "react-doctor-loop-hook-"));
  const sessionId = "session-daytona";
  runHook(pluginData, {
    hook_event_name: "UserPromptSubmit",
    prompt: "Start the React Doctor Loop",
    session_id: sessionId,
  });
  const result = runHook(pluginData, {
    hook_event_name: "PreToolUse",
    session_id: sessionId,
    tool_input: { command: "cd packages/evals && nr --silent eval --react-doctor-ref abc" },
    tool_name: "Bash",
  });
  assert.match(JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason, /bounded/);
});

test("continues an active loop without a completion receipt", () => {
  const pluginData = mkdtempSync(path.join(os.tmpdir(), "react-doctor-loop-hook-"));
  const repository = mkdtempSync(path.join(os.tmpdir(), "react-doctor-loop-repo-"));
  mkdirSync(path.join(repository, ".react-doctor-loop"));
  execFileSync("git", ["init", "-b", "loop/example"], { cwd: repository });
  execFileSync("git", ["config", "user.email", "loop@example.com"], { cwd: repository });
  execFileSync("git", ["config", "user.name", "Loop Test"], { cwd: repository });
  writeFileSync(path.join(repository, "fixture.txt"), "fixture\n");
  writeFileSync(path.join(repository, ".gitignore"), ".react-doctor-loop/\n");
  execFileSync("git", ["add", "fixture.txt", ".gitignore"], { cwd: repository });
  execFileSync("git", ["commit", "-m", "test: initialize"], { cwd: repository });

  runHook(pluginData, {
    hook_event_name: "UserPromptSubmit",
    prompt: "Start the React Doctor Loop",
    session_id: "session-2",
  });
  const result = runHook(pluginData, {
    cwd: repository,
    hook_event_name: "Stop",
    last_assistant_message: "Finished",
    session_id: "session-2",
  });
  assert.equal(result.status, 0);
  assert.match(JSON.parse(result.stdout).reason, /not complete/);
});

test("complete command fails closed without arguments", () => {
  const completePath = path.resolve(import.meta.dirname, "../scripts/complete.mjs");
  const result = spawnSync("node", [completePath], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage:/);
});

test("complete command verifies evidence, parity, and a draft pull request", () => {
  const repository = mkdtempSync(path.join(os.tmpdir(), "react-doctor-loop-complete-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: repository });
  execFileSync("git", ["config", "user.email", "loop@example.com"], { cwd: repository });
  execFileSync("git", ["config", "user.name", "Loop Test"], { cwd: repository });
  writeFileSync(path.join(repository, "fixture.txt"), "fixture\n");
  writeFileSync(path.join(repository, ".gitignore"), ".react-doctor-loop/\nbin/\n");
  execFileSync("git", ["add", "fixture.txt", ".gitignore"], { cwd: repository });
  execFileSync("git", ["commit", "-m", "test: initialize"], { cwd: repository });
  execFileSync("git", ["update-ref", "refs/remotes/origin/main", "HEAD"], { cwd: repository });
  execFileSync("git", ["switch", "-c", "loop/test-rule-cohort"], { cwd: repository });
  const changedFiles = [
    ".changeset/test.md",
    "packages/fuzz/corpus/regressions/test-rule--cohort.tsx",
    "packages/oxlint-plugin-react-doctor/tests/test-rule.test.ts",
  ];
  for (const filePath of changedFiles) {
    mkdirSync(path.dirname(path.join(repository, filePath)), { recursive: true });
    writeFileSync(path.join(repository, filePath), "fixture\n");
  }
  execFileSync("git", ["add", ...changedFiles], { cwd: repository });
  execFileSync("git", ["commit", "-m", "fix: test cohort"], { cwd: repository });
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repository,
    encoding: "utf8",
  }).trim();
  const evidenceStep = { command: "test", exitCode: 0 };
  const evidence = {
    auditReplay: evidenceStep,
    cohort: "cohort",
    coverageLedger: {
      ...evidenceStep,
      extra: [],
      memberships: ["trial"],
      missing: [],
    },
    daytonaParity: { command: "compare", exitCode: 1 },
    focusedTests: evidenceStep,
    fullFuzz: evidenceStep,
    repositoryChecks: evidenceStep,
    rule: "test-rule",
    strictFuzz: evidenceStep,
  };
  const evidenceDirectory = path.join(repository, ".react-doctor-loop");
  mkdirSync(evidenceDirectory);
  const evidencePath = path.join(evidenceDirectory, "evidence.json");
  const parityPath = path.join(evidenceDirectory, "parity.json");
  writeFileSync(evidencePath, JSON.stringify(evidence));
  writeFileSync(
    parityPath,
    JSON.stringify({
      added: [],
      removed: [{ diagnostic: { rule: "test-rule" } }],
      skippedProjects: [],
    }),
  );
  const binaryDirectory = path.join(repository, "bin");
  mkdirSync(binaryDirectory);
  const ghPath = path.join(binaryDirectory, "gh");
  writeFileSync(
    ghPath,
    `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify({ headRefOid: head, isDraft: true, state: "OPEN", title: "[loop] fix", url: "https://example.com/pr" })}'\n`,
  );
  chmodSync(ghPath, 0o700);
  const completePath = path.resolve(import.meta.dirname, "../scripts/complete.mjs");
  const result = spawnSync(
    "node",
    [completePath, "test-rule", "cohort", evidencePath, parityPath],
    {
      cwd: repository,
      encoding: "utf8",
      env: { ...process.env, PATH: `${binaryDirectory}:${process.env.PATH}` },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const completion = JSON.parse(
    readFileSync(path.join(repository, ".react-doctor-loop", "completed.json"), "utf8"),
  );
  assert.equal(completion.head, head);
  assert.equal(completion.pullRequestUrl, "https://example.com/pr");
});

test("Daytona wrapper fails before reading credentials when over budget", () => {
  const daytonaPath = path.resolve(import.meta.dirname, "../scripts/run-daytona-eval.mjs");
  const result = spawnSync(
    "node",
    [daytonaPath, "--repository-limit", "2001", "--react-doctor-ref", "a".repeat(40)],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /exceeds 2,000/);
});

test("Daytona wrapper requires an exact detector commit", () => {
  const daytonaPath = path.resolve(import.meta.dirname, "../scripts/run-daytona-eval.mjs");
  const result = spawnSync("node", [daytonaPath, "--react-doctor-ref", "main"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /exact 40-character commit/);
});
