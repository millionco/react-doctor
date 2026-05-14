import { performance } from "node:perf_hooks";
import { Command } from "commander";
import { buildJsonReportError } from "../core/build-json-report-error.js";
import { highlighter } from "../core/highlighter.js";
import { CANONICAL_GITHUB_URL } from "../constants.js";
import { cliState } from "./cli-state.js";
import { createInspectAction } from "./commands/inspect.js";
import { installAction } from "./commands/install.js";
import { exitGracefully } from "./exit-gracefully.js";
import { handleError } from "./handle-error.js";
import { VERSION } from "./version.js";
import { writeJsonReport } from "./write-json-report.js";

process.on("SIGINT", exitGracefully);
process.on("SIGTERM", exitGracefully);

const program = new Command()
  .name("react-doctor")
  .description("Diagnose React codebase health")
  .version(VERSION, "-v, --version", "display the version number")
  .argument("[directory]", "project directory to scan", ".")
  .option("--lint", "enable linting")
  .option("--no-lint", "skip linting")
  .option("--dead-code", "enable dead code detection")
  .option("--no-dead-code", "skip dead code detection")
  .option("--verbose", "show every rule and per-file details (default shows top 3 rules)")
  .option("--score", "output only the score")
  .option("--json", "output a single structured JSON report (suppresses other output)")
  .option("--json-compact", "with --json, emit compact JSON (no indentation)")
  .option("-y, --yes", "skip prompts, scan all workspace projects")
  .option("--full", "force a full scan (overrides any `diff` value in config or `--diff`)")
  .option("--project <name>", "select workspace project (comma-separated for multiple)")
  .option(
    "--diff [base]",
    "scan only files changed vs base branch (pass `false` to disable; overridden by --full)",
  )
  .option("--offline", "skip telemetry (anonymous, not stored, only used to calculate score)")
  .option("--staged", "scan only staged (git index) files for pre-commit hooks")
  .option("--fail-on <level>", "exit with error code on diagnostics: error, warning, none", "error")
  .option("--annotations", "output diagnostics as GitHub Actions annotations")
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
  .addHelpText(
    "after",
    `
${highlighter.dim("Configuration:")}
  Place a ${highlighter.info("react-doctor.config.json")} (or ${highlighter.info('"reactDoctor"')} key in your package.json) in the project root.
  CLI flags always override config values. See the README for the full schema.

${highlighter.dim("Learn more:")}
  ${highlighter.info(CANONICAL_GITHUB_URL)}
`,
  );

program.action(createInspectAction(program));

program
  .command("install")
  .description("Install the react-doctor skill into your coding agents")
  .option("-y, --yes", "skip prompts, install for all detected agents")
  .option("--dry-run", "show what would be installed without writing files")
  .action(installAction);

// HACK: when stdout is piped into a process that closes early (e.g.
// `react-doctor . | head`), Node throws an uncaught EPIPE on the next
// write. Exit cleanly instead of dumping a stack trace.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
});

program.parseAsync().catch((error: unknown) => {
  if (cliState.isJsonModeActive) {
    try {
      writeJsonReport(
        buildJsonReportError({
          version: VERSION,
          directory: cliState.resolvedDirectoryForCancel ?? process.cwd(),
          error,
          elapsedMilliseconds: performance.now() - cliState.cancelStartTime,
          mode: cliState.currentReportMode,
        }),
      );
    } catch {
      process.stdout.write(
        '{"schemaVersion":1,"ok":false,"error":{"message":"Internal error","name":"Error","chain":[]}}\n',
      );
    }
    process.exit(1);
  }
  handleError(error);
});
