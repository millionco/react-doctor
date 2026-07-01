import { defineRule } from "../../utils/define-rule.js";
import { isDevToolingPath } from "./utils/is-dev-tooling-path.js";
import { isProductionScriptSourcePath } from "./utils/is-production-script-source-path.js";
import { scanByPattern } from "./utils/scan-by-pattern.js";

// `(?<![.\w$])` keeps method calls like `regex.exec(...)` / `store.query.exec(...)`
// from triggering; known process modules are allowed explicitly. `[^)]`
// keeps the taint window inside the call's own argument list — `[\s\S]`
// bled into neighboring statements (logging f-strings after the call).
//
// Two branches. The shell-exec family (`exec`/`execSync`/`system`/`shell_exec`/
// `os.system`/`subprocess.*`/`child_process.exec*`) runs a single command
// string through a shell, so ANY request taint (or `shell: true`) in the call
// is dangerous. The spawn family (`spawn`/`spawnSync`/`child_process.spawn*`)
// defaults to `shell: false` and takes an argv array — a tainted value sitting
// in a discrete argv element (`spawn("git", ["log", req.query.branch])`) is a
// single opaque argument that CANNOT shell-inject. So the spawn branch only
// fires when a shell is explicitly enabled (`shell: true`) or the command
// itself (the first argument) is tainted (`spawn(req.query.cmd, …)`).
const COMMAND_EXECUTION_INPUT_RISK_PATTERNS = [
  /(?:(?<![.\w$])(?:exec(?:Sync)?|system|passthru|proc_open|shell_exec)|\b(?:os\.system|subprocess\.(?:run|Popen|call)|(?:child_process|childProcess|cp)\.exec\w*))\s*\([^)]{0,220}(?:req\.|request\.|params\.|query\.|body\.|searchParams|\$_(?:GET|POST|REQUEST)|shell\s*[:=]\s*true|f['"`][^'"`]*\{)/i,
  /(?:(?<![.\w$])spawn(?:Sync)?|\b(?:child_process|childProcess|cp)\.spawn\w*)\s*\((?:\s*(?:req\.|request\.|params\.|query\.|body\.|searchParams|\$_(?:GET|POST|REQUEST))|[^)]{0,220}shell\s*[:=]\s*true)/i,
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
