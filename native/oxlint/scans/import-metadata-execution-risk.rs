use lazy_regex::{Lazy, Regex, lazy_regex};

use super::{ScanFinding, get_location_at_index::get_location_at_index};

const MESSAGE: &str =
    "Imported metadata, uploads, or plugin manifests appear to reach code execution.";

static PROCESS_EVIDENCE_PATTERN: Lazy<Regex> =
    lazy_regex!(r"child_process|childProcess|execa|subprocess|Deno\.run");
static EXECUTION_CALLEE_PATTERN: Lazy<Regex> = lazy_regex!(
    r"\b(?:eval|new\s+Function|vm\.runIn[A-Za-z0-9_]*|(?:child_process|childProcess|cp)\.(?:exec|spawn)[A-Za-z0-9_]*)\s*\("
);
static BARE_EXECUTION_CALLEE_PATTERN: Lazy<Regex> =
    lazy_regex!(r"\b(?:exec(?:File)?(?:Sync)?|spawn(?:Sync)?)\s*\(");
static TAINT_PATTERN: Lazy<Regex> = lazy_regex!(
    r"\b(?:exif|metadata|manifest|preset|plugin|upload|drop(?:ped|s)?\b|archive|zip|unzip|untar)"
);

pub fn scan(relative_path: &str, source: &str) -> Vec<ScanFinding> {
    if !super::is_production_file_path::is_production_source_path(relative_path) {
        return Vec::new();
    }
    let scannable =
        super::get_scannable_content::get_scannable_content(relative_path, source, true);
    let content = super::normalize_js_regex_content::normalize_js_regex_content(&scannable);
    let mut candidates = EXECUTION_CALLEE_PATTERN
        .find_iter(&content)
        .map(|found| (found.start(), found.end()))
        .collect::<Vec<_>>();
    if PROCESS_EVIDENCE_PATTERN.is_match(source) {
        candidates.extend(
            BARE_EXECUTION_CALLEE_PATTERN
                .find_iter(&content)
                .filter_map(|found| {
                    let previous = content[..found.start()].chars().next_back();
                    (!previous.is_some_and(|character| {
                        character == '.'
                            || character == '$'
                            || character == '_'
                            || character.is_ascii_alphanumeric()
                    }))
                    .then_some((found.start(), found.end()))
                }),
        );
    }
    candidates.sort_unstable_by_key(|candidate| candidate.0);
    for (start, arguments_start) in candidates {
        let statement_end = content[arguments_start..]
            .find(';')
            .map_or(content.len(), |offset| arguments_start + offset);
        let argument_window = &content[arguments_start..statement_end];
        if TAINT_PATTERN.find_iter(argument_window).any(|found| {
            argument_window[..found.start()].chars().count() <= 200
                && is_unquoted_taint(argument_window, found.start(), found.end())
        }) {
            let (line, column) = get_location_at_index(source, &content, start);
            return vec![ScanFinding::inherited(MESSAGE, line, column)];
        }
    }
    Vec::new()
}

fn is_unquoted_taint(source: &str, start: usize, end: usize) -> bool {
    if source[..start]
        .chars()
        .next_back()
        .is_some_and(|character| matches!(character, '\'' | '"'))
    {
        return false;
    }
    let suffix = &source[end..];
    let word_end = suffix
        .char_indices()
        .find(|(_, character)| !(*character == '_' || character.is_ascii_alphanumeric()))
        .map_or(suffix.len(), |(index, _)| index);
    !suffix[word_end..]
        .chars()
        .next()
        .is_some_and(|character| matches!(character, '\'' | '"'))
}
