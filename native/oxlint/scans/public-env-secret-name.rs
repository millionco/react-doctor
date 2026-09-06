use super::{ScanFinding, get_location_at_index::get_location_at_index};

const MESSAGE: &str = "Client code references a public env variable whose name looks like a secret or privileged credential.";

pub fn scan(relative_path: &str, source: &str) -> Vec<ScanFinding> {
    let normalized_path =
        super::normalize_js_regex_content::normalize_js_regex_content(relative_path);
    if !super::is_client_source_path::is_client_source_path(relative_path)
        || lazy_regex::regex_is_match!(r"(?i)(?:^|/)docs?/", normalized_path.as_ref())
    {
        return Vec::new();
    }
    let Some(index) =
        super::security_secret_patterns::first_suspicious_public_env_secret_name(source)
    else {
        return Vec::new();
    };
    let (line, column) = get_location_at_index(source, source, index);
    vec![ScanFinding::inherited(MESSAGE, line, column)]
}
