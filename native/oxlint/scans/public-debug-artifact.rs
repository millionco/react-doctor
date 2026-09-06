use super::ScanFinding;

const MESSAGE: &str = "A browser-reachable debug, log, dump, report, or env artifact is present.";

pub fn scan(relative_path: &str, source: &str) -> Vec<ScanFinding> {
    if !super::security_file_path::is_public_debug_artifact_path(relative_path) {
        return Vec::new();
    }
    let mut finding = ScanFinding::inherited(MESSAGE, 1, 1);
    if super::security_secret_patterns::first_secret_value(source, true).is_some() {
        finding.severity = Some("error".to_string());
    }
    vec![finding]
}
