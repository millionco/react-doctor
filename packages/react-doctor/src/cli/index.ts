import { Command } from "commander";
import { CANONICAL_GITHUB_URL, highlighter } from "@react-doctor/core";
import { flushSentry, initializeSentry } from "../instrument.js";
import { inspectAction } from "./commands/inspect.js";
import { installAction } from "./commands/install.js";
import {
  rulesCategoryAction,
  rulesDisableAction,
  rulesEnableAction,
  rulesExplainAction,
  rulesIgnoreTagAction,
  rulesListAction,
  rulesSetAction,
  rulesUnignoreTagAction,
} from "./commands/rules.js";
import { versionAction } from "./commands/version.js";
import { applyColorPreference } from "./utils/apply-color-preference.js";
import { exitGracefully } from "./utils/exit-gracefully.js";
import { handleError } from "./utils/handle-error.js";
import { isJsonModeActive, writeJsonErrorReport } from "./utils/json-mode.js";
import { normalizeHelpInvocation } from "./utils/normalize-help-command.js";
import { reportErrorToSentry } from "./utils/report-error.js";
import { stripUnknownCliFlags } from "./utils/strip-unknown-cli-flags.js";
import { unrefStdin } from "./utils/unref-stdin.js";
import { VERSION } from "./utils/version.js";

initializeSentry();

process.on("SIGINT", exitGracefully);
process.on("SIGTERM", exitGracefully);
unrefStdin();

const formatExampleLines = (
  examples: ReadonlyArray<readonly [command: string, description: string]>,
): string => {
  const width = Math.max(...examples.map(([command]) => command.length));
  return examples
    .map(
      ([command, description]) =>
        `  $ ${command.padEnd(width)}  ${highlighter.dim(`# ${description}`)}`,
    )
    .join("\n");
};

// clig.dev (Help): "Lead with examples." Epilogs are functions, not
// pre-built strings, so they render after `applyColorPreference` runs and
// honor `--no-color` in a TTY.
const renderRootHelpEpilog = (): string => `
${highlighter.dim("Examples:")}
${formatExampleLines([
  ["react-doctor", "scan the current project"],
  ["react-doctor ./apps/web", "scan a specific directory"],
  ["react-doctor --diff main", "scan only files changed vs. main"],
  ["react-doctor --staged", "scan staged files (pre-commit hook)"],
  ["react-doctor --fail-on warning", "exit non-zero on warnings (CI gate)"],
  ["react-doctor --json > report.json", "write a machine-readable report"],
  ["react-doctor --explain src/App.tsx:42", "explain why a rule fired there"],
  ["react-doctor install", "set up the agent skill and git hook"],
])}

${highlighter.dim("Configuration:")}
  Add a ${highlighter.info("doctor.config.ts")} (or .js/.mjs/.json — or a ${highlighter.info('"reactDoctor"')} key in your package.json) in the project root.
  Use ${highlighter.info("react-doctor rules")} to list, explain, and configure rules. CLI flags always override config values.

${highlighter.dim("Feedback & bug reports:")}
  ${highlighter.info(`${CANONICAL_GITHUB_URL}/issues`)}

${highlighter.dim("Learn more:")}
  ${highlighter.info(CANONICAL_GITHUB_URL)}
`;

const renderInstallHelpEpilog = (): string => `
${highlighter.dim("Examples:")}
${formatExampleLines([
  ["react-doctor install", "interactive setup"],
  ["react-doctor install --yes", "non-interactive; all detected agents"],
  ["react-doctor install --dry-run", "preview without writing files"],
  ["react-doctor install --agent-hooks", "also install native agent hooks"],
])}

${highlighter.dim("Learn more:")}
  ${highlighter.info(CANONICAL_GITHUB_URL)}
`;

