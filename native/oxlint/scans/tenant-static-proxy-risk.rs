use lazy_regex::{Lazy, Regex, lazy_regex};

use super::{
    ScanFinding, get_location_at_index::get_location_at_index, scan_content::ScanContent,
};

const MESSAGE: &str = "Route code appears to compose tenant or subdomain input into a static/CDN/object-store fetch path.";

static TENANT_STATIC_PROXY_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?is)(?-u:\b)(?:fetch|path\.join|getObject[A-Za-z0-9_]*|GetObjectCommand|getSignedUrl|createReadStream)\s*\([^;]{0,200}(?:\$\{(?:[^}]{0,100}(?-u:\b)(?:tenant|subdomain|workspace|hostPattern)(?-u:\b)|organization(?:Id|Slug)?(?-u:\b)|[^}]{0,99}[^.A-Za-z0-9_]organization(?:Id|Slug)?(?-u:\b))|(?-u:\b)(?:tenant|subdomain|workspace)(?:Id|Slug|Name)?(?-u:\b)\s*[,)+\].])"
);

pub fn scan(relative_path: &str, source: &ScanContent<'_>) -> Vec<ScanFinding> {
    if !super::security_file_path::is_server_route_source_path(relative_path) {
        return Vec::new();
    }
    let normalized = source.normalized_scannable(false);
    let Some(found) = TENANT_STATIC_PROXY_PATTERN.find(normalized.as_ref()) else {
        return Vec::new();
    };
    let (line, column) = get_location_at_index(source, normalized.as_ref(), found.start());
    vec![ScanFinding::inherited(MESSAGE, line, column)]
}
