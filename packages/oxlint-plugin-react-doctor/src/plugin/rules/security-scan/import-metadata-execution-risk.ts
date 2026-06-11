import { defineRule } from "../../utils/define-rule.js";
import { isProductionSourcePath } from "./utils/is-production-source-path.js";
import { scanByPattern } from "./utils/scan-by-pattern.js";

// Bare `spawn(`/`exec(` is also the xstate/redux-saga effect API; only count
// it when the file shows an actual process module.
const PROCESS_MODULE_EVIDENCE_PATTERN = /child_process|childProcess|execa|subprocess|Deno\.run/;

const EXECUTION_WITH_BARE_CALLS_PATTERN =
  /(?:\b(?:eval|new\s+Function|vm\.runIn\w*)|(?<![.\w$])(?:exec(?:File)?(?:Sync)?|spawn(?:Sync)?)|\b(?:child_process|childProcess|cp)\.(?:exec|spawn)\w*)\s*\([^;]{0,200}(?<!["'])\b(?:exif|metadata|manifest|preset|plugin|upload|drop(?:ped|s)?\b|archive|zip|unzip|untar)(?!\w*["'])/;

const EXECUTION_WITHOUT_BARE_CALLS_PATTERN =
  /(?:\b(?:eval|new\s+Function|vm\.runIn\w*)|\b(?:child_process|childProcess|cp)\.(?:exec|spawn)\w*)\s*\([^;]{0,200}(?<!["'])\b(?:exif|metadata|manifest|preset|plugin|upload|drop(?:ped|s)?\b|archive|zip|unzip|untar)(?!\w*["'])/;

const EXECUTION_RISK_MESSAGE =
  "Imported metadata, uploads, or plugin manifests appear to reach code execution.";

const scanWithBareCalls = scanByPattern({
  shouldScan: () => true,
  pattern: EXECUTION_WITH_BARE_CALLS_PATTERN,
  message: EXECUTION_RISK_MESSAGE,
});

const scanWithoutBareCalls = scanByPattern({
  shouldScan: () => true,
  pattern: EXECUTION_WITHOUT_BARE_CALLS_PATTERN,
  message: EXECUTION_RISK_MESSAGE,
});

export const importMetadataExecutionRisk = defineRule({
  id: "import-metadata-execution-risk",
  title: "Imported metadata reaches code execution",
  severity: "error",
  recommendation:
    "Parse imported metadata as data with strict schemas; do not evaluate EXIF, manifests, presets, dropped files, or archives.",
  // The taint word must sit inside the execution call's own statement —
  // a window that crosses statements self-flags on unrelated `import` lines
  // (e.g. `import { exec } from "node:child_process"` followed by any import).
  // `(?<!["'])...(?!["'])` keeps quote-wrapped static arguments
  // (`spawnSync("claude", ["plugin", ...])`) from counting as taint — a
  // literal word is an argument value the attacker does not control.
  // Case-sensitive on purpose: the execution APIs are exact-case, and a
  // case-insensitive taint word matches SCREAMING constants (`PLUGIN_ID`)
  // and camelCase type names (`WorkflowMetadata`) that are not data.
  scan: (file) => {
    if (!isProductionSourcePath(file.relativePath)) return [];
    return PROCESS_MODULE_EVIDENCE_PATTERN.test(file.content)
      ? scanWithBareCalls(file)
      : scanWithoutBareCalls(file);
  },
});