const program = new Command()
  .name("react-doctor")
  .description("Diagnose React codebase health")
  .version(VERSION, "-v, --version", "display the version number")
  .argument("[directory]", "project directory to scan", ".")
  .option("--lint", "enable linting")
  .option("--no-lint", "skip linting")
  .option("--dead-code", "enable dead-code analysis (default)")
  .option(
    "--no-dead-code",
    "skip dead-code analysis (unused files / exports / dependencies, circular imports)",
  )
  .option("--verbose", "show every rule and per-file details (default shows top 3 rules)")
  .option("--score", "output only the score")
  .option("--json", "output a single structured JSON report (suppresses other output)")
  .option("--json-compact", "with --json, emit compact JSON (no indentation)")
  .option("-y, --yes", "skip prompts, scan all workspace projects")
  .option("--full", "force a full scan (overrides any `diff` value in config or `--diff`)")
  .option(
    "--no-parallel",
    "lint serially with one worker (default: parallel across CPU cores; set the worker count with REACT_DOCTOR_PARALLEL)",
  )
  .option("--project <name>", "select workspace project (comma-separated for multiple)")
  .option(
    "--diff [base]",
    "scan only files changed vs base branch (pass `false` to disable; overridden by --full)",
  )
  .option(
    "--changed-files-from <file>",
    "internal: scan source files listed in a newline-delimited changed-files file",
  )
  .option("--no-score", "skip the score API, the share URL, and crash reporting")
  .option(
    "--no-telemetry",
    "alias for --no-score (skip the score API, share URL, and crash reporting)",
  )
  .option("--staged", "scan only staged (git index) files for pre-commit hooks")
  .option(
    "--fail-on <level>",
    "exit with error code on diagnostics: error, warning, none (default: none)",
  )
  .option("--annotations", "output diagnostics as GitHub Actions annotations")
  .option(
    "--pr-comment",
    "tune CLI output for sticky PR comments (drops weak-signal rule families like `design` from the printed list and the fail-on gate; configure via config.surfaces)",
  )
  .option(
    "--explain <file:line>",
    "diagnose why a rule fired or why a suppression didn't apply at a specific location",
  )
  .option("--why <file:line>", "alias for --explain")
  .option(
    "--respect-inline-disables",
    "respect inline `// eslint-disable*` / `// oxlint-disable*` comments (default)",
  )
  .option(
    "--no-respect-inline-disables",
    "audit mode: neutralize inline lint suppressions before scanning",
  )
  .option("--warnings", "show warning-severity diagnostics (default)")
  .option("--no-warnings", "hide warning-severity diagnostics (errors only)")
  .option("--color", "force colored output")
  .option("--no-color", "disable colored output (also honors NO_COLOR)")
  .addHelpText("after", renderRootHelpEpilog);

program.action(inspectAction);

program
  .command("install")
  .alias("setup")
  .description("Install the react-doctor skill into your coding agents and optional git hook")
  .option("-y, --yes", "skip prompts, install for all detected agents")
  .option("--dry-run", "show what would be installed without writing files")
  .option("--agent-hooks", "install native non-blocking agent hooks for Claude Code and Cursor")
  .option("-c, --cwd <cwd>", "working directory", process.cwd())
  .option("--color", "force colored output")
  .option("--no-color", "disable colored output (also honors NO_COLOR)")
  .addHelpText("after", renderInstallHelpEpilog)
  .action(installAction);

program
  .command("version")
  .description("show the version with Node and platform info")
  .option("--color", "force colored output")
  .option("--no-color", "disable colored output (also honors NO_COLOR)")
  .action(versionAction);

const rules = program
  .command("rules")
  .description("List, explain, and configure which React Doctor rules run");

// HACK: `--json` is also declared on the root program (for the default
// inspect command), so Commander stashes it on the parent rather than the
// subcommand. Route every rules action through `optsWithGlobals()` so the
// merged option set (subcommand + inherited globals) is what the action
// sees, regardless of where Commander parked a colliding flag.
rules
  .command("list")
  .description("List rules and the severity they run at under your config")
  .option("--category <name>", "only show rules in a category (e.g. Performance)")
  .option("--tag <name>", "only show rules with a tag (e.g. design, test-noise)")
  .option("--framework <name>", "only show rules for a framework (e.g. global, nextjs)")
  .option("--configured", "only show rules your config has changed from the default")
  .option("--json", "output a structured JSON array")
  .option("-c, --cwd <cwd>", "working directory", process.cwd())
  .action((_options, command) => rulesListAction(command.optsWithGlobals()));

