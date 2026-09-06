use super::{ScanFinding, get_location_at_index::get_location_at_index};

const MESSAGE: &str = "Package metadata contains secret-like values or public env secret names.";

pub fn scan(relative_path: &str, source: &str) -> Vec<ScanFinding> {
    if !relative_path.ends_with("package.json") {
        return Vec::new();
    }
    let Some(index) =
        super::security_secret_patterns::first_suspicious_public_env_secret_name(source)
            .or_else(|| super::security_secret_patterns::first_package_metadata_secret(source))
    else {
        return Vec::new();
    };
    let (line, column) = get_location_at_index(source, source, index);
    vec![ScanFinding::inherited(MESSAGE, line, column)]
}
