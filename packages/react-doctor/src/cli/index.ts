import { Command, Option } from "commander";
import { CANONICAL_GITHUB_URL, CI_URL, highlighter } from "@react-doctor/core";
import { flushSentry, initializeSentry } from "../instrument.js";
import { ciConfigAction, ciInstallAction, ciUpgradeAction } from "./commands/ci.js";
import { designAction } from "./commands/design.js";
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
import { whyAction } from "./commands/why.js";
import { applyColorPreference } from "./utils/apply-color-preference.js";
import { METRIC, TUI_MIN_NODE_MAJOR_VERSION } from "./utils/constants.js";
import { ensureWindowsUtf8Console } from "./utils/ensure-windows-utf8-console.js";
import { exitGracefully } from "./utils/exit-gracefully.js";
import { guardStdin } from "./utils/guard-stdin.js";
import { handleError, handleUserError } from "./utils/handle-error.js";
import { isDebugFlagEnabled } from "./utils/is-debug-flag.js";
import { isExpectedUserError } from "./utils/is-expected-user-error.js";
import { isJsonModeActive, writeJsonErrorReport } from "./utils/json-mode.js";
import { isNonInteractiveEnvironment } from "./utils/is-non-interactive-environment.js";
import { normalizeHelpInvocation } from "./utils/normalize-help-command.js";
import { printDebugTrace } from "./utils/print-debug-trace.js";
import { recordCount } from "./utils/record-metric.js";
import { assertNoRemovedFlags } from "./utils/removed-cli-flags.js";
import { reportErrorToSentry } from "./utils/report-error.js";
import { stripUnknownCliFlags } from "./utils/strip-unknown-cli-flags.js";
import { unrefStdin } from "./utils/unref-stdin.js";
import { VERSION } from "./utils/version.js";

initializeSentry();

process.on("SIGINT", exitGracefully);
process.on("SIGTERM", exitGracefully);
// `--debug`: surface the run's Sentry trace id as the very last line, on every
// exit path. An exit handler (not a `.then`) is the one choke point that also
// covers the error funnels, which `process.exit()` after rendering — by then
// the trace has flushed (success path awaits `flushSentry`; error path awaits
// `reportErrorToSentry`'s flush), so the printed id always resolves in Sentry.
process.on("exit", () => {
  if (isDebugFlagEnabled()) printDebugTrace();
});
unrefStdin();
// HACK: a terminal that vanishes while an interactive prompt is reading
// stdin makes Node raise `read EIO` on the raw-mode handle; with no listener
// it escalates to a fatal uncaught exception. Guard it so a hangup exits
// cleanly (mirrors the stdout EPIPE guard below). Armed before any command.
guardStdin();

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
  ["react-doctor --scope changed --base main", "scan only new issues vs. main"],
  ["react-doctor --project modules/a,modules/b", "score each module separately (names or paths)"],
  ["react-doctor --staged", "scan staged files (pre-commit hook)"],
  ["react-doctor design", "run the focused UI design audit"],
  ["react-doctor --category Security", "show only one diagnostic category"],
  ["react-doctor --blocking warning", "fail CI on warnings too (default: error)"],
  ["react-doctor --json > report.json", "write a machine-readable report"],
  ["react-doctor why src/App.tsx:42", "explain why a rule fired there"],
  ["react-doctor ci install", "scan every pull request in CI"],
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

${highlighter.dim("Managing CI:")}
  ${highlighter.info("react-doctor ci install")} sets up, upgrades, and configures CI on its own.

${highlighter.dim("Learn more:")}
  ${highlighter.info(CANONICAL_GITHUB_URL)}
`;

const renderDesignHelpEpilog = (): string => `
${highlighter.dim("Examples:")}
${formatExampleLines([
  ["react-doctor design", "audit UI design in the current project"],
  ["react-doctor design ./apps/web", "audit one application"],
  ["react-doctor design --verbose", "show every design finding"],
  ["react-doctor design --json", "write a design-only JSON report"],
])}

${highlighter.dim("Scope:")}
  Runs every rule tagged ${highlighter.info("design")}; all design rules stay opt-in during a general health scan.
  Dead-code, supply-chain, external lint-config, custom-plugin, and health-score passes are skipped.
  Standard scan flags such as ${highlighter.info("--scope")}, ${highlighter.info("--project")}, ${highlighter.info("--verbose")}, and ${highlighter.info("--json")} still work.
