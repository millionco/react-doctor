use lazy_regex::Regex;

use super::{ScanFinding, get_location_at_index::get_location_at_index};

pub fn first_pattern_finding(
    original_source: &str,
    scannable_source: &str,
    patterns: &[&Regex],
    message: &str,
) -> Vec<ScanFinding> {
    let Some(found) = patterns
        .iter()
        .find_map(|pattern| pattern.find(scannable_source))
    else {
        return Vec::new();
    };
    let (line, column) = get_location_at_index(original_source, scannable_source, found.start());
    vec![ScanFinding::inherited(message, line, column)]
}
