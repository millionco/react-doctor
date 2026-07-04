import { defineRule } from "../../utils/define-rule.js";
import { isConfigOrCiPath } from "./utils/is-config-or-ci-path.js";
import { scanByPattern } from "./utils/scan-by-pattern.js";

const CI_INSTALL_NEAR_SECRET_PATTERN =
  /(?:npm|pnpm|yarn|bun)\s+(?:install|ci)\b(?:(?!--ignore-scripts)[\s\S]){0,700}\bsecrets\.[A-Z0-9_]+|\bsecrets\.[A-Z0-9_]+(?:(?!--ignore-scripts)[\s\S]){0,700}(?:npm|pnpm|yarn|bun)\s+(?:install|ci)\b/i;

export const buildPipelineSecretBoundary = defineRule({
  id: "build-pipeline-secret-boundary",
  title: "Build pipeline runs code near secrets",
  severity: "warn",
  impact: "security",
  confidence: "heuristic",
  fix: "local",
  recommendation:
    "Run dependency installs with scripts disabled before exposing secrets, isolate untrusted build code, and move signing/deploy authority into a narrow privileged step.",
  scan: scanByPattern({
    // The CI-install pattern only describes workflow files; package.json
    // (also a config path) never matches its shape.
    shouldScan: (file) =>
      isConfigOrCiPath(file.relativePath) && !file.relativePath.endsWith("package.json"),
    pattern: CI_INSTALL_NEAR_SECRET_PATTERN,
    message:
      "The build or install pipeline can execute package lifecycle code while CI secrets may be present.",
  }),
});
