import { defineRule } from "../../utils/define-rule.js";
import type { ScanFinding } from "../../utils/file-scan.js";
import { getLocationAtIndex } from "./utils/get-location-at-index.js";
import { isSqlPath } from "./utils/is-sql-path.js";
import { sanitizeSqlForScan } from "./utils/sanitize-sql-for-scan.js";

const DISABLED_RLS_PATTERN = /disable\s+row\s+level\s+security/i;

// A runtime `auth.role() = 'service_role'` check in a policy body lets any
// caller able to reach that role bypass the policy — a genuine bypass, distinct
// from a `TO service_role` grant (server-only scoping, handled below).
const SERVICE_ROLE_BODY_BYPASS_PATTERN = /auth\.role\(\)\s*=\s*["']service_role["']/i;

const CREATE_POLICY_PATTERN = /create\s+policy/gi;
const STATEMENT_END_PATTERN = /;|create\s+policy/i;
const PERMISSIVE_TRUE_PATTERN = /\b(?:using|with\s+check)\s*\(\s*true\s*\)/i;
const FOR_SELECT_PATTERN = /\bfor\s+select\b/i;
const TO_CLAUSE_PATTERN = /\bto\s+([\s\S]+?)(?=\s+(?:using|with\s+check|as|for)\b|;|$)/i;

// Roles a browser client can never assume; a permissive `(true)` policy scoped
// only to these is server-only hardening, not a public bypass. `anon` /
// `authenticated` are excluded — both are reachable from the browser via a JWT,
// so a `(true)` policy granted to them stays flagged (issue #910).
const SERVER_ONLY_ROLES = new Set(["service_role", "postgres", "supabase_admin"]);

// True when the policy's `TO` clause names only server-only roles. No `TO`
// clause means the policy applies to PUBLIC (every role), so it is NOT
// server-only; nor is a list mixing in a client role (`service_role, authenticated`).
const isServerOnlyScoped = (statement: string): boolean => {
  const toClause = TO_CLAUSE_PATTERN.exec(statement);
  if (toClause === null) return false;
  const roles = toClause[1]
    .split(",")
    .map((role) => role.trim().replace(/["'`]/g, "").toLowerCase())
    .filter(Boolean);
  return roles.length > 0 && roles.every((role) => SERVER_ONLY_ROLES.has(role));
};

// A `create policy` statement that opens writes to untrusted callers: a `(true)`
// predicate on a non-read policy (`for all/insert/update/delete`, or no `for`,
// which defaults to ALL) that isn't scoped to server-only roles, or a runtime
// service-role bypass in its body. The bypass is matched on the RAW statement
// because its `'service_role'` is a string literal the SQL sanitizer blanks;
// the statement was still reached via the sanitized scan, so a commented-out
// policy never gets here.
const isRiskyPolicyStatement = (statement: string, rawStatement: string): boolean => {
  if (SERVICE_ROLE_BODY_BYPASS_PATTERN.test(rawStatement)) return true;
  if (!PERMISSIVE_TRUE_PATTERN.test(statement)) return false;
  if (FOR_SELECT_PATTERN.test(statement)) return false;
  return !isServerOnlyScoped(statement);
};

const POLICY_RISK_MESSAGE =
  "Supabase policy SQL disables RLS, permits writes broadly, or references a service-role bypass.";

export const supabaseRlsPolicyRisk = defineRule({
  id: "supabase-rls-policy-risk",
  title: "Permissive Supabase RLS policy",
  severity: "error",
  recommendation:
    "Keep public-read policies explicit, but gate inserts, updates, deletes, and service-role bypasses behind `auth.uid()` plus trusted tenant membership.",
  // Statement-scoped: a `TO service_role` hardening policy in the same file as a
  // genuinely-open one must not suppress the real finding. SQL comments / string
  // literals are blanked first (offsets preserved) so commented-out or quoted
  // policy SQL can't false-match. Cross-migration table state isn't tracked
  // (per-file scan), so an `alter table if exists … disable rls` cleanup of an
  // already-dropped table is conservatively flagged — a false positive is
  // preferable to silencing RLS-disable on a live table (#910 #1/#3, deferred).
  scan: (file) => {
    if (!isSqlPath(file.relativePath)) return [];
    const content = sanitizeSqlForScan(file.content);

    let earliestRiskIndex = content.search(DISABLED_RLS_PATTERN);

    CREATE_POLICY_PATTERN.lastIndex = 0;
    for (
      let policyMatch = CREATE_POLICY_PATTERN.exec(content);
      policyMatch !== null;
      policyMatch = CREATE_POLICY_PATTERN.exec(content)
    ) {
      const afterKeyword = policyMatch.index + policyMatch[0].length;
      const terminatorOffset = content.slice(afterKeyword).search(STATEMENT_END_PATTERN);
      const statementEnd = terminatorOffset < 0 ? content.length : afterKeyword + terminatorOffset;
      const isRisky = isRiskyPolicyStatement(
        content.slice(policyMatch.index, statementEnd),
        file.content.slice(policyMatch.index, statementEnd),
      );
      if (!isRisky) continue;
      if (earliestRiskIndex < 0 || policyMatch.index < earliestRiskIndex) {
        earliestRiskIndex = policyMatch.index;
      }
      break;
    }

    if (earliestRiskIndex < 0) return [];
    const { line, column } = getLocationAtIndex(content, earliestRiskIndex);
    const finding: ScanFinding = { message: POLICY_RISK_MESSAGE, line, column };
    return [finding];
  },
});
