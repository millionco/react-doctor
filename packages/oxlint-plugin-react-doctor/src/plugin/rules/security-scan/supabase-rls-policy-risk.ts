import { defineRule } from "../../utils/define-rule.js";
import { isSqlPath } from "./utils/is-sql-path.js";
import { scanByPattern } from "./utils/scan-by-pattern.js";

// Roles a browser client can never assume, so a permissive `using/with check
// (true)` policy scoped to one of them is server-only hardening, not a public
// bypass. `anon` and `authenticated` are deliberately excluded: both are
// reachable from the browser via a JWT, so `(true)` scoped to them grants
// write-anything to untrusted callers and must still be flagged (issue #910).
const SERVER_ONLY_RLS_ROLES = ["service_role", "postgres", "supabase_admin"];
const SERVER_ONLY_ROLE_SCOPE = new RegExp(
  `(?<!\\bto\\s+(?:${SERVER_ONLY_RLS_ROLES.join("|")})\\s+)`,
);
const PERMISSIVE_CHECK_PATTERN = /\b(?:using|with\s+check)\s*\(\s*true\s*\)/;

const DISABLED_RLS_PATTERN = /(?<!if\s+exists\s+[\w.]+\s+)disable\s+row\s+level\s+security/i;

const SERVICE_ROLE_POLICY_PATTERN =
  /create\s+policy[\s\S]{0,700}auth\.role\(\)\s*=\s*["']service_role["']/i;

const OPEN_WRITE_POLICY_PATTERN = new RegExp(
  /create\s+policy[\s\S]{0,700}\bfor\s+(?:all|insert|update|delete)\b[\s\S]{0,500}/.source +
    SERVER_ONLY_ROLE_SCOPE.source +
    PERMISSIVE_CHECK_PATTERN.source,
  "i",
);

const IMPLICIT_OPEN_POLICY_PATTERN = new RegExp(
  /create\s+policy(?:(?!\bfor\s+select\b)[\s\S]){0,700}/.source +
    SERVER_ONLY_ROLE_SCOPE.source +
    PERMISSIVE_CHECK_PATTERN.source,
  "i",
);

export const supabaseRlsPolicyRisk = defineRule({
  id: "supabase-rls-policy-risk",
  title: "Permissive Supabase RLS policy",
  severity: "error",
  recommendation:
    "Keep public-read policies explicit, but gate inserts, updates, deletes, and service-role bypasses behind `auth.uid()` plus trusted tenant membership.",
  scan: scanByPattern({
    shouldScan: (file) => isSqlPath(file.relativePath),
    pattern: [
      DISABLED_RLS_PATTERN,
      SERVICE_ROLE_POLICY_PATTERN,
      OPEN_WRITE_POLICY_PATTERN,
      IMPLICIT_OPEN_POLICY_PATTERN,
    ],
    message:
      "Supabase policy SQL disables RLS, permits writes broadly, or references a service-role bypass.",
  }),
});
