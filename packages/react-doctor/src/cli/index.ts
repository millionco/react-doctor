import { Command, Option } from "commander";
import { CANONICAL_GITHUB_URL, highlighter } from "@react-doctor/core";
import { flushSentry, initializeSentry } from "../instrument.js";
import {
  browserCloseAction,
  browserEvalAction,
  browserOpenAction,
  browserScreenshotAction,
  browserSnapshotAction,
} from "./commands/browser.js";
import { DEFAULT_HOST } from "@react-doctor/debug";
import { debugServeAction } from "./commands/debug.js";
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
import { exitGracefully } from "./utils/exit-gracefully.js";
import { guardStdin } from "./utils/guard-stdin.js";
import { handleError, handleUserError } from "./utils/handle-error.js";
import { isDebugFlagEnabled } from "./utils/is-debug-flag.js";
import { isExpectedUserError } from "./utils/is-expected-user-error.js";
import { isJsonModeActive, writeJsonErrorReport } from "./utils/json-mode.js";
import { normalizeHelpInvocation } from "./utils/normalize-help-command.js";
import { parseViewport } from "./utils/parse-viewport.js";
import { printDebugTrace } from "./utils/print-debug-trace.js";
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
  ["react-doctor --category Security", "show only one diagnostic category"],
  ["react-doctor --blocking warning", "fail CI on warnings too (default: error)"],
  ["react-doctor --json > report.json", "write a machine-readable report"],
  ["react-doctor why src/App.tsx:42", "explain why a rule fired there"],
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
  ["react-doctor install --global", "install the skill for every project"],
  ["react-doctor install --agent-hooks", "also install native agent hooks"],
])}

${highlighter.dim("Learn more:")}
  ${highlighter.info(CANONICAL_GITHUB_URL)}
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
  .option("--verbose", "show every rule and per-file details (default shows top 3 rules)")
  .option(
    "--debug",
    "force a Sentry trace and print its id at the end (paste it into a bug report)",
  )
  .option("--output-dir <dir>", "directory for the full diagnostics dump (default: a temp folder)")
  .option("--score", "output only the score")
  .option("--json", "output a single structured JSON report (suppresses other output)")
  .option("--json-compact", "with --json, emit compact JSON (no indentation)")
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
    "how much to scan/report: full (default), files, changed (only new issues vs base), or lines (only changed lines)",
  )
  .option("--base <ref>", "base git ref for files/changed/lines scope (auto-detected when omitted)")
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
  .option(
    "--global",
    "install the skill in your home agent dirs (~/.cursor, ~/.claude, …) for every project instead of just this one",
  )
  .option("--agent-hooks", "install native non-blocking agent hooks for Claude Code and Cursor")
  .option("-c, --cwd <cwd>", "working directory", process.cwd())
  .option("--color", "force colored output")
  .option("--no-color", "disable colored output (also honors NO_COLOR)")
  .addHelpText("after", renderInstallHelpEpilog)
  .action(installAction);

const browser = program
  .command("browser")
  .description(
    "Drive a real browser for the debug and design jobs (attaches to your running Chrome over CDP, launches one only as a fallback)",
  );

// Every browser subcommand attaches the same way, so they share the connection flags.
const withConnectionOptions = (command: Command): Command =>
  command
    .option("--cdp <endpoint>", "CDP endpoint to attach to (default http://127.0.0.1:9222)")
    .option("--no-launch", "fail instead of launching Chrome when no attach target exists")
    .option(
      "--headed",
      "show the launched browser window (the launched Chrome is headless by default)",
    );

// Commands that render or measure the page also accept a one-shot emulated
// viewport (e.g. a phone). It's applied via a CDP override that clears when the
// command ends, so it never resizes the user's real window — which is why `open`
// (whose job is to leave a persistent page behind) does not take it.
const withRenderOptions = (command: Command): Command =>
  withConnectionOptions(command).addOption(
    new Option(
      "--viewport <size>",
      "emulate a viewport for this command, WIDTHxHEIGHT (e.g. 390x844)",
    ).argParser(parseViewport),
  );

withConnectionOptions(
  browser
    .command("open <url>")
    .description(
      "Open a URL and keep the page, with the React DevTools profiler injected for `browser eval` (window.__REACT_PERF__)",
    ),
).action(browserOpenAction);

withRenderOptions(
  browser
    .command("eval [expression]")
    .description(
      'Run Playwright code with `page` in scope, e.g. \'page.getByRole("button", { name: "Login" }).click()\'. Returns the expression\'s value, or — when it just acts — the resulting accessibility tree (so one call drives + shows the new state). Multiple statements work; reach page globals via page.evaluate(...). Add --profile to record the full runtime picture instead.',
    )
    .option(
      "--profile",
      "record console, network, performance (incl. a DevTools timeline trace), accessibility, and the React + CPU profiles while the expression runs (omit the expression to measure the live page idle)",
    )
    .option(
      "--codegen",
      "drive the expression, then write it as a runnable Playwright test (page.goto the current URL + the action + a no-console-error assertion) so a verified interaction becomes a regression test",
    )
    .option(
      "--video [path]",
      "record a .webm of the page while the expression runs, for playback in any eval mode (default react-doctor.webm; needs Playwright's ffmpeg: npx playwright install ffmpeg)",
    )
    .option(
      "--out <path>",
      "where to write the artifact: the raw timeline trace with --profile (default react-doctor-trace.json), or the Playwright spec with --codegen (default react-doctor.spec.ts)",
    ),
).action(browserEvalAction);

withRenderOptions(
  browser
    .command("snapshot")
    .description("Print the page's accessibility tree (a stable view of what is rendered)"),
).action(browserSnapshotAction);

withRenderOptions(
  browser
    .command("screenshot")
    .description("Save a screenshot of the page")
    .option("--out <path>", "output file path (default react-doctor-screenshot.png)"),
).action(browserScreenshotAction);

browser
  .command("close")
  .description(
    "Stop the dedicated Chrome React Doctor launched (the persistent fallback); never touches a browser you started",
  )
  .action(browserCloseAction);

const debug = program
  .command("debug")
  .description("Runtime debugging tools for the debug job (NDJSON logging server)");

// `serve` is the default so `react-doctor debug` starts the server. Agents use
// `--daemon` to get the endpoint and a detached server in one shot.
debug
  .command("serve", { isDefault: true })
  .description("Start the NDJSON logging server the debug job posts runtime logs to")
  .option("-p, --port <number>", "port to listen on (default: random)", (value) =>
    parseInt(value, 10),
  )
  .option("-H, --host <address>", "host to bind to", DEFAULT_HOST)
  .option("-s, --session-id <id>", "session id (default: random hex)")
  .option(
    "-l, --log-path <path>",
    "log file path (default: <tmpdir>/react-doctor-debug/debug-<sessionId>.log)",
  )
  .option("-d, --daemon", "start in the background, print the server info, then exit")
  .option("--json", "print the server info as one JSON line (for agents)")
  .action(debugServeAction);

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

// NOTE: like `experimental-lsp`, `react-doctor mcp` is fast-pathed by the bin
// shim (bin/react-doctor.js) to a dedicated stdio entry, so the CLI layer
// (commander / prompts / ora) never touches process.stdin before the MCP
// transport attaches. Registered here only so `--help` lists it; its body
// never runs in practice.
program
  .command("mcp")
  .description("Run the React Doctor MCP server over stdio (doctor scan + browser jobs as tools)")
  .allowUnknownOption()
  .action(() => {});

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
