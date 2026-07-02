import { defineRule } from "../../utils/define-rule.js";
import { isDevToolingPath } from "./utils/is-dev-tooling-path.js";
import { isProductionScriptSourcePath } from "./utils/is-production-script-source-path.js";
import { scanByPattern } from "./utils/scan-by-pattern.js";

const REQUEST_TAINT_SOURCE = String.raw`(?:req\.|request\.|params\.|query\.|body\.|searchParams|\$_(?:GET|POST|REQUEST))`;

// `(?<![.\w$])` keeps method calls like `regex.exec(...)` / `store.query.exec(...)`
// from triggering; known process modules are allowed explicitly.
const SHELL_EXEC_CALLEE_SOURCE = String.raw`(?:(?<![.\w$])(?:exec(?:Sync)?|system|passthru|proc_open|shell_exec)|\b(?:os\.system|subprocess\.(?:run|Popen|call)|(?:child_process|childProcess|cp)\.exec\w*))`;

const SPAWN_CALLEE_SOURCE = String.raw`(?:(?<![.\w$])spawn(?:Sync)?|\b(?:child_process|childProcess|cp)\.spawn\w*)`;

const SHELL_BINARY_FIRST_ARG_SOURCE = String.raw`['"](?:sh|bash|zsh|dash|ksh|cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh)['"]`;

const SHELL_COMMAND_FLAG_SOURCE = String.raw`['"](?:-c|/c|-Command)['"]`;

// Two branches. `[^)]` windows keep taint matching inside the call's own
// argument list — `[\s\S]` bled into neighboring statements (logging
// f-strings after the call).
//
// The shell-exec family (`exec`/`execSync`/`system`/`shell_exec`/`os.system`/
// `subprocess.*`/`child_process.exec*`) runs a single command string through a
// shell, so ANY request taint in the call is dangerous. `shell\s*=\s*true` is
// the python kwarg (`subprocess.run(..., shell=True)`) only — the JS
// `shell: true` option on a zero-taint fixed command
// (`execSync("git status", { shell: true })`) is not injectable.
//
// The spawn family (`spawn`/`spawnSync`/`child_process.spawn*`) defaults to
// `shell: false` and takes an argv array, so a tainted value in a discrete
// argv element of a fixed non-shell command (`spawn("git", ["log",
// req.query.branch])`) is a single opaque argument that CANNOT shell-inject.
// The branch fires only when (a) the command itself — the comma-stopped first
// argument — is tainted (`spawn(req.query.cmd, …)`, spawn(`${req.query.cmd}`)),
// (b) the fixed command IS a shell binary executing tainted input via its
// command flag (`spawn("sh", ["-c", req.query.cmd])`), or (c) a shell is
// explicitly enabled AND taint appears anywhere in the call (order-independent
// via lookahead) — `spawn("ls", ["-la"], { shell: true })` stays silent.
const COMMAND_EXECUTION_INPUT_RISK_PATTERNS = [
  new RegExp(
    String.raw`${SHELL_EXEC_CALLEE_SOURCE}\s*\([^)]{0,220}(?:${REQUEST_TAINT_SOURCE}|shell\s*=\s*true|f['"\`][^'"\`]*\{)`,
    "i",
  ),
  new RegExp(
    String.raw`${SPAWN_CALLEE_SOURCE}\s*\((?:[^,)]{0,120}?${REQUEST_TAINT_SOURCE}|\s*${SHELL_BINARY_FIRST_ARG_SOURCE}\s*,\s*\[\s*${SHELL_COMMAND_FLAG_SOURCE}\s*,[^\]]{0,220}${REQUEST_TAINT_SOURCE}|(?=[^)]{0,220}shell\s*[:=]\s*true)[^)]{0,220}${REQUEST_TAINT_SOURCE})`,
    "i",
  ),
] as const;

export const commandExecutionInputRisk = defineRule({
  id: "command-execution-input-risk",
  title: "Command execution uses caller-shaped input",
  severity: "error",
  recommendation:
    "Avoid shell execution for caller-controlled values. Use fixed commands, argument arrays, strict allowlists, and no shell interpolation.",
  scan: scanByPattern({
    shouldScan: (file) =>
      isProductionScriptSourcePath(file.relativePath) && !isDevToolingPath(file.relativePath),
    pattern: COMMAND_EXECUTION_INPUT_RISK_PATTERNS,
    message:
      "Command execution appears to include request, query, body, or shell-interpolated input.",
  }),
});
