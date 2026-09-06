use lazy_regex::{Lazy, Regex, lazy_regex};

use super::{ScanFinding, get_location_at_index::get_location_at_index};

const ACTIVE_SVG_MESSAGE: &str = "A browser-reachable SVG contains script or event-handler code.";
const ACTIVE_SVG_HELP: &str = "Serve untrusted SVG as downloads, sanitize it, or isolate it on a cookieless asset origin with a restrictive CSP.";
const EXECUTABLE_CONTEXT_MESSAGE: &str =
    "The app enables or embeds SVG in an executable browser context.";

static SVG_ACTIVE_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?:(?i-u:<script\b)|(?i-u:on(?:load|error|click|mouseover))[\t\n\x0B\x0C\r \u{00A0}\u{1680}\u{2000}-\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}]*=)"
);
static DANGEROUS_ALLOW_SVG_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i-u:dangerouslyAllowSVG)[\t\n\x0B\x0C\r \u{00A0}\u{1680}\u{2000}-\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}]*:[\t\n\x0B\x0C\r \u{00A0}\u{1680}\u{2000}-\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}]*(?i-u:true)"
);
static EXECUTABLE_SVG_EMBED_PATTERN: Lazy<Regex> = lazy_regex!(
    r#"<(?i-u:(?:object|embed|iframe)\b)[^>]+(?i-u:(?:data|src))=["'][^"']+(?i-u:\.svg)(?:\?[^"']*)?["']"#
);
static CONFIG_OR_CI_PATH_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?:^|/)(?:package\.json|Dockerfile|docker-compose\.ya?ml|\.github/workflows/[^/]+\.ya?ml|vercel\.json|next\.config\.[cm]?[jt]s|netlify\.toml)$"
);

pub fn scan(relative_path: &str, source: &str, is_generated_bundle: bool) -> Vec<ScanFinding> {
    if relative_path.ends_with(".svg")
        && is_browser_artifact_path(relative_path, is_generated_bundle)
    {
        let Some(found) = SVG_ACTIVE_PATTERN.find(source) else {
            return Vec::new();
        };
        let (line, column) = get_location_at_index(source, source, found.start());
        return vec![ScanFinding {
            message: ACTIVE_SVG_MESSAGE.to_string(),
            line,
            column,
            severity: Some("error".to_string()),
            title: Some("Active SVG in public assets".to_string()),
            help: Some(ACTIVE_SVG_HELP.to_string()),
        }];
    }
    let normalized_path =
        super::normalize_js_regex_content::normalize_js_regex_content(relative_path);
    if !super::is_production_file_path::is_production_source_path(relative_path)
        && !CONFIG_OR_CI_PATH_PATTERN.is_match(&normalized_path)
    {
        return Vec::new();
    }
    let found = DANGEROUS_ALLOW_SVG_PATTERN
        .find(source)
        .or_else(|| EXECUTABLE_SVG_EMBED_PATTERN.find(source));
    let Some(found) = found else {
        return Vec::new();
    };
    let (line, column) = get_location_at_index(source, source, found.start());
    vec![ScanFinding::inherited(
        EXECUTABLE_CONTEXT_MESSAGE,
        line,
        column,
    )]
}

fn is_browser_artifact_path(relative_path: &str, is_generated_bundle: bool) -> bool {
    if is_non_shipped_build_artifact_path(relative_path) {
        return false;
    }
    is_generated_bundle
        || relative_path.ends_with(".map")
        || [
            ".next/static/",
            ".output/public/",
            "build/static/",
            "dist/assets/",
            "public/",
            "out/",
            "storybook-static/",
        ]
        .iter()
        .any(|segment| {
            relative_path.starts_with(segment) || relative_path.contains(&format!("/{segment}"))
        })
}

fn is_non_shipped_build_artifact_path(relative_path: &str) -> bool {
    let segments = relative_path.split('/').collect::<Vec<_>>();
    for (index, segment) in segments.iter().enumerate() {
        if !matches!(*segment, ".next" | ".output") {
            continue;
        }
        if *segment == ".next" && segments.get(index + 1) == Some(&"dev") {
            return true;
        }
        if segments.get(index + 1) == Some(&"server") && index + 2 < segments.len() {
            return true;
        }
    }
    false
}
