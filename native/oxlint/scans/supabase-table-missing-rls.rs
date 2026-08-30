use lazy_regex::{Lazy, Regex, lazy_regex};
use rustc_hash::FxHashMap;

use super::{
    ScanFinding, get_location_at_index::get_location_at_index,
    sanitize_sql_for_scan::sanitize_sql_for_scan,
};

const MESSAGE: &str = "Supabase migration creates a public table but never enables Row Level Security, leaving every row exposed to the anon key.";

static CREATE_TABLE_PREFILTER_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)create\s+(?:unlogged\s+)?table");
static CREATE_TABLE_PATTERN: Lazy<Regex> = lazy_regex!(
    r#"(?i)create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:(["`]?[A-Za-z_][A-Za-z0-9_$]*["`]?)\s*\.\s*)?(["`]?[A-Za-z_][A-Za-z0-9_$]*["`]?)\s*(?:\(|as(?-u:\b))"#
);
static ENABLE_RLS_PATTERN: Lazy<Regex> = lazy_regex!(
    r#"(?i)alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:(["`]?[A-Za-z_][A-Za-z0-9_$]*["`]?)\s*\.\s*)?(["`]?[A-Za-z_][A-Za-z0-9_$]*["`]?)\s+(?:force\s+)?enable\s+row\s+level\s+security"#
);
static ENABLE_RLS_KEYWORD_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i-u:\benable\s+row\s+level\s+security\b)");

pub fn scan(relative_path: &str, source: &str) -> Vec<ScanFinding> {
    if !is_supabase_migration_path(relative_path) {
        return Vec::new();
    }
    let sanitized = sanitize_sql_for_scan(source);
    if !CREATE_TABLE_PREFILTER_PATTERN.is_match(&sanitized) {
        return Vec::new();
    }

    let mut last_enable_index_by_table = FxHashMap::default();
    let mut static_enable_count = 0;
    for captures in ENABLE_RLS_PATTERN.captures_iter(&sanitized) {
        let Some(full_match) = captures.get(0) else {
            continue;
        };
        let schema = captures.get(1).map(|capture| sql_name(capture.as_str()));
        if schema.as_deref().is_some_and(|name| name != "public") {
            continue;
        }
        let Some(table) = captures.get(2) else {
            continue;
        };
        static_enable_count += 1;
        last_enable_index_by_table.insert(sql_name(table.as_str()), full_match.start());
    }
    if ENABLE_RLS_KEYWORD_PATTERN.find_iter(&sanitized).count() > static_enable_count {
        return Vec::new();
    }

    let mut findings = Vec::new();
    for captures in CREATE_TABLE_PATTERN.captures_iter(&sanitized) {
        let Some(full_match) = captures.get(0) else {
            continue;
        };
        let schema = captures.get(1).map(|capture| sql_name(capture.as_str()));
        if schema.as_deref().is_some_and(|name| name != "public") {
            continue;
        }
        let Some(table) = captures.get(2) else {
            continue;
        };
        if last_enable_index_by_table
            .get(&sql_name(table.as_str()))
            .is_some_and(|enable_index| *enable_index >= full_match.start())
        {
            continue;
        }
        let (line, column) = get_location_at_index(source, &sanitized, full_match.start());
        findings.push(ScanFinding::inherited(MESSAGE, line, column));
    }
    findings
}

fn is_supabase_migration_path(relative_path: &str) -> bool {
    ["supabase/migrations/", "supabase/schemas/"].iter().any(|segment| {
        relative_path.starts_with(segment) || relative_path.contains(&format!("/{segment}"))
    })
}

fn sql_name(name: &str) -> String {
    name.trim_matches(['"', '`']).to_ascii_lowercase()
}
