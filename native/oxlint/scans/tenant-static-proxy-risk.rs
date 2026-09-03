use lazy_regex::{Lazy, Regex, lazy_regex};

use super::{ScanFinding, get_location_at_index::get_location_at_index};

const MESSAGE: &str = "Route code appears to compose tenant or subdomain input into a static/CDN/object-store fetch path.";

static TENANT_STATIC_PROXY_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?is)(?-u:\b)(?:fetch|path\.join|getObject[A-Za-z0-9_]*|GetObjectCommand|getSignedUrl|createReadStream)\s*\([^;]{0,200}(?:\$\{(?:[^}]{0,100}(?-u:\b)(?:tenant|subdomain|workspace|hostPattern)(?-u:\b)|organization(?:Id|Slug)?(?-u:\b)|[^}]{0,99}[^.A-Za-z0-9_]organization(?:Id|Slug)?(?-u:\b))|(?-u:\b)(?:tenant|subdomain|workspace)(?:Id|Slug|Name)?(?-u:\b)\s*[,)+\].])"
);

pub fn scan(relative_path: &str, source: &str) -> Vec<ScanFinding> {
    if !super::security_file_path::is_server_route_source_path(relative_path) {
        return Vec::new();
    }
    let scannable =
        super::get_scannable_content::get_scannable_content(relative_path, source, false);
    let normalized = super::normalize_js_regex_content::normalize_js_regex_content(&scannable);
    let Some(found) = TENANT_STATIC_PROXY_PATTERN.find(normalized.as_ref()) else {
        return Vec::new();
    };
    let (line, column) = get_location_at_index(source, normalized.as_ref(), found.start());
    vec![ScanFinding::inherited(MESSAGE, line, column)]
}
