import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const LOOP_PROMPT_PATTERN = /\$react-doctor-loop\b|\breact doctor loop\b/i;
const UNSAFE_COMMAND_PATTERNS = [
  /\bgh\s+pr\s+(?:merge|ready)\b/i,
  /\bgh\s+release\b/i,
  /\bgit\s+tag\b/i,
  /\bgit\s+push\b[^\n]*(?:--force|-f\b)/i,
  /\bgit\s+push\b[^\n]*\b(?:main|master)\b/i,
  /\b(?:npm|pnpm|yarn|bun)\s+publish\b/i,
  /\bchangeset\s+publish\b/i,
  /\bcodex\s+(?:login|logout)\b/i,
  /\bOPENAI_API_KEY\b/,
  /(?:cat|sed|awk|rg|grep|head|tail|less|more)[^\n]*\.env\.local/i,
];
const PROTECTED_EDIT_PATTERNS = [
  /(?:^|\/)\.env\.local$/,
  /(?:^|\/)auth\.json$/,
  /(?:^|\/)config\.toml$/,
  /(?:^|\/)plugins\/react-doctor-loop\//,
  /(?:^|\/)\.codex\//,
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

const readInput = async () => {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return JSON.parse(input);
};

const sessionPath = (sessionId) => {
  const safeSessionId = sessionId.replaceAll(/[^a-zA-Z0-9_-]/g, "-");
  return path.join(process.env.PLUGIN_DATA, "sessions", `${safeSessionId}.json`);
};

const readSession = async (sessionId) => {
  try {
    return JSON.parse(await readFile(sessionPath(sessionId), "utf8"));
  } catch {
    return { active: false, completedPullRequests: 0 };
  }
};

const writeSession = async (sessionId, session) => {
  const filePath = sessionPath(sessionId);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
};

const outputContext = (eventName, additionalContext) =>
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: eventName, additionalContext },
    }),
  );

const deny = (reason) =>
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );

const runGit = (cwd, argumentsList) =>
  execFileSync("git", argumentsList, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();

const handlePrompt = async (input, session) => {
  if (!LOOP_PROMPT_PATTERN.test(input.prompt)) return;
  await writeSession(input.session_id, {
    ...session,
    active: true,
    startedAt: session.startedAt ?? new Date().toISOString(),
  });
  outputContext(
    "UserPromptSubmit",
    "React Doctor Loop is active. Use only ChatGPT/Codex plan inference. The hooks block merge, release, account, secret-reading, and unsafe push operations.",
  );
};

const handleSessionStart = (session) => {
  if (!session.active) return;
  outputContext(
    "SessionStart",
    "Resume the active React Doctor Loop. Work on one confirmed semantic cohort, preserve exact benchmark evidence, open only a [loop] draft PR, and never merge or publish.",
  );
};

const commandFromToolInput = (toolInput) =>
  typeof toolInput?.command === "string" ? toolInput.command : JSON.stringify(toolInput);

const editedPaths = (command) =>
  [...command.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((match) => match[1]);

const handlePreToolUse = (input, session) => {
  if (!session.active) return;
  const command = commandFromToolInput(input.tool_input);
  if (/\.env\.local|DAYTONA_API_KEY/.test(command)) {
    deny("React Doctor Loop cannot read, print, or forward local secrets.");
    return;
  }
  if (/merge_pull_request|publish|create_release/i.test(input.tool_name)) {
    deny(`React Doctor Loop blocks ${input.tool_name}. Draft PRs require maintainer approval.`);
    return;
  }
  if (
    /(?:\bnr\s+(?:--silent\s+)?eval\b|packages\/evals)/i.test(command) &&
    !/run-daytona-eval\.mjs/.test(command)
  ) {
    deny("Run Daytona only through the bounded run-daytona-eval.mjs wrapper.");
    return;
  }
  if (
    /create_pull_request/i.test(input.tool_name) &&
    (input.tool_input?.draft !== true || !input.tool_input?.title?.startsWith("[loop]"))
  ) {
    deny("React Doctor Loop PRs must be drafts and their title must start with [loop].");
    return;
  }
  const unsafePattern = UNSAFE_COMMAND_PATTERNS.find((pattern) => pattern.test(command));
  if (unsafePattern !== undefined) {
    deny(
      "React Doctor Loop blocks merge, release, account, secret-reading, force-push, and main-push operations.",
    );
    return;
  }
  if (
    /\bgh\s+pr\s+create\b/i.test(command) &&
    (!/--draft\b/.test(command) || !/\[loop\]/.test(command))
  ) {
    deny("React Doctor Loop PRs must be drafts and their title must start with [loop].");
    return;
  }
  const protectedPath = editedPaths(command).find((filePath) =>
    PROTECTED_EDIT_PATTERNS.some((pattern) => pattern.test(filePath)),
  );
  if (protectedPath !== undefined) deny(`React Doctor Loop cannot edit ${protectedPath}.`);
};

const readCompletion = async (cwd) => {
  try {
    return JSON.parse(
      await readFile(path.join(cwd, ".react-doctor-loop", "completed.json"), "utf8"),
    );
  } catch {
    return undefined;
  }
};

const continueLoop = (reason) =>
  process.stdout.write(JSON.stringify({ decision: "block", reason }));

const handleStop = async (input, session) => {
  if (!session.active) return;
  if (/rate limit|usage limit|quota|plan limit/i.test(input.last_assistant_message ?? "")) return;
  let branch;
  let head;
  let status;
  try {
    branch = runGit(input.cwd, ["branch", "--show-current"]);
    head = runGit(input.cwd, ["rev-parse", "HEAD"]);
    status = runGit(input.cwd, ["status", "--porcelain=v1"]);
  } catch {
    continueLoop(
      "Continue from the React Doctor repository and restore the loop worktree before stopping.",
    );
    return;
  }
  if (!branch.startsWith("loop/")) {
    continueLoop(
      "Fetch origin/main and create the next fresh loop/<rule>-<cohort> branch before continuing.",
    );
    return;
  }
  if (status.length > 0) {
    continueLoop(
      "The loop branch is dirty. Finish the cohort, validate it, commit it, and open a [loop] draft PR.",
    );
    return;
  }
  const completion = await readCompletion(input.cwd);
  const evidencePassed = REQUIRED_EVIDENCE_KEYS.every((key) =>
    key === "daytonaParity"
      ? completion?.evidence?.[key]?.exitCode === 1
      : completion?.evidence?.[key]?.exitCode === 0,
  );
  if (completion?.head !== head || completion?.branch !== branch || !evidencePassed) {
    continueLoop(
      "The cohort is not complete. Finish exact replay, coverage ledger, focused tests, strict and full fuzz, repository checks, exact-parent RDE parity, and a [loop] draft PR; then run the plugin complete.mjs command.",
    );
    return;
  }
  await writeSession(input.session_id, {
    ...session,
    completedPullRequests: session.completedPullRequests + 1,
    lastCompletedHead: head,
    lastCompletedAt: new Date().toISOString(),
  });
  continueLoop(
    `Draft PR ${completion.pullRequestUrl} is complete and remains unmerged. Return to origin/main and start the next confirmed root-cause cohort.`,
  );
};

const input = await readInput();
const session = await readSession(input.session_id);

if (input.hook_event_name === "UserPromptSubmit") await handlePrompt(input, session);
if (input.hook_event_name === "SessionStart") handleSessionStart(session);
if (input.hook_event_name === "PreToolUse") handlePreToolUse(input, session);
if (input.hook_event_name === "Stop") await handleStop(input, session);
