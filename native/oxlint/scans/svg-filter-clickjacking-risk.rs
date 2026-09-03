use lazy_regex::{Lazy, Regex, lazy_regex};

use super::{ScanFinding, get_location_at_index::get_location_at_index};

const MESSAGE: &str = "An iframe is rendered through an SVG/CSS filter, which can support advanced clickjacking or visual exfiltration tricks.";

static SVG_FILTER_CLICKJACKING_PATTERN: Lazy<Regex> = lazy_regex!(
    r#"(?is)<iframe(?-u:\b)(?:=>|[^>]){0,300}(?-u:\b)filter\s*:\s*[\"']?url\(#|filter\s*:\s*url\(#[\s\S]{0,700}<iframe(?-u:\b)|<fe(?:DisplacementMap|ColorMatrix|Composite|Tile|Morphology)(?-u:\b)[\s\S]{0,700}<iframe(?-u:\b)"#
);

pub fn scan(relative_path: &str, source: &str) -> Vec<ScanFinding> {
    if !super::is_production_file_path::is_production_source_path(relative_path) {
        return Vec::new();
    }
    let scannable =
        super::get_scannable_content::get_scannable_content(relative_path, source, false);
    let normalized = super::normalize_js_regex_content::normalize_js_regex_content(&scannable);
    let Some(found) = SVG_FILTER_CLICKJACKING_PATTERN.find(normalized.as_ref()) else {
        return Vec::new();
    };
    let (line, column) = get_location_at_index(source, normalized.as_ref(), found.start());
    vec![ScanFinding::inherited(MESSAGE, line, column)]
}
