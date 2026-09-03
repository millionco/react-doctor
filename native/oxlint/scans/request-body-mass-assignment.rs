use lazy_regex::{Lazy, Regex, lazy_regex};

use super::{ScanFinding, get_location_at_index::get_location_at_index};

const MESSAGE: &str = "Request input is spread or merged into an object without a field allowlist, enabling mass assignment (client-set owner/role/price fields) or prototype pollution.";

static SPREAD_REQUEST_INPUT_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)\.\.\.\s*(?:(?:req|request|ctx\.req|ctx\.request)\.(?:body|query|params)|await\s+(?:req|request)\.json\(\s*\))"
);
static MERGE_REQUEST_INPUT_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?is)(?:Object\.assign\s*\(|_\.(?:merge|mergeWith|defaultsDeep)\s*\(|(?:^|[^.A-Za-z0-9_])(?:merge|defaultsDeep)\s*\().{0,80}?(?:(?:req|request|ctx\.req|ctx\.request)\.(?:body|query|params)|await\s+(?:req|request)\.json\(\s*\))"
);

pub fn scan(relative_path: &str, source: &str) -> Vec<ScanFinding> {
    if !super::is_production_file_path::is_production_source_path(relative_path) {
        return Vec::new();
    }
    let scannable =
        super::get_scannable_content::get_scannable_content(relative_path, source, false);
    let normalized = super::normalize_js_regex_content::normalize_js_regex_content(&scannable);
    let found = SPREAD_REQUEST_INPUT_PATTERN
        .find(normalized.as_ref())
        .or_else(|| MERGE_REQUEST_INPUT_PATTERN.find(normalized.as_ref()));
    let Some(found) = found else {
        return Vec::new();
    };
    let (line, column) = get_location_at_index(source, normalized.as_ref(), found.start());
    vec![ScanFinding::inherited(MESSAGE, line, column)]
}
