import { defineRule } from "../../utils/define-rule.js";
import { isDevToolingPath } from "./utils/is-dev-tooling-path.js";
import { isProductionSourcePath } from "./utils/is-production-source-path.js";
import { scanByPattern } from "./utils/scan-by-pattern.js";

// `(?<![-./\w$'"`])` keeps taint accessors that merely appear inside string
// literals (`path.resolve(__dirname, 'render-query.js')`, the static path
// segment `"public/body.html"`, or a backtick suffix `` `${dir}/query.sql` ``)
// from counting — a path separator `/` and backtick must NOT precede a real
// taint read (`req.`/`params.` are bare code preceded by `(`, `,`, space, `=`).
// `(?<!basename\(\s{0,4})` skips the standard traversal sanitizer
// `path.join(base, path.basename(req.params.file))` — `path.basename()` strips
// every directory component, so the join cannot escape `base`.
const PATH_TRAVERSAL_RISK_PATTERN =
  /\b(?:readFile|readFileSync|writeFile|writeFileSync)\s*\(\s*(?:req\.|request\.|params\.|query\.|body\.|parsed\.|`[^`]*(?<![-./\w$'"`])(?:req\.|request\.|params\.|query\.|body\.))|\bpath\.(?:join|resolve)\s*\([^)]*(?<![-./\w$'"`])(?<!basename\(\s{0,4})(?:req\.|request\.|params\.|query\.|body\.|parsed\.)/;

export const pathTraversalRisk = defineRule({
  id: "path-traversal-risk",
  title: "Filesystem path uses caller input",
  severity: "warn",
  recommendation:
    "Resolve paths against a fixed base directory, reject traversal after normalization, and map user-visible identifiers to server-owned paths.",
  scan: scanByPattern({
    shouldScan: (file) =>
      isProductionSourcePath(file.relativePath) && !isDevToolingPath(file.relativePath),
    pattern: PATH_TRAVERSAL_RISK_PATTERN,
    message:
      "Filesystem access appears to use request, query, params, or body data as part of the path.",
  }),
});
