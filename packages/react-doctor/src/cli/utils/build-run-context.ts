import { resolveLintBatchOrdering } from "@react-doctor/core";
import { detectTerminalKind } from "./detect-terminal-kind.js";
import {
  detectCiEventName,
  detectCiProvider,
  detectCodingAgent,
  isCiEnvironment,
  isCodingAgentEnvironment,
  isOfficialGithubAction,
} from "./is-ci-environment.js";
import { isDebugFlagEnabled } from "./is-debug-flag.js";
import { isGitHookEnvironment } from "./is-git-hook-environment.js";
import { isNonInteractiveEnvironment } from "./is-non-interactive-environment.js";
import { isJsonModeActive } from "./json-mode.js";
import { getRunId } from "./run-id.js";
import { scrubSensitivePaths } from "./scrub-sensitive-text.js";
import { VERSION } from "./version.js";

export interface RunContext {
  version: string;
  // Random per-run (per-process) id, carried on events/spans (via
  // `contexts.run`) only — never a tag.
  runId: string;
  origin: string;
  command: string;
  argv: string;
  cwd: string;
  node: string;
  nodeMajor: number;
  platform: string;
  arch: string;
  ci: boolean;
  ciProvider: string | null;
  // GitHub Actions triggering event (e.g. `pull_request`), null off GitHub.
  eventName: string | null;
  // Launched by the official react-doctor GitHub Action.
  viaAction: boolean;
  codingAgent: string | null;
  interactive: boolean;
  // Terminal emulator / editor hosting the run (nvim, vscode, iterm, …), or
  // "ci"/"unknown". Reveals where the CLI is actually used.
  terminalKind: string;
  jsonMode: boolean;
  // User passed `--debug` (forces a Sentry trace and prints its id). Tracks
  // adoption of the diagnostic flag.
  debug: boolean;
  // Package-manager / runner the CLI was launched through (npm, pnpm, yarn,
  // bun, or "unknown"), derived from `npm_config_user_agent`. Distinguishes
  // `npx react-doctor` (npm) from `pnpm dlx` / global installs in triage.
  invokedVia: string;
  // Full-scan lint batch ordering in effect for this run: `"cost"` (LPT,
  // largest-first) or `"arrival"` (the env-revertable fallback). The cohort
  // dimension for the LPT before/after — `Linter.run` p95 and dropped-file
  // rate are queried grouped by it.
  lintBatchOrdering: "cost" | "arrival";
}

const ROOT_SUBCOMMANDS = new Set(["install", "setup"]);

// `npm_config_user_agent` looks like "pnpm/9.1.0 npm/? node/v22.0.0 ...";
// the leading token names the package manager that spawned the process.
const detectInvokedVia = (): string => {
  const userAgent = process.env.npm_config_user_agent;
  if (!userAgent) return "unknown";
  const tool = userAgent.split("/", 1)[0]?.trim();
  return tool || "unknown";
};

const detectNodeMajor = (): number => {
  const major = Number.parseInt(process.versions.node.split(".", 1)[0] ?? "", 10);
  return Number.isNaN(major) ? 0 : major;
};

const detectOrigin = (): string => {
  if (isGitHookEnvironment()) return "git-hook";
  if (isCodingAgentEnvironment()) return "agent";
  if (isCiEnvironment()) return "ci";
  return "cli";
};

const detectCommand = (userArguments: ReadonlyArray<string>): string => {
  for (const argument of userArguments) {
    if (argument === "--") break;
    if (argument.startsWith("-")) continue;
    return ROOT_SUBCOMMANDS.has(argument) ? argument : "inspect";
  }
  return "inspect";
};

/**
 * Snapshot of the current invocation, attached to Sentry events as the
 * `run` context to make crashes triage-able (which version, platform,
 * CI/agent, how it was invoked). Every field is cheap, synchronous, and
 * safe to read at any point — cwd reads fall back, env reads are
 * booleans — so it's rebuilt lazily at capture time when runtime-only
 * signals like `jsonMode` are finally known.
 */
export const buildRunContext = (): RunContext => {
  const userArguments = process.argv.slice(2);
  return {
    version: VERSION,
    runId: getRunId(),
    origin: detectOrigin(),
    command: detectCommand(userArguments),
    // Scrub home-directory paths so the OS username never rides along in the
    // argument string or working directory (e.g. a directory positional, or
    // `--changed-files-from /Users/<name>/…`).
    argv: scrubSensitivePaths(userArguments.join(" ")),
    cwd: scrubSensitivePaths(process.cwd()),
    node: process.version,
    nodeMajor: detectNodeMajor(),
    platform: process.platform,
    arch: process.arch,
    ci: isCiEnvironment(),
    ciProvider: detectCiProvider(),
    eventName: detectCiEventName(),
    viaAction: isOfficialGithubAction(),
    codingAgent: detectCodingAgent(),
    interactive: !isNonInteractiveEnvironment(),
    terminalKind: detectTerminalKind(),
    jsonMode: isJsonModeActive(),
    debug: isDebugFlagEnabled(),
    invokedVia: detectInvokedVia(),
    lintBatchOrdering: resolveLintBatchOrdering(),
  };
};