rules
  .command("explain <rule>")
  .description("Explain why a rule matters, its current severity, and how to configure it")
  .option("--json", "output a structured JSON object")
  .option("-c, --cwd <cwd>", "working directory", process.cwd())
  .action((rule, _options, command) => rulesExplainAction(rule, command.optsWithGlobals()));

rules
  .command("set <rule> <severity>")
  .description("Set a rule's severity: off, warn, or error")
  .option("-c, --cwd <cwd>", "working directory", process.cwd())
  .action((rule, severity, _options, command) =>
    rulesSetAction(rule, severity, command.optsWithGlobals()),
  );

rules
  .command("enable <rule>")
  .description("Enable a rule at its recommended severity (or pass --severity)")
  .option("--severity <level>", "severity to enable at: warn or error")
  .option("-c, --cwd <cwd>", "working directory", process.cwd())
  .action((rule, _options, command) => rulesEnableAction(rule, command.optsWithGlobals()));

rules
  .command("disable <rule>")
  .description("Disable a rule so it never runs")
  .option("-c, --cwd <cwd>", "working directory", process.cwd())
  .action((rule, _options, command) => rulesDisableAction(rule, command.optsWithGlobals()));

rules
  .command("category <category> <severity>")
  .description("Set the severity for a whole category (off, warn, error)")
  .option("-c, --cwd <cwd>", "working directory", process.cwd())
  .action((category, severity, _options, command) =>
    rulesCategoryAction(category, severity, command.optsWithGlobals()),
  );

rules
  .command("ignore-tag <tag>")
  .description("Skip a whole rule family by tag before linting (e.g. design)")
  .option("-c, --cwd <cwd>", "working directory", process.cwd())
  .action((tag, _options, command) => rulesIgnoreTagAction(tag, command.optsWithGlobals()));

rules
  .command("unignore-tag <tag>")
  .description("Stop ignoring a tag previously skipped via ignore-tag")
  .option("-c, --cwd <cwd>", "working directory", process.cwd())
  .action((tag, _options, command) => rulesUnignoreTagAction(tag, command.optsWithGlobals()));

// HACK: when stdout is piped into a process that closes early (e.g.
// `react-doctor . | head`), Node throws an uncaught EPIPE on the next
// write. Exit cleanly instead of dumping a stack trace.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
});

const knownCommands = program.commands.flatMap((command) => [command.name(), ...command.aliases()]);
const strippedArgv = stripUnknownCliFlags(process.argv);

// HACK: Commander allows only one short flag on `--version` (we use `-v`),
// so honor `-V` ourselves before Commander parses. `stripUnknownCliFlags`
// drops a standalone unknown `-V` but keeps one that's an option value, so
// "present in raw argv yet stripped out" means it was passed as a real flag
// (not e.g. `--cwd -V`).
if (process.argv.includes("-V") && !strippedArgv.includes("-V")) {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}

// Resolve color from the stripped argv (before help-normalization drops
// trailing tokens like `react-doctor help --no-color`) so the choice
// reaches help output too.
applyColorPreference(strippedArgv);

// 12-factor (#1): map `help` / `help <command>` to Commander's `--help`.
const argv = normalizeHelpInvocation(strippedArgv, knownCommands);

program
  .parseAsync(argv)
  // Deliver any queued performance transaction before the process exits on the
  // success path; error funnels flush via `reportErrorToSentry`.
  .then(() => flushSentry())
  .catch(async (error: unknown) => {
    const sentryEventId = await reportErrorToSentry(error);
    if (isJsonModeActive()) {
      writeJsonErrorReport(error);
      process.exit(1);
    }
    handleError(error, { sentryEventId });
  });
