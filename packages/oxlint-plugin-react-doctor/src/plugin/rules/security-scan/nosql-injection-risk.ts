import { DATABASE_SOURCE_FILE_PATTERN } from "../../constants/security-scan.js";
import { defineRule } from "../../utils/define-rule.js";
import { isProductionFilePath } from "./utils/is-production-file-path.js";
import { scanByPattern } from "./utils/scan-by-pattern.js";

const NOSQL_INJECTION_RISK_PATTERN =
  /\$where\s*['"]?\s*:\s*(?:f?['"`][^'"`]{0,200}\$\{|function|f['"])|\.find\s*\(\s*JSON\.parse\s*\(\s*(?:req|request)\.|\.aggregate\s*\(\s*\[?\s*\{[^}]{0,400}\$where|\bnew\s+RegExp\s*\(\s*(?:req|request)\.|\$regex['"]?\s*:\s*(?:req|request)\./i;

export const nosqlInjectionRisk = defineRule({
  id: "nosql-injection-risk",
  title: "NoSQL query accepts operator-shaped input",
  severity: "warn",
  impact: "security",
  confidence: "heuristic",
  fix: "local",
  recommendation:
    "Coerce scalar fields before querying, reject operator keys from client input, and avoid `$where` or request-derived regexes.",
  scan: scanByPattern({
    shouldScan: (file) => isProductionFilePath(file.relativePath, DATABASE_SOURCE_FILE_PATTERN),
    pattern: NOSQL_INJECTION_RISK_PATTERN,
    message: "Code appears to pass raw JSON, regex, or `$where` style input into a NoSQL query.",
  }),
});