`;

const renderCiHelpEpilog = (): string => `
${highlighter.dim("Examples:")}
${formatExampleLines([
  ["react-doctor ci install", "add a workflow that scans every pull request"],
  ["react-doctor ci install --blocking error", "add it and fail the check on new errors"],
  ["react-doctor ci install --pr", "open a pull request with the workflow"],
  ["react-doctor ci config", "change the gate, scope, and reporting settings"],
  ["react-doctor ci config --scope full", "scan the whole project on every pull request"],
  ["react-doctor ci upgrade", "bump the action to its current major"],
])}

${highlighter.dim("Providers:")}
  GitHub Actions is auto-detected and fully supported. GitLab CI is a gate-only
  scaffold. Pass ${highlighter.info("--provider gitlab-ci")} to choose it explicitly.

${highlighter.dim("Learn more:")}
  ${highlighter.info(CI_URL)}
`;

const collectCategoryOption = (value: string, previousValues: string[] | undefined): string[] => [
  ...(previousValues ?? []),
  value,
];

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
  .option("--supply-chain", "enable the dependency supply-chain scan (default)")
  .option(
    "--no-supply-chain",
    "skip the dependency supply-chain scan (Socket.dev dependency health checks)",
  )
  .option("--verbose", "show every rule and per-file details (default shows top 3 rules)")
  .option(
    "--debug",
    "force a Sentry trace and print its id at the end (paste it into a bug report)",
  )
  .option("--output-dir <dir>", "directory for the full diagnostics dump (default: a temp folder)")
  .option("--score", "output only the score")
  .option("--json", "output a single structured JSON report (suppresses other output)")
  .option("--json-compact", "with --json, emit compact JSON (no indentation)")
  .option("--json-out <path>", "with --json, write the report to a file instead of stdout")
  .option("-y, --yes", "skip prompts, scan all workspace projects")
  .option(
    "--no-parallel",
    "lint serially with one worker (default: parallel across CPU cores; set the worker count with REACT_DOCTOR_PARALLEL)",
  )
  .option(
    "--project <name>",
    "select projects: workspace names or directory paths (comma-separated for multiple); overrides the `projects` config field",
  )
  .option(
    "--scope <value>",
    "how much supported JS/TS source to scan/report: full (default), files, changed (only new issues vs base), or lines (issues whose source spans touch changed lines)",
  )
  .option("--base <ref>", "base git ref for files/changed/lines scope (auto-detected when omitted)")
  .option(
    "--include-untracked",
    "with --scope files/changed/lines, also scan ordinary untracked files (respects .gitignore)",
  )
  .addOption(
    // Deprecated alias for `--scope` (warns at runtime). `--diff <base>` →
    // `--scope changed --base <base>`, `--diff false` → `--scope full`. Hidden
    // from --help but kept functional; takes an optional value, so removing it
    // would turn `--diff main` into a stray positional. Remove in a future major.
    new Option(
      "--diff [base]",
      "[deprecated] alias for --scope changed (pass `false` to force a full scan)",
    ).hideHelp(),
  )
  .addOption(
    // Internal: the GitHub Action passes the PR's changed-file list here.
    // Hidden from --help; it's plumbing, not user surface.
    new Option(
      "--changed-files-from <file>",
      "scan source files listed in a newline-delimited changed-files file",
    ).hideHelp(),
  )
  .option("--no-score", "skip the score API, the share URL, and crash reporting")
  .addOption(
    new Option(
      "--category <category>",
      "only show diagnostics in a category (repeatable; e.g. Security)",
    ).argParser(collectCategoryOption),
  )
  .option(
    "--no-telemetry",
    "alias for --no-score (skip the score API, share URL, and crash reporting)",
  )
  .option("--staged", "scan only staged (git index) files for pre-commit hooks")
  .option(
    "--max-duration <seconds>",
    "scan time budget for the whole run, shared across workspace projects: past it, remaining lint batches and dead-code are skipped and partial results are reported (skipped files are listed in the JSON report)",
  )
  .option(
    "--blocking <level>",
    "severity that fails CI: error (default), warning, or none (advisory)",
  )
  .addOption(
    // Deprecated alias for --blocking (warns at runtime). Hidden from --help but
    // kept functional: it takes a value, so hard-removing it would turn
    // `--fail-on warning` into a stray positional. Remove in a future major.
    new Option("--fail-on <level>", "[deprecated] alias for --blocking <level>").hideHelp(),
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
  .command("design [directory]")
  .description("Run only the focused UI design diagnostics")
  .addHelpText("after", renderDesignHelpEpilog)
  .action((directory, _options, command) =>
    designAction(directory ?? ".", command.optsWithGlobals()),
  );

program
  .command("why <location>")
  .description("Explain why a rule fired (or why a suppression didn't apply) at a file:line")
  .option(
    "--project <name>",
    "select projects: workspace names or directory paths (comma-separated for multiple)",
  )
  .option("-c, --cwd <cwd>", "working directory", process.cwd())
  .option("--color", "force colored output")
  .option("--no-color", "disable colored output (also honors NO_COLOR)")
  .action((location, options) => whyAction(location, options));

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

const providerOption: [string, string] = [
  "--provider <name>",
  "ci provider: github-actions or gitlab-ci (auto-detected by default)",
];
const prOption: [string, string] = [
  "--pr",
  "open a pull request with the change instead of writing it to the working tree",
];

// HACK: `--blocking`, `--scope`, `--yes`, and `--color` are also declared on
// the root program (for the default inspect command), so Commander stashes a
// colliding flag on the parent rather than the `ci` subcommand. Route every
// action through `optsWithGlobals()` so the merged option set (subcommand +
// inherited globals) is what the action sees — mirroring the `rules` group.
const ci = program
  .command("ci")
  .description("Set up, upgrade, and configure React Doctor in your CI");

ci.command("install")
  .description("Add a CI workflow that scans every pull request")
  .option(...providerOption)
  .option(...prOption)
  .option("--blocking <level>", "gate level: none (advisory, default), warning, or error")
  .option(
    "--scope <value>",
    "what a pull-request scan reports: changed (default), files, lines, full",
  )
  .option("--comment", "post a summary comment on each pull request")
  .option("--no-comment", "don't post a summary comment")
  .option("--review-comments", "add inline review comments on changed lines")
  .option("--no-review-comments", "don't add inline review comments")
  .option("--commit-status", "report a commit status with the health score")
  .option("--no-commit-status", "don't report a commit status")
  .option("-y, --yes", "skip prompts; use the defaults")
  .option("-c, --cwd <cwd>", "working directory", process.cwd())
  .option("--color", "force colored output")
  .option("--no-color", "disable colored output (also honors NO_COLOR)")
  .addHelpText("after", renderCiHelpEpilog)
  .action((_options, command) => ciInstallAction(command.optsWithGlobals()));

ci.command("config")
  .description("Change the gate, scan scope, and pull-request reporting")
  .option(...providerOption)
  .option("--blocking <level>", "gate level: none (advisory), warning, or error")
  .option("--scope <value>", "what a pull-request scan reports: changed, files, lines, or full")
  .option("--comment", "post a summary comment on each pull request")
  .option("--no-comment", "don't post a summary comment")
  .option("--review-comments", "add inline review comments on changed lines")
  .option("--no-review-comments", "don't add inline review comments")
  .option("--commit-status", "report a commit status with the health score")
  .option("--no-commit-status", "don't report a commit status")
  .option("-y, --yes", "skip prompts; print the current settings")
  .option("-c, --cwd <cwd>", "working directory", process.cwd())
  .option("--color", "force colored output")
  .option("--no-color", "disable colored output (also honors NO_COLOR)")
  .action((_options, command) => ciConfigAction(command.optsWithGlobals()));

ci.command("upgrade")
  .description("Upgrade the CI workflow to the action's current major")
  .option(...providerOption)
  .option(...prOption)
  .option("-y, --yes", "skip prompts")
  .option("-c, --cwd <cwd>", "working directory", process.cwd())
  .option("--color", "force colored output")
  .option("--no-color", "disable colored output (also honors NO_COLOR)")
  .action((_options, command) => ciUpgradeAction(command.optsWithGlobals()));

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

// NOTE: `react-doctor experimental-lsp` is intentionally NOT wired through
// commander. The bin shim (bin/react-doctor.js) fast-paths it to a dedicated
// server entry so the CLI layer (commander / prompts / ora) never touches
// process.stdin before the LSP stdio transport attaches. This command is
// registered only so `--help` lists it; its body never runs in practice.
// It's gated behind the `experimental-` prefix because the editor language
// server is still unstable (protocol, caching, and diagnostics may change).
program
  .command("experimental-lsp", { hidden: false })
  .description("[experimental] run the React Doctor language server over stdio (for editors)")
  .allowUnknownOption()
  .action(() => {});

interface ExperimentalTuiOptions {
  readonly blocking?: string;
  readonly deadCode?: boolean;
  readonly score?: boolean;
  readonly project?: string;
  readonly yes?: boolean;
}

program
  .command("experimental-tui [directory]", { hidden: true })
  .description("[experimental] interactive, scrollable scan report")
  .option(
    "--blocking <level>",
    "severity that fails CI: error (default), warning, or none (advisory)",
  )
  .option("--color", "force colored output")
  .option("--no-color", "disable colored output (also honors NO_COLOR)")
  .option("--no-dead-code", "skip dead-code analysis")
  .option("--no-score", "skip the score API, the share URL, and crash reporting")
  .option("-p, --project <names>", "scan specific workspace projects (comma-separated, or *)")
  .option("-y, --yes", "skip the project prompt and scan every discovered project")
  .action(async (directory = ".", _localOptions: ExperimentalTuiOptions, command) => {
    const options: ExperimentalTuiOptions = command.optsWithGlobals();
    const deadCode = options.deadCode === false ? false : undefined;
    const noScore = options.score === false ? true : undefined;
    const nodeMajorVersion = Number(process.versions.node.split(".")[0]);
    if (
      process.stdout.isTTY !== true ||
      process.stdin.isTTY !== true ||
      isNonInteractiveEnvironment() ||
      nodeMajorVersion < TUI_MIN_NODE_MAJOR_VERSION
    ) {
      await inspectAction(directory, {
        deadCode,
        score: options.score === false ? false : undefined,
        project: options.project,
        yes: options.yes,
        blocking: options.blocking,
      });
      return;
    }
    recordCount(METRIC.cliInvoked, 1, { command: "experimental-tui" });
    const { runScanApp } = await import("./ink/run-scan-app.js");
    const { shouldFail } = await runScanApp({
      directory,
      options: { deadCode, noScore },
      projectFlag: options.project,
      skipPrompts: options.yes ?? false,
      blocking: options.blocking,
    });
    if (shouldFail) process.exitCode = 1;
  });

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

// Switch the Windows console to UTF-8 before any output, so the diagnostics and
// handoff payload don't mojibake on a non-UTF-8 code page (issue #956).
ensureWindowsUtf8Console();

// 12-factor (#1): map `help` / `help <command>` to Commander's `--help`.
const argv = normalizeHelpInvocation(strippedArgv, knownCommands);

Promise.resolve()
  // Reject removed flags before parsing so they're a clean migration error, not
  // a silent no-op (they'd otherwise be stripped before Commander sees them).
  .then(() => assertNoRemovedFlags(process.argv))
  .then(() => program.parseAsync(argv))
  // Deliver any queued performance transaction before the process exits on the
  // success path; error funnels flush via `reportErrorToSentry`. The `--debug`
  // trace id is printed from the `exit` handler above, after this flush.
  .then(() => flushSentry())
  .catch(async (error: unknown) => {
    // Mirror the per-command policy at the top-level funnel: expected,
    // user-actionable failures skip Sentry and render as a plain message
    // (no "open a prefilled issue" block), so they don't become triage noise.
    const isUserError = isExpectedUserError(error);
    const sentryEventId = isUserError ? undefined : await reportErrorToSentry(error);
    if (isJsonModeActive()) {
      writeJsonErrorReport(error, sentryEventId);
      process.exit(1);
    }
    if (isUserError) {
      handleUserError(error);
      return;
    }
    handleError(error, { sentryEventId });
  });
