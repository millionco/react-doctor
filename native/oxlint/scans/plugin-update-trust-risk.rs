use lazy_regex::{Lazy, Regex, lazy_regex};

use super::{ScanFinding, get_location_at_index::get_location_at_index};

const MESSAGE: &str = "Code appears to download, install, update, or execute plugin/updater content across a trust boundary.";

static UPDATER_TRIGGER_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?-u:\b)(?:repoUrl|updateUrl|UpdateApp|InstallApp|auto[^\r\n\u{2028}\u{2029}]?updater?|installer|curl|wget)(?-u:\b)"
);
static ARTIFACT_OR_PIPE_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?:\.(?:zip|exe|dmg|appimage|msi|deb|rpm)(?-u:\b)|\.tar\.gz(?-u:\b)|\|\s*(?:bash|sh)(?-u:\b))"
);
static CHECKSUM_VERIFICATION_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)sha(?:256|512|1)sum|--checksum|checksum=|EXPECTED_SHA|gpg\s+--verify|\.sha(?:256|512)(?-u:\b)"
);
static EXECUTION_CONTEXT_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?-u:\b)(?:child_process|childProcess|execa|os\.system|subprocess\.|Deno\.run|autoUpdater|electron-updater)(?-u:\b)|(?-u:\b)(?:exec(?:File)?(?:Sync)?|spawn(?:Sync)?)\s*\("
);
static SOURCE_FILE_PATTERN: Lazy<Regex> = lazy_regex!(r"(?i)\.[cm]?[jt]sx?$");
static HTTP_URL_PATTERN: Lazy<Regex> = lazy_regex!(r"(?i)https?://");
static PIPE_TO_SHELL_PATTERN: Lazy<Regex> = lazy_regex!(r"(?i)\|\s*(?:bash|sh)(?-u:\b)");
static CURL_UPLOAD_ARGUMENT_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)^\s+(?:-T(?-u:\b)|--upload-file(?-u:\b))");

pub fn scan(relative_path: &str, source: &str) -> Vec<ScanFinding> {
    if !super::is_production_file_path::is_production_source_path(relative_path)
        && !super::security_file_path::is_trusted_boundary_config_path(relative_path)
    {
        return Vec::new();
    }
    let scannable =
        super::get_scannable_content::get_scannable_content(relative_path, source, false);
    let normalized = super::normalize_js_regex_content::normalize_js_regex_content(&scannable);
    let remote_script_index = first_remote_script_execution(normalized.as_ref());
    let updater_index = first_updater_trust_match(normalized.as_ref());
    let Some(index) = remote_script_index.or(updater_index) else {
        return Vec::new();
    };
    let normalized_path =
        super::normalize_js_regex_content::normalize_js_regex_content(relative_path);
    if CHECKSUM_VERIFICATION_PATTERN.is_match(normalized.as_ref())
        || (SOURCE_FILE_PATTERN.is_match(normalized_path.as_ref())
            && !EXECUTION_CONTEXT_PATTERN.is_match(normalized.as_ref()))
    {
        return Vec::new();
    }
    let (line, column) = get_location_at_index(source, normalized.as_ref(), index);
    vec![ScanFinding::inherited(MESSAGE, line, column)]
}

fn first_remote_script_execution(source: &str) -> Option<usize> {
    UPDATER_TRIGGER_PATTERN.find_iter(source).find_map(|found| {
        let token = found.as_str();
        if !token.eq_ignore_ascii_case("curl") && !token.eq_ignore_ascii_case("wget") {
            return None;
        }
        let command_end = continued_command_end(source, found.end());
        let command = &source[found.start()..command_end];
        (HTTP_URL_PATTERN.is_match(command) && PIPE_TO_SHELL_PATTERN.is_match(command))
            .then_some(found.start())
    })
}

fn first_updater_trust_match(source: &str) -> Option<usize> {
    UPDATER_TRIGGER_PATTERN.find_iter(source).find_map(|found| {
        if found.as_str().eq_ignore_ascii_case("curl")
            && CURL_UPLOAD_ARGUMENT_PATTERN.is_match(&source[found.end()..])
        {
            return None;
        }
        let suffix = &source[found.end()..];
        ARTIFACT_OR_PIPE_PATTERN
            .find(suffix)
            .is_some_and(|artifact| suffix[..artifact.start()].chars().count() <= 250)
            .then_some(found.start())
    })
}

fn continued_command_end(source: &str, start: usize) -> usize {
    let bytes = source.as_bytes();
    let mut cursor = start;
    while cursor < bytes.len() {
        if bytes[cursor] == b'\r' {
            let preceding_backslash = cursor > start && bytes[cursor - 1] == b'\\';
            if preceding_backslash && bytes.get(cursor + 1) == Some(&b'\n') {
                cursor += 2;
                continue;
            }
            return cursor;
        }
        if bytes[cursor] == b'\n' {
            if cursor > start && bytes[cursor - 1] == b'\\' {
                cursor += 1;
                continue;
            }
            return cursor;
        }
        cursor += 1;
    }
    source.len()
}
