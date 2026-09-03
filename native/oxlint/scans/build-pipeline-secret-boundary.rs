use lazy_regex::{Lazy, Regex, lazy_regex};

use super::{ScanFinding, get_location_at_index::get_location_at_index};

const MESSAGE: &str = "The build or install pipeline can execute package lifecycle code while CI secrets may be present.";

static WORKFLOW_PATH_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)(?:^|/)\.github/workflows/[^/]+\.ya?ml$");
static INSTALL_PATTERN: Lazy<Regex> = lazy_regex!(r"(?i)(?:npm|pnpm|yarn|bun)\s+(?:install|ci)\b");
static SECRET_PATTERN: Lazy<Regex> = lazy_regex!(r"\bsecrets\.[A-Z0-9_]+");
static IGNORE_SCRIPTS_PATTERN: Lazy<Regex> = lazy_regex!(r"--ignore-scripts\b");
static STEPS_KEY_PATTERN: Lazy<Regex> = lazy_regex!(r"^steps:\s*(?:#.*)?$");
static NON_WORKFLOW_SECRET_PATTERN: Lazy<Regex> = lazy_regex!(r"(?i)\bsecrets\.[A-Z0-9_]+");
static NON_WORKFLOW_IGNORE_SCRIPTS_PATTERN: Lazy<Regex> = lazy_regex!(r"(?i)--ignore-scripts\b");

pub fn scan(relative_path: &str, source: &str) -> Vec<ScanFinding> {
    let normalized_path =
        super::normalize_js_regex_content::normalize_js_regex_content(relative_path);
    if WORKFLOW_PATH_PATTERN.is_match(&normalized_path) {
        let content = super::normalize_js_regex_content::normalize_js_regex_content(source);
        return scan_workflow(&content);
    }
    if !super::is_config_or_ci_path::is_config_or_ci_path(relative_path)
        || relative_path.ends_with("package.json")
    {
        return Vec::new();
    }
    let scannable =
        super::get_scannable_content::get_scannable_content(relative_path, source, false);
    let content = super::normalize_js_regex_content::normalize_js_regex_content(&scannable);
    scan_non_workflow(source, &content)
}

fn scan_workflow(content: &str) -> Vec<ScanFinding> {
    let lines = content.split('\n').collect::<Vec<_>>();
    let mut shared_scope = String::new();
    let mut steps = Vec::<(usize, Vec<&str>)>::new();
    let mut steps_key_indent = None;
    let mut step_item_indent = None;
    let mut current_step_index = None;

    for (line_index, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let trimmed_start = line.len() - line.trim_start().len();
        let indent = line[..trimmed_start].chars().count();
        if steps_key_indent.is_some_and(|steps_indent| indent <= steps_indent) {
            steps_key_indent = None;
            step_item_indent = None;
            current_step_index = None;
        }
        if steps_key_indent.is_none() {
            if STEPS_KEY_PATTERN.is_match(trimmed) {
                steps_key_indent = Some(indent);
            } else {
                shared_scope.push_str(line);
                shared_scope.push('\n');
            }
            continue;
        }
        let starts_step = trimmed == "-" || trimmed.starts_with("- ");
        if starts_step && step_item_indent.is_none_or(|step_indent| indent == step_indent) {
            step_item_indent = Some(indent);
            steps.push((line_index, vec![line]));
            current_step_index = Some(steps.len() - 1);
        } else if let Some(index) = current_step_index {
            steps[index].1.push(line);
        } else {
            shared_scope.push_str(line);
            shared_scope.push('\n');
        }
    }

    let shared_scope_has_secret = SECRET_PATTERN.is_match(&shared_scope);
    for (start_line_index, step_lines) in steps {
        let step_text = step_lines.join("\n");
        if !INSTALL_PATTERN.is_match(&step_text)
            || IGNORE_SCRIPTS_PATTERN.is_match(&step_text)
            || (!shared_scope_has_secret && !SECRET_PATTERN.is_match(&step_text))
        {
            continue;
        }
        let line_offset = step_lines
            .iter()
            .position(|line| INSTALL_PATTERN.is_match(line))
            .unwrap_or(0);
        let column = INSTALL_PATTERN
            .find(step_lines[line_offset])
            .map_or(1, |found| {
                step_lines[line_offset][..found.start()].chars().count() + 1
            });
        return vec![ScanFinding::inherited(
            MESSAGE,
            start_line_index + line_offset + 1,
            column,
        )];
    }
    Vec::new()
}

fn scan_non_workflow(original_source: &str, content: &str) -> Vec<ScanFinding> {
    for install in INSTALL_PATTERN.find_iter(content) {
        for secret in NON_WORKFLOW_SECRET_PATTERN.find_iter(content) {
            let (start, end) = if install.start() <= secret.start() {
                (install.start(), secret.end())
            } else {
                (secret.start(), install.end())
            };
            if content[install.end().min(secret.end())..install.start().max(secret.start())]
                .chars()
                .count()
                > 700
                || NON_WORKFLOW_IGNORE_SCRIPTS_PATTERN.is_match(&content[start..end])
            {
                continue;
            }
            let (line, column) = get_location_at_index(original_source, content, start);
            return vec![ScanFinding::inherited(MESSAGE, line, column)];
        }
    }
    Vec::new()
}
