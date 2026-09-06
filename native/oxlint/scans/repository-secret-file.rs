use super::{ScanFinding, get_location_at_index::get_location_at_index};

const MESSAGE: &str = "A repository credential/config file contains secret-looking values.";

pub fn scan(relative_path: &str, source: &str) -> Vec<ScanFinding> {
    if !super::security_file_path::is_repository_secret_file_path(relative_path)
        || super::security_file_path::is_repository_secret_example_path(relative_path)
        || super::security_file_path::is_test_context_path(relative_path)
    {
        return Vec::new();
    }
    let Some(index) =
        super::security_secret_patterns::first_secret_value(source, true).or_else(|| {
            super::security_secret_patterns::first_suspicious_public_env_secret_name(source)
        })
    else {
        return Vec::new();
    };
    let (line, column) = get_location_at_index(source, source, index);
    vec![ScanFinding::inherited(MESSAGE, line, column)]
}
