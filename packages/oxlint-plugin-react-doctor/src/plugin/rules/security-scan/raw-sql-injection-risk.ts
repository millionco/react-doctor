import { defineRule } from "../../utils/define-rule.js";
import { isProductionScriptSourcePath } from "./utils/is-production-script-source-path.js";
import { scanByPattern } from "./utils/scan-by-pattern.js";

// `Prisma.raw("AND ")` (pure literal) and `whereRaw("col = {p: String}", {p})`
// (driver-side binding) are parameterized usage, not string-built SQL — the
// escape hatch only matters when the argument is dynamic. The `${` check
// skips interpolations wrapped in a sanitizer/escaper call.
const RAW_SQL_RISK_PATTERNS = [
  /\$queryRawUnsafe\s*\(/,
  /\$executeRawUnsafe\s*\(/,
  /\bPrisma\.raw\s*\((?!\s*(?:["'][^"'\n]*["']\s*[,)]|`[^`$]*`))/,
  /\bsql\.\s*(?:raw|unsafe)\s*\((?!\s*(?:["'][^"'\n]*["']\s*[,)]|`[^`$]*`))/,
  /\b(?:client|pool|conn)\.query\s*\(\s*['"`]\s*(?:SELECT|INSERT|UPDATE|DELETE)\b[^)]{0,400}\$\{(?!\s*[\w$.]*(?:sanitiz|escape|quote)[\w$]*\s*\()/i,
  /\.query\s*\(\s*['"`][^'"`]{0,200}['"`]\s*\+/,
  /\.(?:where|orderBy|having)Raw\s*\((?!\s*(?:["'][^"'\n]*["']\s*[,)]|`[^`$]*`))/,
  /\bcursor\.execute\s*\(\s*f['"]/,
  /\bcursor\.execute\s*\(\s*(?:"[^"]{0,400}"|'[^']{0,400}')\s*(?:%|\.format\s*\(|\+)/,
  /\b(?:engine|session)\.execute\s*\(\s*(?:text\s*\(\s*)?f['"]/,
  /\$[\w]+->(?:query|exec|prepare|executeQuery|executeStatement|createQuery|createNativeQuery)\s*\(\s*(?:"[^"]{0,400}"|'[^']{0,400}')\s*\.\s*\$/,
  /mysqli_query\s*\(\s*[^,]+,\s*(?:"[^"]{0,400}"|'[^']{0,400}')\s*\.\s*\$/,
] as const;

export const rawSqlInjectionRisk = defineRule({
  id: "raw-sql-injection-risk",
  title: "Raw SQL built outside parameter binding",
  severity: "warn",
  recommendation:
    "Keep user input in driver parameters or ORM bind variables. Avoid unsafe/raw SQL helpers and string interpolation for queries.",
  scan: scanByPattern({
    shouldScan: (file) => isProductionScriptSourcePath(file.relativePath),
    pattern: RAW_SQL_RISK_PATTERNS,
    message:
      "Code uses a raw SQL escape hatch or string-built query shape that can bypass parameter binding.",
  }),
});
