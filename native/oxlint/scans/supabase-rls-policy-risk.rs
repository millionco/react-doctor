use lazy_regex::{Lazy, Regex, lazy_regex};

use super::{
    ScanFinding, get_location_at_index::get_location_at_index,
    sanitize_sql_for_scan::sanitize_sql_for_scan,
};

const MESSAGE: &str = "Supabase policy SQL disables RLS, permits writes broadly, or references a service-role bypass.";

static DISABLED_RLS_PATTERN: Lazy<Regex> = lazy_regex!(r"(?i)disable\s+row\s+level\s+security");
static SERVICE_ROLE_BODY_BYPASS_PATTERN: Lazy<Regex> =
    lazy_regex!(r#"(?i)auth\.role\(\)\s*=\s*["']service_role["']"#);
static CREATE_POLICY_PATTERN: Lazy<Regex> = lazy_regex!(r"(?i)create\s+policy");
static STATEMENT_END_PATTERN: Lazy<Regex> = lazy_regex!(r"(?i);|create\s+policy");
static PERMISSIVE_TRUE_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)(?-u:\b)(?:using|with\s+check)\s*\(\s*true\s*\)");
static FOR_SELECT_PATTERN: Lazy<Regex> = lazy_regex!(r"(?i)(?-u:\b)for\s+select(?-u:\b)");
static TO_CLAUSE_START_PATTERN: Lazy<Regex> = lazy_regex!(r"(?i)(?-u:\b)to\s+");
static TO_CLAUSE_END_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)\s+(?:using|with\s+check|as|for)(?-u:\b)|;");

pub fn scan(relative_path: &str, source: &str) -> Vec<ScanFinding> {
    if !relative_path.ends_with(".sql") && !is_supabase_migration_path(relative_path) {
        return Vec::new();
    }

    let sanitized = sanitize_sql_for_scan(source);
    let scannable = super::normalize_js_regex_content::normalize_js_regex_content(&sanitized);
    let normalized_source = super::normalize_js_regex_content::normalize_js_regex_content(source);
    let mut earliest_risk_index = DISABLED_RLS_PATTERN
        .find(&scannable)
        .map(|risk_match| risk_match.start());

    for policy_match in CREATE_POLICY_PATTERN.find_iter(&scannable) {
        let after_keyword = policy_match.end();
        let statement_end = STATEMENT_END_PATTERN
            .find(&scannable[after_keyword..])
            .map_or(scannable.len(), |terminator| {
                after_keyword + terminator.start()
            });
        if !is_risky_policy_statement(
            &scannable[policy_match.start()..statement_end],
            &normalized_source[policy_match.start()..statement_end],
        ) {
            continue;
        }
        if earliest_risk_index.is_none_or(|risk_index| policy_match.start() < risk_index) {
            earliest_risk_index = Some(policy_match.start());
        }
        break;
    }

    let Some(risk_index) = earliest_risk_index else {
        return Vec::new();
    };
    let (line, column) = get_location_at_index(source, &scannable, risk_index);
    vec![ScanFinding::inherited(MESSAGE, line, column)]
}

fn is_risky_policy_statement(statement: &str, raw_statement: &str) -> bool {
    if SERVICE_ROLE_BODY_BYPASS_PATTERN.is_match(raw_statement) {
        return true;
    }
    PERMISSIVE_TRUE_PATTERN.is_match(statement)
        && !FOR_SELECT_PATTERN.is_match(statement)
        && !is_server_only_scoped(statement)
}

fn is_server_only_scoped(statement: &str) -> bool {
    let Some(to_clause_start) = TO_CLAUSE_START_PATTERN.find(statement) else {
        return false;
    };
    let roles_start = to_clause_start.end();
    let roles_end = TO_CLAUSE_END_PATTERN
        .find(&statement[roles_start..])
        .map_or(statement.len(), |terminator| {
            roles_start + terminator.start()
        });
    let mut roles = statement[roles_start..roles_end]
        .split(',')
        .map(|role| {
            role.trim()
                .replace(['"', '\'', '`'], "")
                .to_ascii_lowercase()
        })
        .filter(|role| !role.is_empty())
        .peekable();
    roles.peek().is_some()
        && roles.all(|role| {
            matches!(
                role.as_str(),
                "service_role" | "postgres" | "supabase_admin"
            )
        })
}

fn is_supabase_migration_path(relative_path: &str) -> bool {
    ["supabase/migrations/", "supabase/schemas/"]
        .iter()
        .any(|segment| {
            relative_path.starts_with(segment) || relative_path.contains(&format!("/{segment}"))
        })
}

#[cfg(test)]
mod tests {
    use super::scan;

    #[test]
    fn matches_ecmascript_whitespace_but_not_unicode_only_whitespace() {
        let with_byte_order_mark = "alter table notes disable\u{FEFF}row level security;";
        let with_next_line = "alter table notes disable\u{0085}row level security;";

        assert_eq!(scan("migration.sql", with_byte_order_mark).len(), 1);
        assert!(scan("migration.sql", with_next_line).is_empty());
    }
}
