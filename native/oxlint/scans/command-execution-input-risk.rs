use lazy_regex::{Lazy, Regex, lazy_regex};

use super::{ScanFinding, get_location_at_index::get_location_at_index};

const MESSAGE: &str =
    "Command execution appears to include request, query, body, or shell-interpolated input.";

static SHELL_EXEC_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)\b(?:exec(?:Sync)?|system|passthru|proc_open|shell_exec|os\.system|subprocess\.(?:run|Popen|call)|(?:child_process|childProcess|cp)\.exec[A-Za-z0-9_]*)\s*\("
);
static SPAWN_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)\b(?:spawn(?:Sync)?|(?:child_process|childProcess|cp)\.spawn[A-Za-z0-9_]*)\s*\("
);
static REQUEST_TAINT_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?:req\.|request\.|params\.|query\.|body\.|searchParams|\$_(?:GET|POST|REQUEST))"
);
static PYTHON_SHELL_TRUE_PATTERN: Lazy<Regex> = lazy_regex!(r"(?i)shell\s*=\s*true");
static ANY_SHELL_TRUE_PATTERN: Lazy<Regex> = lazy_regex!(r"(?i)shell\s*[:=]\s*true");
static PYTHON_F_STRING_PATTERN: Lazy<Regex> = lazy_regex!(r#"(?i)f['"`][^'"`]*\{"#);
static SHELL_COMMAND_PATTERN: Lazy<Regex> = lazy_regex!(
    r#"(?i)^\s*['"](?:sh|bash|zsh|dash|ksh|cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh)['"]\s*,\s*\[\s*['"](?:-c|/c|-Command)['"]\s*,"#
);

pub fn scan(relative_path: &str, source: &str) -> Vec<ScanFinding> {
    if !super::is_production_file_path::is_production_script_source_path(relative_path) {
        return Vec::new();
    }
    if super::security_file_path::is_dev_tooling_path(relative_path) {
        return Vec::new();
    }
    let scannable =
        super::get_scannable_content::get_scannable_content(relative_path, source, false);
    let content = super::normalize_js_regex_content::normalize_js_regex_content(&scannable);
    for found in SHELL_EXEC_PATTERN.find_iter(&content) {
        if is_disallowed_bare_method(&content, found.start(), found.as_str()) {
            continue;
        }
        let call = call_arguments(&content, found.end());
        let bounded_call = prefix_by_character_count(call, 220);
        if REQUEST_TAINT_PATTERN.is_match(bounded_call)
            || PYTHON_SHELL_TRUE_PATTERN.is_match(bounded_call)
            || PYTHON_F_STRING_PATTERN.is_match(bounded_call)
        {
            let (line, column) = get_location_at_index(source, &content, found.start());
            return vec![ScanFinding::inherited(MESSAGE, line, column)];
        }
    }
    for found in SPAWN_PATTERN.find_iter(&content) {
        if is_disallowed_bare_method(&content, found.start(), found.as_str()) {
            continue;
        }
        let argument_tail = &content[found.end()..];
        let call = call_arguments(&content, found.end());
        let first_argument_end = call
            .find(|character| matches!(character, ',' | ')'))
            .unwrap_or(call.len());
        let first_argument_is_tainted = REQUEST_TAINT_PATTERN
            .find(&call[..first_argument_end])
            .is_some_and(|taint| call[..taint.start()].chars().count() <= 120);
        let shell_command_is_tainted =
            SHELL_COMMAND_PATTERN
                .find(argument_tail)
                .is_some_and(|command| {
                    let array_end = argument_tail[command.end()..]
                        .find(']')
                        .map_or(argument_tail.len(), |offset| command.end() + offset);
                    REQUEST_TAINT_PATTERN
                        .find(&argument_tail[command.end()..array_end])
                        .is_some_and(|taint| {
                            argument_tail[command.end()..command.end() + taint.start()]
                                .chars()
                                .count()
                                <= 220
                        })
                });
        let bounded_call = prefix_by_character_count(call, 220);
        let enabled_shell_is_tainted = ANY_SHELL_TRUE_PATTERN.is_match(bounded_call)
            && REQUEST_TAINT_PATTERN.is_match(bounded_call);
        if first_argument_is_tainted || shell_command_is_tainted || enabled_shell_is_tainted {
            let (line, column) = get_location_at_index(source, &content, found.start());
            return vec![ScanFinding::inherited(MESSAGE, line, column)];
        }
    }
    Vec::new()
}

fn call_arguments(content: &str, arguments_start: usize) -> &str {
    let tail = &content[arguments_start..];
    let close = tail.find(')').unwrap_or(tail.len());
    &tail[..close]
}

fn prefix_by_character_count(source: &str, limit: usize) -> &str {
    let bounded_end = source
        .char_indices()
        .nth(limit)
        .map_or(source.len(), |(index, _)| index);
    &source[..bounded_end]
}

fn is_disallowed_bare_method(content: &str, start: usize, matched: &str) -> bool {
    let is_bare = !matched.contains('.');
    if !is_bare {
        return false;
    }
    content[..start]
        .chars()
        .next_back()
        .is_some_and(|character| {
            character == '.'
                || character == '$'
                || character == '_'
                || character.is_ascii_alphanumeric()
        })
}
