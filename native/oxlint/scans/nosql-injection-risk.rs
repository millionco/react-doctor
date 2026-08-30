use lazy_regex::{Lazy, Regex, lazy_regex};

use super::{ScanFinding, get_location_at_index::get_location_at_index};

const MESSAGE: &str =
    "Code appears to pass raw JSON, regex, or `$where` style input into a NoSQL query.";

static NOSQL_INJECTION_RISK_PATTERN: Lazy<Regex> = lazy_regex!(
    r#"(?i)(?:\$where\s*['"]?\s*:\s*(?:f?['"`][^'"`]{0,200}\$\{|function|f['"])|\.find\s*\(\s*JSON\.parse\s*\(\s*(?:req|request)\.|\.aggregate\s*\(\s*\[?\s*\{[^}]{0,400}\$where|(?-u:\b)new\s+RegExp\s*\(\s*(?:req|request)\.|\$regex['"]?\s*:\s*(?:req|request)\.)"#
);

pub fn scan(relative_path: &str, source: &str) -> Vec<ScanFinding> {
    if !super::is_production_file_path::is_production_database_source_path(relative_path) {
        return Vec::new();
    }
    let comment_stripped =
        super::strip_comments_preserving_positions::strip_comments_preserving_positions(source);
    let scannable =
        super::normalize_js_regex_content::normalize_js_regex_content(&comment_stripped);
    let Some(found) = NOSQL_INJECTION_RISK_PATTERN.find(&scannable) else {
        return Vec::new();
    };
    let (line, column) = get_location_at_index(source, &scannable, found.start());
    vec![ScanFinding::inherited(MESSAGE, line, column)]
}

#[cfg(test)]
mod tests {
    use super::scan;

    #[test]
    fn matches_ecmascript_whitespace_but_not_unicode_only_whitespace() {
        let with_byte_order_mark = "collection.find\u{FEFF}(JSON.parse(request.body))";
        let with_next_line = "collection.find\u{0085}(JSON.parse(request.body))";

        assert_eq!(scan("src/database.ts", with_byte_order_mark).len(), 1);
        assert!(scan("src/database.ts", with_next_line).is_empty());
    }
}
