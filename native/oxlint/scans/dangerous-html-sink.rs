use std::path::{Path, PathBuf};

use lazy_regex::{Lazy, Regex, lazy_regex};

use super::ScanFinding;

const MESSAGE: &str = "HTML is injected from a dynamic-looking source, which can become XSS if the value is user-controlled or unsanitized.";
const DANGEROUS_HTML_VALUE_LOOKAHEAD_LINES: usize = 4;
const DANGEROUS_HTML_VALUE_MAX_CHARS: usize = 300;
const DANGEROUS_HTML_STATIC_TEMPLATE_LOOKAHEAD_LINES: usize = 60;
const DANGEROUS_HTML_TEMPLATE_MAX_CHARS: usize = 5000;
const DANGEROUS_HTML_CROSS_FILE_PARSE_MAX_BYTES: u64 = 2_000_000;
const DANGEROUS_HTML_CROSS_FILE_PROOF_MAX_DEPTH: usize = 2;
const DANGEROUS_HTML_DIRECTORY_WALK_MAX_LEVELS: usize = 30;
const DANGEROUS_HTML_CROSS_FILE_CACHE_MAX_ENTRIES: usize = 64;
const DANGEROUS_HTML_CROSS_FILE_CACHE_MAX_BYTES: u64 = 16 * 1024 * 1024;

static DANGEROUS_HTML_SINK_PATTERN: Lazy<Regex> = lazy_regex!(
    r#"dangerouslySetInnerHTML|(?:\.(?:inner|outer)HTML|\[\s*[\"'](?:inner|outer)HTML[\"']\s*\])\s*[+]?=|\.insertAdjacentHTML\s*\(|\bdocument\.write(?:ln)?\s*\(|\.(?:createContextualFragment|setHTMLUnsafe)\s*\("#
);
static DANGEROUS_HTML_PROPERTY_VALUE_PATTERN: Lazy<Regex> = lazy_regex!(r"__html\s*:");
static DANGEROUS_HTML_TAINT_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?:searchParams|query|params|request|req\.|response\.|await|fetch|props\.|children|(?:user|untrusted|unsafe|raw|comment|message|cms|remote|external)\.|(?:user|untrusted|unsafe|raw|comment|message|cms|remote|external|content|profile|signature|subtitle)\w*(?:html|markup)|(?:html|markup)\w*(?:input|payload)|\b(?:load|read|receive|decode)\w*\s*\(|\bget\w*(?:Html|Markup|Content|Page|Message)\b|\blocation\b|document\.cookie|\breferrer\b|\blocalStorage\b|\bsessionStorage\b|URLSearchParams|window\.name)"
);
static DANGEROUS_HTML_STRING_LITERAL_PATTERN: Lazy<Regex> = lazy_regex!(
    r#"(?s)^(?:\"(?:\\.|[^\"\\\n])*\"|'(?:\\.|[^'\\\n])*'|`[^`$]*`)\s*(?://[^\n]*)?\s*(?:[;,})\n]|$)"#
);
static DANGEROUS_HTML_MODULE_CONSTANT_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?s)^[A-Z][A-Z0-9_]*\s*(?://[^\n]*)?\s*(?:[;,})\n]|$)");
static DANGEROUS_HTML_DOM_SOURCE_PATTERN: Lazy<Regex> =
    lazy_regex!(r"^[\w$]+(?:\??\.[\w$]+)*\??\.(?:inner|outer)HTML\b");
static DANGEROUS_HTML_SANITIZER_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)\b(?:DOMPurify|sanitize\w*|purify|(?:escape|encode)[A-Za-z]*(?:Html|HTML|Entit\w*)|insane|xss)\b"
);
static DANGEROUS_HTML_ENV_PATTERN: Lazy<Regex> = lazy_regex!(r"process\.env");
static DANGEROUS_HTML_I18N_PATTERN: Lazy<Regex> =
    lazy_regex!(r"\b(?:t|i18n|translate|formatMessage|intl)\s*[.(]");
static DANGEROUS_HTML_SERIALIZER_CALL_PATTERN: Lazy<Regex> = lazy_regex!(
    r"^(?:[\w$.]+\.)?(?:toHtml|render[A-Za-z]*(?:Html|HTML)|renderToString|renderToStaticMarkup|codeToHtml|codeToHast|highlight[A-Za-z]*)\s*\("
);
static DANGEROUS_HTML_SERIALIZER_PROVENANCE_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)\b(?:(?:katex|shiki|hljs|prism|mermaid|highlighter)[\w$]*\.(?:render\w*|highlight\w*|codeTo(?:Html|Hast))|(?:toHtml|render(?:Html|HTML)[A-Za-z]*|render[A-Za-z]*(?:Html|HTML)|renderToString|renderToStaticMarkup|codeToHtml|codeToHast|highlight[A-Za-z]*))\s*\("
);
static DANGEROUS_HTML_HIGHLIGHTER_LIBRARY_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)\b(?:shiki|prism|hljs|highlightjs|getHighlighter|codeToHtml|codeToHast|refractor|lowlight|starry-night)\b|highlight\.js"
);
static DANGEROUS_HTML_RETURNED_STRING_PROPERTY_PATTERN: Lazy<Regex> =
    lazy_regex!(r"^\s*\.\s*(?:textContent|innerText|innerHTML|outerHTML)");
static DANGEROUS_HTML_EMAIL_PATH_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?:^|/)emails(?:/|$)|email[-_.]templates?(?:/|$)|RawHtml|[A-Za-z]*[Ee]mail[A-Za-z]*\.(?:t|j)sx?"
);
static DANGEROUS_HTML_SANITIZER_PATH_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)saniti[sz]e?d?[A-Za-z0-9_-]*\.[cm]?[jt]sx?$");
#[derive(Clone)]
struct DangerousHtmlDeclaration {
    declaration_index: usize,
    initializer_index: usize,
    initializer: String,
    is_immutable: bool,
}

#[derive(Clone)]
struct DangerousHtmlCrossFileCacheEntry {
    modified: std::time::SystemTime,
    size: u64,
    source: Option<String>,
}

static DANGEROUS_HTML_CROSS_FILE_CACHE: std::sync::OnceLock<
    std::sync::Mutex<std::collections::HashMap<PathBuf, DangerousHtmlCrossFileCacheEntry>>,
> = std::sync::OnceLock::new();
pub fn scan(
    relative_path: &str,
    absolute_path: &str,
    source: &str,
    is_generated_bundle: bool,
) -> Vec<ScanFinding> {
    let normalized_path =
        super::normalize_js_regex_content::normalize_js_regex_content(relative_path);
    if is_generated_bundle
        || !dangerous_html_is_production_source_path(relative_path)
        || DANGEROUS_HTML_EMAIL_PATH_PATTERN.is_match(&normalized_path)
        || dangerous_html_is_hidden_tooling_path(relative_path)
        || dangerous_html_is_sanitizer_wrapper_path(&normalized_path)
    {
        return Vec::new();
    }
    let normalized_source = super::normalize_js_regex_content::normalize_js_regex_content(source);
    if !DANGEROUS_HTML_SINK_PATTERN.is_match(&normalized_source) {
        return Vec::new();
    }

    let filename = Path::new(absolute_path);
    let lines = source.split('\n').collect::<Vec<_>>();
    let normalized_lines = normalized_source.split('\n').collect::<Vec<_>>();
    let mut findings = Vec::new();
    let mut line_start = 0;
    for (line_index, normalized_line) in normalized_lines.iter().enumerate() {
        let line = lines[line_index];
        let Some(sink_match) =
            DANGEROUS_HTML_SINK_PATTERN
                .find_iter(normalized_line)
                .find(|sink_match| {
                    !(sink_match.as_str().ends_with('=')
                        && normalized_line.as_bytes().get(sink_match.end()) == Some(&b'='))
                })
        else {
            line_start += line.len() + 1;
            continue;
        };
        if dangerous_html_is_commented_sink(line, sink_match.start()) {
            line_start += line.len() + 1;
            continue;
        }
        let sink_index = line_start + sink_match.start();
        let window_end = (line_index + DANGEROUS_HTML_VALUE_LOOKAHEAD_LINES + 1).min(lines.len());
        let sink_window = lines[line_index..window_end].join("\n");
        let Some(full_value_tail) =
            dangerous_html_value_tail(&sink_window, sink_match.start(), sink_match.as_str())
        else {
            line_start += line.len() + 1;
            continue;
        };
        let value_expression = dangerous_html_bounded_value_expression(full_value_tail);
        let template_window_end =
            (line_index + DANGEROUS_HTML_STATIC_TEMPLATE_LOOKAHEAD_LINES + 1).min(lines.len());
        let template_window = lines[line_index..template_window_end].join("\n");
        let template_value_expression =
            dangerous_html_value_tail(&template_window, sink_match.start(), sink_match.as_str());
        let katex_value_expression =
            (sink_match.as_str() == "dangerouslySetInnerHTML").then(|| {
                dangerous_html_value_tail(&source[sink_index..], 0, sink_match.as_str())
                    .map(dangerous_html_bounded_katex_expression)
                    .unwrap_or_else(|| value_expression.clone())
            });
        if dangerous_html_value_is_exempt(
            &value_expression,
            template_value_expression,
            katex_value_expression.as_deref(),
            source,
            sink_index,
            filename,
        ) || dangerous_html_is_style_sink(&lines, line_index, sink_match.start())
            || dangerous_html_sink_target(line, sink_match.start())
                .is_some_and(|target| dangerous_html_is_inert_target(target, source))
        {
            line_start += line.len() + 1;
            continue;
        }
        findings.push(ScanFinding::inherited(
            MESSAGE,
            line_index + 1,
            dangerous_html_first_non_whitespace_column(line),
        ));
        line_start += line.len() + 1;
    }
    findings
}

fn dangerous_html_is_hidden_tooling_path(relative_path: &str) -> bool {
    let segments = relative_path.split('/').collect::<Vec<_>>();
    segments
        .iter()
        .take(segments.len().saturating_sub(1))
        .any(|segment| segment.starts_with('.') && segment.len() > 1)
}

fn dangerous_html_is_production_source_path(relative_path: &str) -> bool {
    super::is_production_file_path::is_production_source_path(relative_path)
}

fn dangerous_html_is_sanitizer_wrapper_path(relative_path: &str) -> bool {
    DANGEROUS_HTML_SANITIZER_PATH_PATTERN
        .find_iter(relative_path)
        .any(|found| {
            let prefix = &relative_path[..found.start()];
            !prefix.to_ascii_lowercase().ends_with("un")
        })
}

fn dangerous_html_js_regex_is_match(pattern: &Regex, value: &str) -> bool {
    let normalized = super::normalize_js_regex_content::normalize_js_regex_content(value);
    pattern.is_match(normalized.as_ref())
}

fn dangerous_html_original_capture<'a>(
    original: &'a str,
    captures: &lazy_regex::regex::Captures<'_>,
    index: usize,
) -> Option<&'a str> {
    let captured = captures.get(index)?;
    original.get(captured.start()..captured.end())
}

fn dangerous_html_escape_js_regex_literal(value: &str) -> String {
    let normalized = super::normalize_js_regex_content::normalize_js_regex_content(value);
    lazy_regex::regex::escape(normalized.as_ref())
}

fn dangerous_html_js_regex_replace_all(pattern: &Regex, value: &str, replacement: &str) -> String {
    let normalized = super::normalize_js_regex_content::normalize_js_regex_content(value);
    let mut replaced = String::with_capacity(value.len());
    let mut previous_end = 0;
    for found in pattern.find_iter(normalized.as_ref()) {
        replaced.push_str(&value[previous_end..found.start()]);
        replaced.push_str(replacement);
        previous_end = found.end();
    }
    replaced.push_str(&value[previous_end..]);
    replaced
}

fn dangerous_html_has_sanitizer(value: &str) -> bool {
    if dangerous_html_js_regex_is_match(&DANGEROUS_HTML_SANITIZER_PATTERN, value) {
        return true;
    }
    let lowercase = value.to_ascii_lowercase();
    ["safe", "sanitiz", "sanitis"].iter().any(|needle| {
        lowercase
            .match_indices(needle)
            .any(|(index, _)| !lowercase[..index].ends_with("un"))
    })
}

fn dangerous_html_first_non_whitespace_column(line: &str) -> usize {
    line.chars()
        .take_while(|character| is_js_whitespace(*character))
        .map(char::len_utf16)
        .sum::<usize>()
        + 1
}

fn is_js_whitespace(character: char) -> bool {
    matches!(
        character,
        '\u{0009}' | '\u{000B}' | '\u{000C}' | '\u{0020}' | '\u{00A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    ) || character == '\n'
        || character == '\r'
}

fn dangerous_html_value_is_exempt(
    value: &str,
    template_value: Option<&str>,
    katex_value: Option<&str>,
    source: &str,
    sink_index: usize,
    filename: &Path,
) -> bool {
    if dangerous_html_js_regex_is_match(&DANGEROUS_HTML_STRING_LITERAL_PATTERN, value)
        || dangerous_html_js_regex_is_match(&DANGEROUS_HTML_MODULE_CONSTANT_PATTERN, value)
    {
        return true;
    }
    if dangerous_html_js_regex_is_match(&DANGEROUS_HTML_DOM_SOURCE_PATTERN, value)
        && !value.contains('+')
    {
        let remainder = DANGEROUS_HTML_DOM_SOURCE_PATTERN.replace(value, "");
        if !dangerous_html_js_regex_is_match(&DANGEROUS_HTML_TAINT_PATTERN, &remainder) {
            return true;
        }
    }
    if dangerous_html_all_concat_operands_are_dom_content(value) {
        return true;
    }
    let katex_proof = katex_value.and_then(|katex_value| {
        dangerous_html_katex_proof(
            katex_value,
            source,
            sink_index,
            filename,
            0,
            &mut Vec::new(),
        )
    });
    if katex_proof.is_some_and(|proof| proof.contains_katex && proof.is_conclusive && proof.is_safe)
    {
        return true;
    }
    let has_unsafe_katex_proof =
        katex_proof.is_some_and(|proof| proof.is_conclusive && !proof.is_safe);
    let mut judged_value = value.to_string();
    if let Some(interpolations) = template_value
        .and_then(dangerous_html_template_interpolations)
        .or_else(|| dangerous_html_template_interpolations(value))
    {
        if interpolations.is_empty() {
            return true;
        }
        judged_value = interpolations;
    } else if let Some(identifier) = dangerous_html_bare_identifier(value)
        && dangerous_html_containing_parameter_source(identifier, sink_index, source).is_none()
    {
        if let Some(declaration) =
            dangerous_html_visible_declaration(identifier, sink_index, source)
        {
            if dangerous_html_is_pure_literal_concat(&declaration.initializer) {
                return true;
            }
            let initializer_tail = &source[declaration.initializer_index..];
            let initializer_tail = &initializer_tail[..dangerous_html_byte_index_at_utf16_limit(
                initializer_tail,
                DANGEROUS_HTML_TEMPLATE_MAX_CHARS,
            )];
            if let Some(interpolations) =
                dangerous_html_template_interpolations(initializer_tail)
            {
                if interpolations.is_empty() {
                    return true;
                }
                judged_value = interpolations;
            }
        }
    }
    let combines_values = dangerous_html_split_top_level(&judged_value, '+').len() > 1
        || judged_value.matches("${").count() > 1;
    if !has_unsafe_katex_proof && !combines_values && dangerous_html_has_sanitizer(&judged_value) {
        return true;
    }
    if !combines_values
        && (dangerous_html_js_regex_is_match(&DANGEROUS_HTML_ENV_PATTERN, &judged_value)
            || dangerous_html_js_regex_is_match(&DANGEROUS_HTML_I18N_PATTERN, &judged_value))
    {
        return true;
    }
    if !has_unsafe_katex_proof
        && !dangerous_html_is_tainted(
            &judged_value,
            source,
            sink_index,
            &mut Vec::new(),
            &mut Vec::new(),
        )
    {
        return true;
    }
    if !has_unsafe_katex_proof
        && dangerous_html_js_regex_is_match(&DANGEROUS_HTML_SERIALIZER_CALL_PATTERN, value.trim())
    {
        return true;
    }
    if !has_unsafe_katex_proof && dangerous_html_is_trusted_highlighter(value, source, sink_index) {
        return true;
    }
    if let Some(identifier) = dangerous_html_root_identifier(value) {
        let visible_declaration =
            dangerous_html_visible_declaration(identifier, sink_index, source);
        if let Some(declaration) = &visible_declaration
            && dangerous_html_declaration_is_stable(identifier, declaration, sink_index, source)
            && !dangerous_html_expression_combines_values(&declaration.initializer)
        {
            if dangerous_html_js_regex_is_match(
                &DANGEROUS_HTML_DOM_SOURCE_PATTERN,
                declaration.initializer.trim(),
            ) {
                return true;
            }
            if !has_unsafe_katex_proof
                && (dangerous_html_js_regex_is_match(
                    &DANGEROUS_HTML_SERIALIZER_PROVENANCE_PATTERN,
                    &declaration.initializer,
                ) || dangerous_html_has_sanitizer(&declaration.initializer))
            {
                return true;
            }
        }
        if !has_unsafe_katex_proof
            && visible_declaration.is_none()
            && dangerous_html_file_serializer_assignment_is_trusted(identifier, source)
        {
            return true;
        }
        if dangerous_html_file_dom_assignment_is_trusted(identifier, source) {
            return true;
        }
    }
    false
}

#[derive(Clone, Copy)]
struct DangerousHtmlKatexProof {
    contains_katex: bool,
    is_conclusive: bool,
    is_safe: bool,
    is_safe_in_attribute_context: bool,
}

const DANGEROUS_HTML_SAFE_STATIC_PROOF: DangerousHtmlKatexProof = DangerousHtmlKatexProof {
    contains_katex: false,
    is_conclusive: true,
    is_safe: true,
    is_safe_in_attribute_context: true,
};
const DANGEROUS_HTML_SAFE_FRAGMENT_PROOF: DangerousHtmlKatexProof = DangerousHtmlKatexProof {
    contains_katex: false,
    is_conclusive: true,
    is_safe: true,
    is_safe_in_attribute_context: false,
};
const DANGEROUS_HTML_UNKNOWN_PROOF: DangerousHtmlKatexProof = DangerousHtmlKatexProof {
    contains_katex: false,
    is_conclusive: false,
    is_safe: false,
    is_safe_in_attribute_context: false,
};
const DANGEROUS_HTML_UNSUPPORTED_KATEX_PROOF: DangerousHtmlKatexProof = DangerousHtmlKatexProof {
    contains_katex: true,
    is_conclusive: false,
    is_safe: false,
    is_safe_in_attribute_context: false,
};
const DANGEROUS_HTML_UNSAFE_KATEX_PROOF: DangerousHtmlKatexProof = DangerousHtmlKatexProof {
    contains_katex: true,
    is_conclusive: true,
    is_safe: false,
    is_safe_in_attribute_context: false,
};

fn dangerous_html_combine_katex_proofs(
    proofs: &[DangerousHtmlKatexProof],
) -> DangerousHtmlKatexProof {
    let all_safe = proofs.iter().all(|proof| proof.is_safe);
    let contains_katex = proofs.iter().any(|proof| proof.contains_katex);
    DangerousHtmlKatexProof {
        contains_katex,
        is_conclusive: if all_safe {
            proofs
                .iter()
                .filter(|proof| proof.contains_katex)
                .all(|proof| proof.is_conclusive)
        } else {
            proofs
                .iter()
                .any(|proof| proof.contains_katex && proof.is_conclusive && !proof.is_safe)
                || (proofs
                    .iter()
                    .any(|proof| proof.contains_katex && proof.is_conclusive)
                    && proofs
                        .iter()
                        .any(|proof| !proof.contains_katex && !proof.is_safe))
        },
        is_safe: all_safe,
        is_safe_in_attribute_context: proofs
            .iter()
            .all(|proof| proof.is_safe_in_attribute_context),
    }
}

fn dangerous_html_katex_proof(
    raw_expression: &str,
    source: &str,
    usage_index: usize,
    filename: &Path,
    depth: usize,
    visited: &mut Vec<String>,
) -> Option<DangerousHtmlKatexProof> {
    if depth > 8 {
        return Some(DANGEROUS_HTML_UNSUPPORTED_KATEX_PROOF);
    }
    let expression = dangerous_html_strip_expression_wrappers(raw_expression);
    let expression = expression
        .trim()
        .trim_end_matches(|character| matches!(character, ';' | ',' | '}'))
        .trim();
    if expression.is_empty() {
        return None;
    }
    if dangerous_html_is_static_katex_value(expression) {
        return Some(DANGEROUS_HTML_SAFE_STATIC_PROOF);
    }
    if let Some(interpolations) = dangerous_html_katex_template_parts(expression) {
        let mut proofs = Vec::new();
        let mut is_safe = true;
        for (prefix, interpolation) in interpolations {
            let proof = dangerous_html_katex_proof(
                interpolation,
                source,
                usage_index,
                filename,
                depth + 1,
                visited,
            )
            .unwrap_or(DANGEROUS_HTML_UNKNOWN_PROOF);
            let context = dangerous_html_template_context(prefix);
            is_safe &= match context {
                "text" => proof.is_safe,
                "attribute" => proof.is_safe_in_attribute_context,
                _ => false,
            };
            proofs.push(proof);
        }
        let mut proof = dangerous_html_combine_katex_proofs(&proofs);
        proof.is_safe = is_safe;
        proof.is_safe_in_attribute_context = false;
        if proof.contains_katex || proof.is_safe {
            return Some(proof);
        }
    }
    let concat_parts = dangerous_html_split_top_level(expression, '+');
    if concat_parts.len() > 1 {
        let proofs = concat_parts
            .iter()
            .map(|part| {
                dangerous_html_katex_proof(part, source, usage_index, filename, depth + 1, visited)
                    .unwrap_or(DANGEROUS_HTML_UNKNOWN_PROOF)
            })
            .collect::<Vec<_>>();
        let proof = dangerous_html_combine_katex_proofs(&proofs);
        return (proof.contains_katex || proof.is_safe).then_some(proof);
    }
    if let Some((test, consequent, alternate)) = dangerous_html_conditional_parts(expression) {
        let selected = dangerous_html_static_truthiness(test, source, usage_index);
        let proof = if let Some(is_truthy) = selected {
            dangerous_html_katex_proof(
                if is_truthy { consequent } else { alternate },
                source,
                usage_index,
                filename,
                depth + 1,
                visited,
            )
        } else {
            let proofs = [consequent, alternate].map(|branch| {
                dangerous_html_katex_proof(
                    branch,
                    source,
                    usage_index,
                    filename,
                    depth + 1,
                    visited,
                )
                .unwrap_or(DANGEROUS_HTML_UNKNOWN_PROOF)
            });
            Some(dangerous_html_combine_katex_proofs(&proofs))
        };
        if proof.is_some_and(|proof| proof.contains_katex || proof.is_safe) {
            return proof;
        }
    }
    if let Some((left, operator, right)) = dangerous_html_logical_parts(expression) {
        let left_proof =
            dangerous_html_katex_proof(left, source, usage_index, filename, depth + 1, visited)
                .unwrap_or(DANGEROUS_HTML_UNKNOWN_PROOF);
        let right_proof =
            dangerous_html_katex_proof(right, source, usage_index, filename, depth + 1, visited)
                .unwrap_or(DANGEROUS_HTML_UNKNOWN_PROOF);
        if let Some(is_truthy) = dangerous_html_static_truthiness(left, source, usage_index) {
            let selected = match operator {
                "&&" => {
                    if is_truthy {
                        right_proof
                    } else {
                        left_proof
                    }
                }
                "||" => {
                    if is_truthy {
                        left_proof
                    } else {
                        right_proof
                    }
                }
                _ => dangerous_html_combine_katex_proofs(&[left_proof, right_proof]),
            };
            if selected.contains_katex || selected.is_safe {
                return Some(selected);
            }
            return None;
        }
        let mut proof = dangerous_html_combine_katex_proofs(&[left_proof, right_proof]);
        proof.contains_katex = left_proof.contains_katex || right_proof.contains_katex;
        if proof.contains_katex {
            return Some(proof);
        }
    }
    if let Some((callee, arguments, call_end)) = dangerous_html_call_parts(expression) {
        let callee = dangerous_html_strip_expression_wrappers(callee);
        if let Some(receiver) = callee.strip_suffix(".get")
            && let Some(proof) = dangerous_html_katex_map_get_proof(
                receiver,
                source,
                usage_index,
                filename,
                depth + 1,
                visited,
            )
        {
            return Some(proof);
        }
        if dangerous_html_is_real_katex_renderer(callee, source, usage_index) {
            let options = arguments.get(1).map(String::as_str);
            let proof = DangerousHtmlKatexProof {
                contains_katex: true,
                is_conclusive: true,
                is_safe: dangerous_html_katex_options_are_safe(options, source, usage_index, depth),
                is_safe_in_attribute_context: false,
            };
            if call_end < expression.len() {
                return Some(dangerous_html_katex_post_transform_proof(
                    expression[call_end..].trim_start(),
                    proof,
                ));
            }
            return Some(proof);
        }
        if dangerous_html_all_opening_angle_brackets_are_escaped(expression) {
            return Some(DANGEROUS_HTML_SAFE_FRAGMENT_PROOF);
        }
        if dangerous_html_is_react_use_memo(callee, source) {
            let callback = arguments.first()?;
            let proof = dangerous_html_katex_function_source_proof(
                callback,
                &[],
                source,
                usage_index,
                filename,
                depth + 1,
                visited,
            );
            if proof.is_some_and(|proof| proof.contains_katex) {
                return proof;
            }
        }
        if let Some(proof) = dangerous_html_katex_local_call_proof(
            callee,
            &arguments,
            source,
            usage_index,
            filename,
            depth + 1,
            visited,
        ) && (proof.contains_katex || proof.is_safe)
        {
            return Some(proof);
        }
        if let Some(proof) = dangerous_html_katex_cross_file_call_proof(
            callee,
            &arguments,
            source,
            filename,
            depth + 1,
            visited,
        ) && proof.contains_katex
        {
            return Some(proof);
        }
        if dangerous_html_is_katex_shaped_renderer(callee, source, usage_index) {
            return Some(DANGEROUS_HTML_UNSAFE_KATEX_PROOF);
        }
        if call_end < expression.len() {
            let suffix = expression[call_end..].trim_start();
            if suffix.starts_with('.') {
                let receiver_proof = dangerous_html_katex_proof(
                    &expression[..call_end],
                    source,
                    usage_index,
                    filename,
                    depth + 1,
                    visited,
                )?;
                if receiver_proof.contains_katex {
                    return Some(dangerous_html_katex_post_transform_proof(
                        suffix,
                        receiver_proof,
                    ));
                }
            }
        }
        let argument_proofs = arguments
            .iter()
            .filter_map(|argument| {
                dangerous_html_katex_proof(
                    argument,
                    source,
                    usage_index,
                    filename,
                    depth + 1,
                    visited,
                )
            })
            .collect::<Vec<_>>();
        if argument_proofs.iter().any(|proof| proof.contains_katex) {
            return Some(DANGEROUS_HTML_UNSUPPORTED_KATEX_PROOF);
        }
    }
    if let Some(identifier) = dangerous_html_bare_katex_identifier(expression) {
        if visited.iter().any(|candidate| candidate == identifier) {
            return None;
        }
        if let Some(declaration) =
            dangerous_html_visible_declaration(identifier, usage_index, source)
        {
            visited.push(identifier.to_string());
            let proof = dangerous_html_katex_proof(
                &declaration.initializer,
                source,
                declaration.initializer_index,
                filename,
                depth + 1,
                visited,
            );
            visited.pop();
            if proof.is_some_and(|proof| proof.contains_katex) {
                return proof;
            }
        }
    }
    if let Some((receiver, property)) = expression.rsplit_once('.')
        && let Some(identifier) = dangerous_html_bare_katex_identifier(receiver)
        && let Some(declaration) =
            dangerous_html_visible_declaration(identifier, usage_index, source)
        && let Some((callee, arguments, _)) = dangerous_html_call_parts(&declaration.initializer)
        && let Some(proof) = dangerous_html_katex_call_property_proof(
            callee,
            &arguments,
            property,
            source,
            declaration.initializer_index,
            filename,
            depth + 1,
            visited,
        )
        && proof.contains_katex
    {
        return Some(proof);
    }
    if expression.to_ascii_lowercase().contains("katex")
        && (expression.contains("renderToString") || expression.contains("render"))
    {
        return Some(DANGEROUS_HTML_UNSAFE_KATEX_PROOF);
    }
    None
}

fn dangerous_html_katex_map_get_proof(
    raw_receiver: &str,
    source: &str,
    usage_index: usize,
    filename: &Path,
    depth: usize,
    visited: &mut Vec<String>,
) -> Option<DangerousHtmlKatexProof> {
    let receiver = dangerous_html_bare_katex_identifier(raw_receiver)?;
    let declaration = dangerous_html_visible_declaration(receiver, usage_index, source)?;
    if !declaration.is_immutable || !declaration.initializer.trim_start().starts_with("new Map") {
        return None;
    }
    let escaped = dangerous_html_escape_js_regex_literal(receiver);
    let set_pattern = Regex::new(&format!(r"\b{escaped}\.set\s*\(")).ok()?;
    let normalized_source = super::normalize_js_regex_content::normalize_js_regex_content(source);
    let mut proofs = Vec::new();
    for set_match in set_pattern.find_iter(normalized_source.as_ref()) {
        let opening = set_match.end() - 1;
        let closing = dangerous_html_matching_delimiter(source, opening, '(', ')')?;
        let arguments = dangerous_html_split_top_level(&source[opening + 1..closing], ',');
        let Some(value) = arguments.get(1) else {
            return Some(DANGEROUS_HTML_UNSUPPORTED_KATEX_PROOF);
        };
        proofs.push(
            dangerous_html_katex_proof(
                value,
                source,
                set_match.start(),
                filename,
                depth + 1,
                visited,
            )
            .unwrap_or(DANGEROUS_HTML_UNKNOWN_PROOF),
        );
    }
    if proofs.is_empty() {
        return None;
    }
    Some(dangerous_html_combine_katex_proofs(&proofs))
}

fn dangerous_html_strip_expression_wrappers(mut expression: &str) -> &str {
    expression = expression.trim();
    loop {
        let previous = expression;
        while expression.ends_with('!') {
            expression = expression[..expression.len() - 1].trim_end();
        }
        if expression.starts_with('(')
            && dangerous_html_matching_delimiter(expression, 0, '(', ')')
                == Some(expression.len() - 1)
        {
            expression = expression[1..expression.len() - 1].trim();
        }
        if let Some(index) = dangerous_html_top_level_keyword(expression, " satisfies ") {
            expression = expression[..index].trim_end();
        }
        if let Some(index) = dangerous_html_top_level_keyword(expression, " as ") {
            expression = expression[..index].trim_end();
        }
        if expression == previous {
            return expression;
        }
    }
}

fn dangerous_html_is_static_katex_value(expression: &str) -> bool {
    if matches!(expression, "undefined" | "NaN" | "null") || expression.starts_with("void ") {
        return true;
    }
    let Some(quote) = expression.chars().next() else {
        return false;
    };
    if !matches!(quote, '\'' | '"') {
        return false;
    }
    dangerous_html_unescaped_quote_end(expression, quote) == Some(expression.len() - 1)
}

fn dangerous_html_katex_template_parts(expression: &str) -> Option<Vec<(&str, &str)>> {
    if !expression.starts_with('`') {
        return None;
    }
    let mut parts = Vec::new();
    let mut search_index = 1;
    while search_index < expression.len() {
        let Some(relative) = expression[search_index..].find("${") else {
            break;
        };
        let interpolation_start = search_index + relative;
        let interpolation_end =
            dangerous_html_matching_delimiter(expression, interpolation_start + 1, '{', '}')?;
        parts.push((
            &expression[1..interpolation_start],
            &expression[interpolation_start + 2..interpolation_end],
        ));
        search_index = interpolation_end + 1;
        if expression[search_index..].starts_with('`') {
            break;
        }
    }
    Some(parts)
}

fn dangerous_html_template_context(prefix: &str) -> &'static str {
    let lower = prefix.to_ascii_lowercase();
    for tag in ["script", "style", "textarea", "title"] {
        if lower.rfind(&format!("<{tag}")).unwrap_or(0)
            > lower.rfind(&format!("</{tag}")).unwrap_or(0)
        {
            return "raw-text";
        }
    }
    let opening = prefix.rfind('<');
    let closing = prefix.rfind('>');
    if opening.is_none() || opening <= closing {
        return "text";
    }
    let current_tag = &prefix[opening.unwrap_or(0) + 1..];
    let mut quote = None;
    let mut escaped = false;
    for character in current_tag.chars() {
        if escaped {
            escaped = false;
        } else if character == '\\' {
            escaped = true;
        } else if matches!(character, '\'' | '"') {
            if quote == Some(character) {
                quote = None;
            } else if quote.is_none() {
                quote = Some(character);
            }
        }
    }
    if quote.is_some() {
        "attribute"
    } else {
        "unsafe-tag"
    }
}

fn dangerous_html_conditional_parts(expression: &str) -> Option<(&str, &str, &str)> {
    let question = dangerous_html_find_top_level_operator(expression, "?")?;
    if expression.as_bytes().get(question + 1) == Some(&b'?')
        || expression.as_bytes().get(question.wrapping_sub(1)) == Some(&b'?')
    {
        return None;
    }
    let colon =
        dangerous_html_find_top_level_operator(&expression[question + 1..], ":")? + question + 1;
    Some((
        expression[..question].trim(),
        expression[question + 1..colon].trim(),
        expression[colon + 1..].trim(),
    ))
}

fn dangerous_html_logical_parts(expression: &str) -> Option<(&str, &str, &str)> {
    for operator in ["??", "||", "&&"] {
        if let Some(index) = dangerous_html_find_top_level_operator(expression, operator) {
            return Some((
                expression[..index].trim(),
                operator,
                expression[index + operator.len()..].trim(),
            ));
        }
    }
    None
}

fn dangerous_html_static_truthiness(
    raw_expression: &str,
    source: &str,
    usage_index: usize,
) -> Option<bool> {
    let expression = dangerous_html_strip_expression_wrappers(raw_expression);
    if let Some((_, final_value)) = expression.rsplit_once(',') {
        return dangerous_html_static_truthiness(final_value, source, usage_index);
    }
    if let Some(argument) = expression.strip_prefix('!') {
        return dangerous_html_static_truthiness(argument, source, usage_index).map(|value| !value);
    }
    if expression.starts_with("typeof ") {
        return Some(true);
    }
    if matches!(
        expression,
        "false" | "null" | "undefined" | "NaN" | "0" | "-0"
    ) || expression.starts_with("void ")
        || expression == "``"
        || expression == "\"\""
        || expression == "''"
    {
        if matches!(expression, "undefined" | "NaN")
            && dangerous_html_visible_declaration(expression, usage_index, source).is_some()
        {
            return None;
        }
        return Some(false);
    }
    if matches!(expression, "true" | "{}" | "[]")
        || expression.starts_with("new ")
        || expression.starts_with("function")
        || expression.contains("=>")
        || (expression.starts_with('`') && expression.ends_with('`') && expression.len() > 2)
        || (expression.starts_with('"') && expression.ends_with('"') && expression.len() > 2)
        || (expression.starts_with('\'') && expression.ends_with('\'') && expression.len() > 2)
    {
        return Some(true);
    }
    expression.parse::<f64>().ok().map(|number| number != 0.0)
}

fn dangerous_html_call_parts(expression: &str) -> Option<(&str, Vec<String>, usize)> {
    let mut search_start = 0;
    loop {
        let opening = search_start
            + dangerous_html_find_top_level_operator(&expression[search_start..], "(")?;
        let closing = dangerous_html_matching_delimiter(expression, opening, '(', ')')?;
        let callee = expression[..opening].trim();
        if !callee.is_empty() {
            return Some((
                callee,
                dangerous_html_split_top_level(&expression[opening + 1..closing], ','),
                closing + 1,
            ));
        }
        search_start = closing + 1;
    }
}

fn dangerous_html_is_real_katex_renderer(callee: &str, source: &str, usage_index: usize) -> bool {
    let callee = dangerous_html_strip_expression_wrappers(callee);
    if let Some((receiver, property)) = callee.rsplit_once('.') {
        if property != "renderToString" {
            return false;
        }
        let receiver = receiver.trim();
        if dangerous_html_binding_shadows_import(receiver, source, usage_index) {
            return false;
        }
        let escaped = dangerous_html_escape_js_regex_literal(receiver);
        let is_import = Regex::new(&format!(
            r#"(?m)(?:import\s+(?:\*\s+as\s+|)(?:{escaped})\s+from\s*|(?:const|let|var)\s+{escaped}\s*=\s*require\s*\()\s*["']katex(?:/[^"']*)?["']"#
        ))
        .is_ok_and(|pattern| {
            dangerous_html_js_regex_is_match(
                &pattern,
                &source[..usage_index.min(source.len())],
            )
        });
        let is_mutated = Regex::new(&format!(
            r#"(?m)\b{escaped}\s*(?:\.renderToString|\[\s*['"]renderToString['"]\s*\])\s*="#
        ))
        .is_ok_and(|pattern| {
            dangerous_html_js_regex_is_match(&pattern, &source[..usage_index.min(source.len())])
        });
        return is_import && !is_mutated;
    }
    let escaped = dangerous_html_escape_js_regex_literal(callee);
    let aliased_import = Regex::new(&format!(
        r#"(?m)import\s*\{{[^}}]*\brenderToString\s+as\s+{escaped}\b[^}}]*\}}\s*from\s*["']katex(?:/[^"']*)?["']"#
    ))
    .is_ok_and(|pattern| {
        dangerous_html_js_regex_is_match(&pattern, &source[..usage_index.min(source.len())])
    });
    let direct_import = callee == "renderToString"
        && Regex::new(
            r#"(?m)import\s*\{[^}]*\brenderToString\b[^}]*\}\s*from\s*["']katex(?:/[^"']*)?["']"#,
        )
        .is_ok_and(|pattern| {
            dangerous_html_js_regex_is_match(&pattern, &source[..usage_index.min(source.len())])
        });
    (aliased_import || direct_import)
        && !dangerous_html_binding_shadows_import(callee, source, usage_index)
        && !Regex::new(&format!(r"(?m)\b{escaped}\s*=")).is_ok_and(|pattern| {
            dangerous_html_js_regex_is_match(&pattern, &source[..usage_index.min(source.len())])
        })
}

fn dangerous_html_binding_shadows_import(
    identifier: &str,
    source: &str,
    usage_index: usize,
) -> bool {
    let escaped = dangerous_html_escape_js_regex_literal(identifier);
    let prefix = &source[..usage_index.min(source.len())];
    let normalized_prefix = super::normalize_js_regex_content::normalize_js_regex_content(prefix);
    Regex::new(&format!(r"(?m)\b(?:const|let|var)\s+{escaped}\b")).is_ok_and(|pattern| {
        pattern
            .find_iter(normalized_prefix.as_ref())
            .any(|declaration| {
                let prefix_start = dangerous_html_floor_char_boundary(
                    source,
                    declaration.start().saturating_sub(10),
                );
                !source[prefix_start..declaration.start()].contains("import")
            })
    }) || Regex::new(&format!(r"(?:\(|,)\s*{escaped}\s*(?::[^,)=]+)?(?:,|\))")).is_ok_and(
        |pattern| {
            dangerous_html_js_regex_is_match(&pattern, &source[..usage_index.min(source.len())])
        },
    )
}

fn dangerous_html_is_katex_shaped_renderer(callee: &str, source: &str, usage_index: usize) -> bool {
    if let Some((receiver, property)) = callee.rsplit_once('.') {
        property == "renderToString"
            && receiver.to_ascii_lowercase().contains("katex")
            && !dangerous_html_is_real_katex_renderer(callee, source, usage_index)
    } else {
        callee.to_ascii_lowercase().contains("katex")
            && !dangerous_html_is_real_katex_renderer(callee, source, usage_index)
    }
}

fn dangerous_html_is_react_use_memo(callee: &str, source: &str) -> bool {
    if callee == "useMemo" {
        return Regex::new(r#"import\s*\{[^}]*\buseMemo\b[^}]*\}\s*from\s*["']react["']"#)
            .is_ok_and(|pattern| dangerous_html_js_regex_is_match(&pattern, source));
    }
    let Some((receiver, property)) = callee.rsplit_once('.') else {
        return false;
    };
    if property != "useMemo" {
        return false;
    }
    let escaped = dangerous_html_escape_js_regex_literal(receiver);
    Regex::new(&format!(
        r#"import\s+(?:\*\s+as\s+)?{escaped}\s+from\s*["']react["']"#
    ))
    .is_ok_and(|pattern| dangerous_html_js_regex_is_match(&pattern, source))
}

fn dangerous_html_katex_options_are_safe(
    raw_options: Option<&str>,
    source: &str,
    usage_index: usize,
    depth: usize,
) -> bool {
    let Some(raw_options) = raw_options else {
        return true;
    };
    let options = dangerous_html_strip_expression_wrappers(raw_options);
    if options.is_empty() || options == "undefined" {
        return true;
    }
    if let Some(identifier) = dangerous_html_bare_katex_identifier(options) {
        if depth > 8 {
            return false;
        }
        let Some(declaration) = dangerous_html_visible_declaration(identifier, usage_index, source)
        else {
            return false;
        };
        if !declaration.is_immutable
            && !dangerous_html_declaration_is_stable(identifier, &declaration, usage_index, source)
        {
            return false;
        }
        let mut is_safe = dangerous_html_katex_options_are_safe(
            Some(&declaration.initializer),
            source,
            declaration.initializer_index,
            depth + 1,
        );
        let mutation_source = &source[(declaration.initializer_index
            + declaration.initializer.len())
        .min(source.len())..usage_index.min(source.len())];
        let normalized_mutation_source =
            super::normalize_js_regex_content::normalize_js_regex_content(mutation_source);
        let escaped = dangerous_html_escape_js_regex_literal(identifier);
        if Regex::new(&format!(
            r#"(?s)\b{escaped}\s*(?:\.|\[\s*['"]trust['"]\s*\])\s*=\s*([^;\n]+)"#
        ))
        .ok()
        .and_then(|pattern| {
            pattern
                .captures_iter(normalized_mutation_source.as_ref())
                .last()
        })
        .and_then(|captures| {
            dangerous_html_original_capture(mutation_source, &captures, 1).map(str::to_string)
        })
        .is_some_and(|value| {
            is_safe = dangerous_html_katex_trust_value_is_disabled(&value);
            true
        }) {
            return is_safe;
        }
        if Regex::new(&format!(
            r"\b(?:Object\.(?:assign|definePropert(?:y|ies))|Reflect\.(?:set|defineProperty))\s*\(\s*{escaped}\b"
        ))
        .is_ok_and(|pattern| dangerous_html_js_regex_is_match(&pattern, mutation_source))
        {
            return false;
        }
        return is_safe;
    }
    if !options.starts_with('{') {
        return false;
    }
    let end = dangerous_html_matching_delimiter(options, 0, '{', '}')
        .unwrap_or(options.len().saturating_sub(1));
    let properties = dangerous_html_split_top_level(&options[1..end], ',');
    let mut trust_state = None;
    for property in properties {
        let property = property.trim();
        if let Some(spread) = property.strip_prefix("...") {
            let spread_is_safe =
                dangerous_html_katex_options_are_safe(Some(spread), source, usage_index, depth + 1);
            trust_state = Some(spread_is_safe);
            continue;
        }
        let Some((key, value)) = property.split_once(':') else {
            if property.trim_matches(['\'', '"']) == "trust" {
                trust_state = Some(false);
            }
            continue;
        };
        if key.trim().trim_matches(['\'', '"']) == "trust" {
            trust_state = Some(dangerous_html_katex_trust_value_is_disabled(value));
        }
    }
    trust_state.unwrap_or(true)
}

fn dangerous_html_katex_trust_value_is_disabled(raw_value: &str) -> bool {
    let value = dangerous_html_strip_expression_wrappers(raw_value)
        .trim()
        .trim_end_matches([',', ';']);
    matches!(
        value,
        "false" | "null" | "undefined" | "NaN" | "0" | "-0" | "''" | "\"\""
    ) || value.starts_with("void ")
}

fn dangerous_html_katex_post_transform_proof(
    suffix: &str,
    receiver: DangerousHtmlKatexProof,
) -> DangerousHtmlKatexProof {
    if !receiver.is_safe {
        return if receiver.is_conclusive {
            DANGEROUS_HTML_UNSAFE_KATEX_PROOF
        } else {
            DANGEROUS_HTML_UNSUPPORTED_KATEX_PROOF
        };
    }
    if Regex::new(r"^\.(?:trim|trimStart|trimEnd)\s*\(\s*\)")
        .is_ok_and(|pattern| dangerous_html_js_regex_is_match(&pattern, suffix))
    {
        return receiver;
    }
    let normalized_suffix = super::normalize_js_regex_content::normalize_js_regex_content(suffix);
    let Some(captures) = Regex::new(
        r#"^\.(?:replace|replaceAll)\s*\([^,]+,\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*\)"#,
    )
    .ok()
    .and_then(|pattern| pattern.captures(normalized_suffix.as_ref())) else {
        return DANGEROUS_HTML_UNSAFE_KATEX_PROOF;
    };
    let replacement = dangerous_html_original_capture(suffix, &captures, 1).unwrap_or("");
    if replacement.contains('<') {
        return DANGEROUS_HTML_UNSAFE_KATEX_PROOF;
    }
    DangerousHtmlKatexProof {
        contains_katex: receiver.contains_katex,
        is_conclusive: receiver.is_conclusive,
        is_safe: true,
        is_safe_in_attribute_context: receiver.is_safe_in_attribute_context
            && !replacement.contains(['&', '>', '"', '\'']),
    }
}

fn dangerous_html_katex_local_call_proof(
    callee: &str,
    arguments: &[String],
    source: &str,
    usage_index: usize,
    filename: &Path,
    depth: usize,
    visited: &mut Vec<String>,
) -> Option<DangerousHtmlKatexProof> {
    let identifier = dangerous_html_bare_katex_identifier(callee)?;
    if visited.iter().any(|candidate| candidate == identifier) {
        return None;
    }
    let (parameters, function_source) =
        dangerous_html_local_function_source(identifier, source, usage_index)?;
    visited.push(identifier.to_string());
    let proof = dangerous_html_katex_function_source_proof(
        function_source,
        &dangerous_html_katex_bindings(&parameters, arguments),
        source,
        usage_index,
        filename,
        depth,
        visited,
    );
    visited.pop();
    proof
}

fn dangerous_html_katex_call_property_proof(
    callee: &str,
    arguments: &[String],
    property: &str,
    source: &str,
    usage_index: usize,
    filename: &Path,
    depth: usize,
    visited: &mut Vec<String>,
) -> Option<DangerousHtmlKatexProof> {
    if dangerous_html_is_react_use_memo(callee, source) {
        let callback = arguments.first()?;
        let arrow_index = dangerous_html_find_top_level_operator(callback, "=>")?;
        let body = callback[arrow_index + 2..].trim();
        return dangerous_html_katex_property_source_proof(
            body,
            property,
            &[],
            source,
            usage_index,
            filename,
            depth,
            visited,
        );
    }
    if let Some(identifier) = dangerous_html_bare_katex_identifier(callee)
        && let Some((parameters, function_source)) =
            dangerous_html_local_function_source(identifier, source, usage_index)
    {
        return dangerous_html_katex_property_source_proof(
            function_source,
            property,
            &dangerous_html_katex_bindings(&parameters, arguments),
            source,
            usage_index,
            filename,
            depth,
            visited,
        );
    }
    dangerous_html_katex_cross_file_property_proof(
        callee, arguments, property, source, filename, depth, visited,
    )
}

fn dangerous_html_katex_property_source_proof(
    function_source: &str,
    property: &str,
    bindings: &[(String, String)],
    source: &str,
    usage_index: usize,
    filename: &Path,
    depth: usize,
    visited: &mut Vec<String>,
) -> Option<DangerousHtmlKatexProof> {
    let escaped = dangerous_html_escape_js_regex_literal(property);
    let pattern = Regex::new(&format!(r#"(?:\b{escaped}\b|["']{escaped}["'])\s*:\s*"#)).ok()?;
    let normalized_function_source =
        super::normalize_js_regex_content::normalize_js_regex_content(function_source);
    let property_match = pattern.find(normalized_function_source.as_ref())?;
    let start = property_match.end();
    let end = dangerous_html_expression_end(function_source, start);
    let expression =
        dangerous_html_substitute_katex_bindings(function_source.get(start..end)?, bindings);
    dangerous_html_katex_proof(
        &expression,
        source,
        usage_index,
        filename,
        depth + 1,
        visited,
    )
}

fn dangerous_html_katex_function_source_proof(
    function_source: &str,
    bindings: &[(String, String)],
    source: &str,
    usage_index: usize,
    filename: &Path,
    depth: usize,
    visited: &mut Vec<String>,
) -> Option<DangerousHtmlKatexProof> {
    let mut body = function_source.trim();
    if let Some(arrow_index) = dangerous_html_find_top_level_operator(body, "=>") {
        body = body[arrow_index + 2..].trim_start();
    }
    let mut return_values = Vec::new();
    if body.starts_with('{') {
        let body_end = dangerous_html_matching_delimiter(body, 0, '{', '}')?;
        let body = &body[1..body_end];
        let normalized_body = super::normalize_js_regex_content::normalize_js_regex_content(body);
        let return_pattern = Regex::new(r"\breturn\s+([^;]+)").ok()?;
        for captures in return_pattern.captures_iter(normalized_body.as_ref()) {
            let Some(return_value) = captures.get(1) else {
                continue;
            };
            let prefix = &body[..return_value.start()];
            if dangerous_html_return_is_statically_unreachable(prefix) {
                continue;
            }
            if let Some(return_value) = dangerous_html_original_capture(body, &captures, 1) {
                return_values.push(return_value.to_string());
            }
        }
        if return_values.is_empty() {
            return_values.push("undefined".to_string());
        }
    } else {
        return_values.push(body.to_string());
    }
    let proofs = return_values
        .iter()
        .map(|return_value| {
            let substituted = dangerous_html_substitute_katex_bindings(return_value, bindings);
            dangerous_html_katex_proof(
                &substituted,
                source,
                usage_index,
                filename,
                depth + 1,
                visited,
            )
            .unwrap_or(DANGEROUS_HTML_UNKNOWN_PROOF)
        })
        .collect::<Vec<_>>();
    Some(dangerous_html_combine_katex_proofs(&proofs))
}

fn dangerous_html_all_opening_angle_brackets_are_escaped(expression: &str) -> bool {
    let replace_all_pattern = Regex::new(
        r#"\.replaceAll\s*\(\s*["']<["']\s*,\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*\)"#,
    );
    let replace_pattern = Regex::new(
        r#"\.replace\s*\(\s*/(?:<|\[[^\]]*<[^\]]*\])/g\s*,\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*\)"#,
    );
    let normalized_expression =
        super::normalize_js_regex_content::normalize_js_regex_content(expression);
    [replace_all_pattern, replace_pattern]
        .into_iter()
        .filter_map(Result::ok)
        .filter_map(|pattern| pattern.captures(normalized_expression.as_ref()))
        .filter_map(|captures| dangerous_html_original_capture(expression, &captures, 1))
        .any(|replacement| !replacement.contains('<') && !replacement.contains('$'))
}

fn dangerous_html_return_is_statically_unreachable(prefix: &str) -> bool {
    let tail = prefix.rsplit([';', '}']).next().unwrap_or(prefix).trim();
    tail.starts_with("if (false)")
        || tail.starts_with("if(false)")
        || Regex::new(r"\breturn\s+[^;]+;\s*$")
            .is_ok_and(|pattern| dangerous_html_js_regex_is_match(&pattern, prefix))
}

fn dangerous_html_katex_bindings(
    parameters: &[String],
    arguments: &[String],
) -> Vec<(String, String)> {
    let mut bindings = Vec::new();
    for (index, raw_parameter) in parameters.iter().enumerate() {
        let type_index = dangerous_html_find_top_level_operator(raw_parameter, ":");
        let parameter = type_index.map_or(raw_parameter.as_str(), |index| &raw_parameter[..index]);
        let assignment_index = dangerous_html_find_top_level_operator(parameter, "=");
        let (binding, default) = assignment_index.map_or((parameter.trim(), None), |index| {
            (
                parameter[..index].trim(),
                Some(parameter[index + 1..].trim()),
            )
        });
        let argument = arguments
            .get(index)
            .map(String::as_str)
            .filter(|argument| !argument.trim().is_empty() && argument.trim() != "undefined")
            .or(default);
        if binding.starts_with('{') && binding.ends_with('}') {
            let object_argument = argument.unwrap_or("{}");
            for property in dangerous_html_split_top_level(&binding[1..binding.len() - 1], ',') {
                let property = property.trim();
                if property.starts_with("...") || property.is_empty() {
                    continue;
                }
                let (property_name, raw_binding) = property
                    .split_once(':')
                    .map_or((property, property), |(key, value)| {
                        (key.trim(), value.trim())
                    });
                let (binding_name, property_default) = raw_binding
                    .split_once('=')
                    .map_or((raw_binding.trim(), None), |(name, value)| {
                        (name.trim(), Some(value.trim()))
                    });
                let property_value = dangerous_html_katex_object_property(
                    object_argument,
                    property_name.trim_matches(['\'', '"']),
                )
                .flatten()
                .or_else(|| property_default.map(ToString::to_string));
                if let Some(property_value) = property_value {
                    bindings.push((binding_name.to_string(), property_value));
                }
            }
        } else if let Some(argument) = argument {
            bindings.push((binding.to_string(), argument.to_string()));
        }
    }
    bindings
}

fn dangerous_html_katex_object_property(
    raw_object: &str,
    property_name: &str,
) -> Option<Option<String>> {
    let object = dangerous_html_strip_expression_wrappers(raw_object);
    if !object.starts_with('{') {
        return None;
    }
    let end = dangerous_html_matching_delimiter(object, 0, '{', '}')?;
    let mut result = Some(None);
    for property in dangerous_html_split_top_level(&object[1..end], ',') {
        let property = property.trim();
        if property.starts_with("...") {
            result = None;
            continue;
        }
        let (key, value) = property
            .split_once(':')
            .map_or((property, property), |(key, value)| {
                (key.trim(), value.trim())
            });
        if key.trim_matches(['\'', '"']) == property_name {
            result = Some(Some(value.to_string()));
        }
    }
    result
}

fn dangerous_html_substitute_katex_bindings(
    expression: &str,
    bindings: &[(String, String)],
) -> String {
    let mut result = expression.to_string();
    for (parameter, argument) in bindings.iter().rev() {
        if let Ok(pattern) = Regex::new(&format!(
            r"\b{}\b",
            dangerous_html_escape_js_regex_literal(parameter)
        )) {
            result =
                dangerous_html_js_regex_replace_all(&pattern, &result, &format!("({argument})"));
        }
    }
    result
}

fn dangerous_html_local_function_source<'a>(
    identifier: &str,
    source: &'a str,
    usage_index: usize,
) -> Option<(Vec<String>, &'a str)> {
    let prefix = &source[..usage_index.min(source.len())];
    let normalized_prefix = super::normalize_js_regex_content::normalize_js_regex_content(prefix);
    let escaped = dangerous_html_escape_js_regex_literal(identifier);
    let function_pattern = Regex::new(&format!(
        r"(?s)(?:export\s+)?(?:async\s+)?function\s+{escaped}\s*\(([^)]*)\)\s*(?:\:[^{{]+)?\s*\{{"
    ))
    .ok()?;
    let arrow_pattern = Regex::new(&format!(
        r"(?s)(?:export\s+)?(?:const|let|var)\s+{escaped}\s*(?:\:[^=;]+)?=\s*(?:async\s*)?\(([^)]*)\)\s*(?:\:[^=]+)?=>\s*"
    ))
    .ok()?;
    let single_arrow_pattern = Regex::new(&format!(
        r"(?s)(?:export\s+)?(?:const|let|var)\s+{escaped}\s*(?:\:[^=;]+)?=\s*(?:async\s*)?([A-Za-z_$][\w$]*)\s*=>\s*"
    ))
    .ok()?;
    let mut candidates = Vec::new();
    for captures in function_pattern.captures_iter(normalized_prefix.as_ref()) {
        if let (Some(full_match), Some(parameters)) = (captures.get(0), captures.get(1)) {
            candidates.push((
                full_match.start(),
                &prefix[parameters.start()..parameters.end()],
                full_match.end() - 1,
                true,
            ));
        }
    }
    for captures in arrow_pattern.captures_iter(normalized_prefix.as_ref()) {
        if let (Some(full_match), Some(parameters)) = (captures.get(0), captures.get(1)) {
            candidates.push((
                full_match.start(),
                &prefix[parameters.start()..parameters.end()],
                full_match.end(),
                prefix[full_match.end()..].trim_start().starts_with('{'),
            ));
        }
    }
    for captures in single_arrow_pattern.captures_iter(normalized_prefix.as_ref()) {
        if let (Some(full_match), Some(parameter)) = (captures.get(0), captures.get(1)) {
            candidates.push((
                full_match.start(),
                &prefix[parameter.start()..parameter.end()],
                full_match.end(),
                prefix[full_match.end()..].trim_start().starts_with('{'),
            ));
        }
    }
    let (_, parameters, mut body_start, is_block) =
        candidates.into_iter().max_by_key(|value| value.0)?;
    while source
        .as_bytes()
        .get(body_start)
        .is_some_and(u8::is_ascii_whitespace)
    {
        body_start += 1;
    }
    let body_end = if is_block {
        dangerous_html_matching_delimiter(source, body_start, '{', '}')? + 1
    } else {
        dangerous_html_expression_end(source, body_start)
    };
    Some((
        dangerous_html_split_top_level(parameters, ','),
        &source[body_start..body_end],
    ))
}

fn dangerous_html_katex_cross_file_call_proof(
    callee: &str,
    arguments: &[String],
    source: &str,
    filename: &Path,
    depth: usize,
    visited: &mut Vec<String>,
) -> Option<DangerousHtmlKatexProof> {
    if dangerous_html_cross_file_depth(visited) >= DANGEROUS_HTML_CROSS_FILE_PROOF_MAX_DEPTH {
        return Some(DANGEROUS_HTML_UNSUPPORTED_KATEX_PROOF);
    }
    let local_name = dangerous_html_bare_katex_identifier(callee)?;
    let escaped = dangerous_html_escape_js_regex_literal(local_name);
    let import_pattern = Regex::new(&format!(
        r#"(?s)import\s*\{{([^}}]*\b(?:[A-Za-z_$][\w$]*\s+as\s+)?{escaped}\b[^}}]*)\}}\s*from\s*["']([^"']+)["']"#
    ))
    .ok()?;
    let normalized_source = super::normalize_js_regex_content::normalize_js_regex_content(source);
    let captures = import_pattern.captures(normalized_source.as_ref())?;
    let specifiers = dangerous_html_original_capture(source, &captures, 1)?;
    let import_source = dangerous_html_original_capture(source, &captures, 2)?;
    let normalized_specifiers =
        super::normalize_js_regex_content::normalize_js_regex_content(specifiers);
    let imported_name = Regex::new(&format!(
        r"\b([A-Za-z_$][\w$]*)\s+as\s+{}\b",
        dangerous_html_escape_js_regex_literal(local_name)
    ))
    .ok()
    .and_then(|pattern| pattern.captures(normalized_specifiers.as_ref()))
    .and_then(|captures| dangerous_html_original_capture(specifiers, &captures, 1))
    .unwrap_or(local_name);
    let resolved_path = dangerous_html_resolve_import(filename, import_source)?;
    let resolved_source = dangerous_html_read_cross_file_source(&resolved_path)?;
    let resolved_marker = dangerous_html_cross_file_marker(&resolved_path);
    if visited
        .iter()
        .any(|candidate| candidate == &resolved_marker)
    {
        return None;
    }
    if let Some((parameters, function_source)) =
        dangerous_html_local_function_source(imported_name, &resolved_source, resolved_source.len())
    {
        visited.push(resolved_marker);
        let proof = dangerous_html_katex_function_source_proof(
            function_source,
            &dangerous_html_katex_bindings(&parameters, arguments),
            &resolved_source,
            resolved_source.len(),
            &resolved_path,
            depth + 1,
            visited,
        );
        visited.pop();
        return proof;
    }
    let reexport_pattern = Regex::new(&format!(
        r#"export\s*\{{[^}}]*\b{imported_name}\b[^}}]*\}}\s*from\s*["']([^"']+)["']"#
    ))
    .ok()?;
    let normalized_resolved_source =
        super::normalize_js_regex_content::normalize_js_regex_content(&resolved_source);
    let next_source = reexport_pattern
        .captures(normalized_resolved_source.as_ref())
        .and_then(|captures| dangerous_html_original_capture(&resolved_source, &captures, 1))?;
    let next_path = dangerous_html_resolve_import(&resolved_path, next_source)?;
    let next_file_source = dangerous_html_read_cross_file_source(&next_path)?;
    let next_marker = dangerous_html_cross_file_marker(&next_path);
    if visited.iter().any(|candidate| candidate == &next_marker) {
        return None;
    }
    let (parameters, function_source) = dangerous_html_local_function_source(
        imported_name,
        &next_file_source,
        next_file_source.len(),
    )?;
    visited.push(next_marker);
    let proof = dangerous_html_katex_function_source_proof(
        function_source,
        &dangerous_html_katex_bindings(&parameters, arguments),
        &next_file_source,
        next_file_source.len(),
        &next_path,
        depth + 1,
        visited,
    );
    visited.pop();
    proof
}

fn dangerous_html_katex_cross_file_property_proof(
    callee: &str,
    arguments: &[String],
    property: &str,
    source: &str,
    filename: &Path,
    depth: usize,
    visited: &mut Vec<String>,
) -> Option<DangerousHtmlKatexProof> {
    if dangerous_html_cross_file_depth(visited) >= DANGEROUS_HTML_CROSS_FILE_PROOF_MAX_DEPTH {
        return Some(DANGEROUS_HTML_UNSUPPORTED_KATEX_PROOF);
    }
    let local_name = dangerous_html_bare_katex_identifier(callee)?;
    let escaped = dangerous_html_escape_js_regex_literal(local_name);
    let import_pattern = Regex::new(&format!(
        r#"(?s)import\s*\{{([^}}]*\b(?:[A-Za-z_$][\w$]*\s+as\s+)?{escaped}\b[^}}]*)\}}\s*from\s*["']([^"']+)["']"#
    ))
    .ok()?;
    let normalized_source = super::normalize_js_regex_content::normalize_js_regex_content(source);
    let captures = import_pattern.captures(normalized_source.as_ref())?;
    let specifiers = dangerous_html_original_capture(source, &captures, 1)?;
    let import_source = dangerous_html_original_capture(source, &captures, 2)?;
    let normalized_specifiers =
        super::normalize_js_regex_content::normalize_js_regex_content(specifiers);
    let imported_name = Regex::new(&format!(
        r"\b([A-Za-z_$][\w$]*)\s+as\s+{}\b",
        dangerous_html_escape_js_regex_literal(local_name)
    ))
    .ok()
    .and_then(|pattern| pattern.captures(normalized_specifiers.as_ref()))
    .and_then(|captures| dangerous_html_original_capture(specifiers, &captures, 1))
    .unwrap_or(local_name);
    let resolved_path = dangerous_html_resolve_import(filename, import_source)?;
    let resolved_source = dangerous_html_read_cross_file_source(&resolved_path)?;
    let resolved_marker = dangerous_html_cross_file_marker(&resolved_path);
    if visited
        .iter()
        .any(|candidate| candidate == &resolved_marker)
    {
        return None;
    }
    let (parameters, function_source) = dangerous_html_local_function_source(
        imported_name,
        &resolved_source,
        resolved_source.len(),
    )?;
    visited.push(resolved_marker);
    let proof = dangerous_html_katex_property_source_proof(
        function_source,
        property,
        &dangerous_html_katex_bindings(&parameters, arguments),
        &resolved_source,
        resolved_source.len(),
        &resolved_path,
        depth + 1,
        visited,
    );
    visited.pop();
    proof
}

fn dangerous_html_cross_file_depth(visited: &[String]) -> usize {
    visited
        .iter()
        .filter(|candidate| candidate.starts_with("file:"))
        .count()
}

fn dangerous_html_cross_file_marker(path: &Path) -> String {
    format!("file:{}", path.to_string_lossy())
}

fn dangerous_html_read_cross_file_source(path: &Path) -> Option<String> {
    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file()
        || metadata.len() > DANGEROUS_HTML_CROSS_FILE_PARSE_MAX_BYTES
        || dangerous_html_is_declaration_file(path)
    {
        return None;
    }
    let modified = metadata.modified().ok()?;
    let cache = DANGEROUS_HTML_CROSS_FILE_CACHE
        .get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()));
    if let Ok(cache) = cache.lock()
        && let Some(entry) = cache.get(path)
        && entry.modified == modified
        && entry.size == metadata.len()
    {
        return entry.source.clone();
    }
    let source = std::fs::read_to_string(path).ok();
    if let Ok(mut cache) = cache.lock() {
        let existing_size = cache.get(path).map_or(0, |entry| entry.size);
        let cached_bytes = cache
            .values()
            .map(|entry| entry.size)
            .fold(0_u64, u64::saturating_add);
        let projected_bytes = cached_bytes
            .saturating_sub(existing_size)
            .saturating_add(metadata.len());
        if (cache.len() >= DANGEROUS_HTML_CROSS_FILE_CACHE_MAX_ENTRIES && !cache.contains_key(path))
            || projected_bytes > DANGEROUS_HTML_CROSS_FILE_CACHE_MAX_BYTES
        {
            cache.clear();
        }
        cache.insert(
            path.to_path_buf(),
            DangerousHtmlCrossFileCacheEntry {
                modified,
                size: metadata.len(),
                source: source.clone(),
            },
        );
    }
    source
}

fn dangerous_html_is_declaration_file(path: &Path) -> bool {
    let filename = path.to_string_lossy();
    filename.ends_with(".d.ts") || filename.ends_with(".d.mts") || filename.ends_with(".d.cts")
}

fn dangerous_html_resolve_import(filename: &Path, import_source: &str) -> Option<PathBuf> {
    if Path::new(import_source).is_absolute() {
        return None;
    }
    let candidate = if import_source.starts_with('.') {
        filename.parent()?.join(import_source)
    } else {
        dangerous_html_resolve_tsconfig_alias(filename, import_source)?
    };
    dangerous_html_resolve_source_path(&candidate)
}

fn dangerous_html_resolve_source_path(candidate: &Path) -> Option<PathBuf> {
    if candidate.is_file() {
        return Some(candidate.to_path_buf());
    }
    let source_extension = candidate
        .extension()
        .and_then(|extension| extension.to_str());
    let replacement_extensions: &[&str] = match source_extension {
        Some("js") => &["ts", "tsx", "jsx"],
        Some("jsx") => &["tsx"],
        Some("mjs") => &["mts"],
        Some("cjs") => &["cts"],
        Some("ts" | "tsx" | "mts" | "cts") => &[],
        _ => &["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"],
    };
    for extension in replacement_extensions {
        let with_extension = candidate.with_extension(*extension);
        if with_extension.is_file() {
            return Some(with_extension);
        }
    }
    for filename in [
        "index.ts",
        "index.tsx",
        "index.js",
        "index.jsx",
        "index.mts",
        "index.cts",
        "index.mjs",
        "index.cjs",
    ] {
        let index = candidate.join(filename);
        if index.is_file() {
            return Some(index);
        }
    }
    None
}

fn dangerous_html_resolve_tsconfig_alias(filename: &Path, import_source: &str) -> Option<PathBuf> {
    let mut directory = filename.parent()?;
    for _ in 0..DANGEROUS_HTML_DIRECTORY_WALK_MAX_LEVELS {
        for config_filename in ["tsconfig.json", "jsconfig.json"] {
            let config_path = directory.join(config_filename);
            let Some(config_source) = dangerous_html_read_small_text_file(&config_path) else {
                continue;
            };
            let Some(config) = dangerous_html_parse_jsonc(&config_source) else {
                continue;
            };
            let Some(compiler_options) = config
                .get("compilerOptions")
                .and_then(serde_json::Value::as_object)
            else {
                continue;
            };
            let base_url = compiler_options
                .get("baseUrl")
                .and_then(serde_json::Value::as_str);
            let base_directory = directory.join(base_url.unwrap_or("."));
            let paths = compiler_options
                .get("paths")
                .and_then(serde_json::Value::as_object);
            if let Some(paths) = paths {
                let mut matching_aliases = paths
                    .iter()
                    .filter_map(|(alias, targets)| {
                        dangerous_html_match_alias(import_source, alias)
                            .map(|capture| (alias, targets, capture))
                    })
                    .collect::<Vec<_>>();
                matching_aliases.sort_by_key(|(alias, _, _)| {
                    std::cmp::Reverse(alias.find('*').unwrap_or(alias.len()))
                });
                for (_, targets, capture) in matching_aliases {
                    let Some(targets) = targets.as_array() else {
                        continue;
                    };
                    for target in targets {
                        let Some(target) = target.as_str() else {
                            continue;
                        };
                        let candidate = base_directory.join(target.replace('*', &capture));
                        if dangerous_html_resolve_source_path(&candidate).is_some() {
                            return Some(candidate);
                        }
                    }
                }
            }
            if base_url.is_some() {
                let candidate = base_directory.join(import_source);
                if dangerous_html_resolve_source_path(&candidate).is_some() {
                    return Some(candidate);
                }
            }
            if paths.is_some() || base_url.is_some() {
                return None;
            }
        }
        let Some(parent) = directory.parent() else {
            return None;
        };
        directory = parent;
    }
    None
}

fn dangerous_html_match_alias(import_source: &str, alias: &str) -> Option<String> {
    let Some(wildcard_index) = alias.find('*') else {
        return (import_source == alias).then(String::new);
    };
    let prefix = &alias[..wildcard_index];
    let suffix = &alias[wildcard_index + 1..];
    (import_source.len() >= prefix.len() + suffix.len()
        && import_source.starts_with(prefix)
        && import_source.ends_with(suffix))
    .then(|| import_source[prefix.len()..import_source.len() - suffix.len()].to_string())
}

fn dangerous_html_read_small_text_file(path: &Path) -> Option<String> {
    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > DANGEROUS_HTML_CROSS_FILE_PARSE_MAX_BYTES {
        return None;
    }
    std::fs::read_to_string(path).ok()
}

fn dangerous_html_parse_jsonc(source: &str) -> Option<serde_json::Value> {
    let mut output = String::with_capacity(source.len());
    let mut characters = source.chars().peekable();
    let mut in_string = false;
    let mut is_escaped = false;
    while let Some(character) = characters.next() {
        if in_string {
            output.push(character);
            if is_escaped {
                is_escaped = false;
            } else if character == '\\' {
                is_escaped = true;
            } else if character == '"' {
                in_string = false;
            }
            continue;
        }
        if character == '"' {
            in_string = true;
            output.push(character);
            continue;
        }
        if character == '/' && characters.peek() == Some(&'/') {
            characters.next();
            for next_character in characters.by_ref() {
                if next_character == '\n' {
                    output.push('\n');
                    break;
                }
            }
            continue;
        }
        if character == '/' && characters.peek() == Some(&'*') {
            characters.next();
            let mut previous_character = '\0';
            for next_character in characters.by_ref() {
                if previous_character == '*' && next_character == '/' {
                    break;
                }
                previous_character = next_character;
            }
            continue;
        }
        output.push(character);
    }
    let trailing_comma_pattern = Regex::new(r",(\s*[}\]])").ok()?;
    serde_json::from_str(&trailing_comma_pattern.replace_all(&output, "$1")).ok()
}

fn dangerous_html_bare_katex_identifier(expression: &str) -> Option<&str> {
    let expression = dangerous_html_strip_expression_wrappers(expression);
    let end = expression
        .char_indices()
        .take_while(|(_, character)| character.is_alphanumeric() || matches!(character, '_' | '$'))
        .last()
        .map(|(index, character)| index + character.len_utf8())?;
    (end == expression.len()).then_some(&expression[..end])
}

fn dangerous_html_top_level_keyword(value: &str, keyword: &str) -> Option<usize> {
    dangerous_html_find_top_level_operator(value, keyword)
}

fn dangerous_html_find_top_level_operator(value: &str, operator: &str) -> Option<usize> {
    let bytes = value.as_bytes();
    let operator_bytes = operator.as_bytes();
    let mut index = 0;
    let mut depth = 0_i32;
    let mut quote = None;
    let mut escaped = false;
    while index + operator_bytes.len() <= bytes.len() {
        let character = value[index..].chars().next()?;
        if let Some(active_quote) = quote {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == active_quote {
                quote = None;
            }
        } else if matches!(character, '\'' | '"' | '`') {
            quote = Some(character);
        } else if depth == 0 && bytes[index..].starts_with(operator_bytes) {
            return Some(index);
        } else if matches!(character, '(' | '[' | '{') {
            depth += 1;
        } else if matches!(character, ')' | ']' | '}') {
            depth -= 1;
        }
        index += character.len_utf8();
    }
    None
}

fn dangerous_html_matching_delimiter(
    value: &str,
    opening_index: usize,
    opening: char,
    closing: char,
) -> Option<usize> {
    if value[opening_index..].chars().next()? != opening {
        return None;
    }
    let mut depth = 0_i32;
    let mut quote = None;
    let mut escaped = false;
    for (relative_index, character) in value[opening_index..].char_indices() {
        if let Some(active_quote) = quote {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == active_quote {
                quote = None;
            }
            continue;
        }
        if matches!(character, '\'' | '"' | '`') {
            quote = Some(character);
        } else if character == opening {
            depth += 1;
        } else if character == closing {
            depth -= 1;
            if depth == 0 {
                return Some(opening_index + relative_index);
            }
        }
    }
    None
}

fn dangerous_html_expression_end(source: &str, start: usize) -> usize {
    let mut depth = 0_i32;
    let mut quote = None;
    let mut escaped = false;
    for (relative_index, character) in source[start..].char_indices() {
        if let Some(active_quote) = quote {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == active_quote {
                quote = None;
            }
            continue;
        }
        if matches!(character, '\'' | '"' | '`') {
            quote = Some(character);
        } else if matches!(character, '(' | '[' | '{') {
            depth += 1;
        } else if matches!(character, ')' | ']' | '}') {
            if depth == 0 {
                return start + relative_index;
            }
            depth -= 1;
        } else if depth == 0 && matches!(character, ';' | '\n' | ',') {
            return start + relative_index;
        }
    }
    source.len()
}

fn dangerous_html_is_tainted(
    expression: &str,
    source: &str,
    sink_index: usize,
    visited_identifiers: &mut Vec<String>,
    visited_call_sites: &mut Vec<usize>,
) -> bool {
    let expression = expression.trim();
    if dangerous_html_explicitly_trusted(expression, source, sink_index, &mut Vec::new()) {
        return false;
    }
    let Some(identifier) = dangerous_html_taint_identifier(expression) else {
        return dangerous_html_js_regex_is_match(&DANGEROUS_HTML_TAINT_PATTERN, expression);
    };
    if dangerous_html_is_destructured_parameter(identifier, sink_index, source) {
        return true;
    }
    if visited_identifiers
        .iter()
        .any(|candidate| candidate == identifier)
    {
        return false;
    }
    visited_identifiers.push(identifier.to_string());

    let declaration = dangerous_html_visible_declaration(identifier, sink_index, source);
    let parameter_source =
        dangerous_html_containing_parameter_source(identifier, sink_index, source);
    let declaration_shadows_parameter = declaration.as_ref().is_some_and(|declaration| {
        parameter_source.as_ref().is_none_or(|parameter_source| {
            declaration.declaration_index > parameter_source.declaration_name_index
        })
    });
    if declaration_shadows_parameter {
        let Some(declaration) = declaration.as_ref() else {
            return dangerous_html_js_regex_is_match(&DANGEROUS_HTML_TAINT_PATTERN, expression);
        };
        if dangerous_html_declaration_is_stable(identifier, declaration, sink_index, source)
            && dangerous_html_explicitly_trusted(
                &declaration.initializer,
                source,
                declaration.initializer_index,
                &mut Vec::new(),
            )
        {
            return false;
        }
        if !dangerous_html_declaration_is_stable(identifier, declaration, sink_index, source) {
            return true;
        }
        if dangerous_html_is_tainted(
            &declaration.initializer,
            source,
            declaration.initializer_index,
            visited_identifiers,
            visited_call_sites,
        ) {
            return true;
        }
        if dangerous_html_is_backed_by_parameter(
            &declaration.initializer,
            declaration.initializer_index,
            source,
            &mut Vec::new(),
        ) {
            return false;
        }
        return dangerous_html_js_regex_is_match(&DANGEROUS_HTML_TAINT_PATTERN, expression);
    }

    let Some(parameter_source) = parameter_source else {
        return dangerous_html_js_regex_is_match(&DANGEROUS_HTML_TAINT_PATTERN, expression);
    };
    if parameter_source.function_name.is_empty() {
        return dangerous_html_js_regex_is_match(&DANGEROUS_HTML_TAINT_PATTERN, expression);
    }
    let Ok(call_pattern) = Regex::new(&format!(
        r"\b{}\s*\(",
        dangerous_html_escape_js_regex_literal(&parameter_source.function_name)
    )) else {
        return dangerous_html_js_regex_is_match(&DANGEROUS_HTML_TAINT_PATTERN, expression);
    };
    let normalized_source = super::normalize_js_regex_content::normalize_js_regex_content(source);
    let mut did_inspect_call_argument = false;
    for call_match in call_pattern.find_iter(normalized_source.as_ref()) {
        if call_match.start() == parameter_source.declaration_name_index
            || visited_call_sites.contains(&call_match.start())
        {
            continue;
        }
        let opening_parenthesis_index = call_match.end() - 1;
        let Some(closing_parenthesis_index) =
            dangerous_html_matching_delimiter(source, opening_parenthesis_index, '(', ')')
        else {
            continue;
        };
        let arguments = dangerous_html_split_top_level(
            &source[opening_parenthesis_index + 1..closing_parenthesis_index],
            ',',
        );
        let Some(argument) = arguments.get(parameter_source.parameter_index) else {
            continue;
        };
        let call_is_inside_function = call_match.start() >= parameter_source.declaration_name_index
            && call_match.start() <= parameter_source.body_end_index;
        if call_is_inside_function
            && dangerous_html_expression_aliases_identifier(
                argument,
                identifier,
                call_match.start(),
                source,
                &mut Vec::new(),
            )
        {
            continue;
        }
        did_inspect_call_argument = true;
        let mut next_visited_identifiers = visited_identifiers.clone();
        next_visited_identifiers.retain(|candidate| candidate != identifier);
        let mut next_visited_call_sites = visited_call_sites.clone();
        next_visited_call_sites.push(call_match.start());
        if dangerous_html_is_tainted(
            argument,
            source,
            call_match.start(),
            &mut next_visited_identifiers,
            &mut next_visited_call_sites,
        ) {
            return true;
        }
    }
    if did_inspect_call_argument {
        return false;
    }
    let prefix_start = dangerous_html_floor_char_boundary(
        source,
        parameter_source.declaration_name_index.saturating_sub(48),
    );
    let declaration_prefix = &source[prefix_start..parameter_source.declaration_name_index];
    Regex::new(r"\bexport\s+(?:(?:default\s+)?(?:async\s+)?function|const|let|var)\s+$")
        .is_ok_and(|pattern| dangerous_html_js_regex_is_match(&pattern, declaration_prefix))
        || dangerous_html_js_regex_is_match(&DANGEROUS_HTML_TAINT_PATTERN, expression)
}

fn dangerous_html_taint_identifier(expression: &str) -> Option<&str> {
    let identifier = dangerous_html_root_identifier(expression)?;
    let remainder = expression[identifier.len()..].trim_start();
    (remainder.starts_with('.')
        || remainder.starts_with("||")
        || remainder.starts_with("??")
        || remainder.is_empty()
        || matches!(remainder.chars().next(), Some(';' | ',' | '}' | ')' | '\n')))
    .then_some(identifier)
}

fn dangerous_html_explicitly_trusted(
    expression: &str,
    source: &str,
    sink_index: usize,
    visited: &mut Vec<String>,
) -> bool {
    let parts = dangerous_html_split_top_level(expression.trim(), '+');
    if parts.len() > 1 {
        return parts
            .iter()
            .all(|part| dangerous_html_explicitly_trusted(part, source, sink_index, visited));
    }
    let interpolation_parts = dangerous_html_template_expression_parts(expression);
    if interpolation_parts.len() > 1 {
        return interpolation_parts
            .iter()
            .all(|part| dangerous_html_explicitly_trusted(part, source, sink_index, visited));
    }
    if dangerous_html_js_regex_is_match(
        &DANGEROUS_HTML_STRING_LITERAL_PATTERN,
        &format!("{expression};"),
    ) || dangerous_html_js_regex_is_match(
        &DANGEROUS_HTML_MODULE_CONSTANT_PATTERN,
        &format!("{expression};"),
    ) || dangerous_html_has_sanitizer(expression)
        || dangerous_html_js_regex_is_match(&DANGEROUS_HTML_ENV_PATTERN, expression)
        || dangerous_html_js_regex_is_match(&DANGEROUS_HTML_I18N_PATTERN, expression)
        || dangerous_html_js_regex_is_match(&DANGEROUS_HTML_SERIALIZER_CALL_PATTERN, expression)
        || dangerous_html_is_trusted_highlighter(expression, source, sink_index)
    {
        return true;
    }
    let Some(identifier) = dangerous_html_simple_access_root(expression) else {
        return false;
    };
    if visited.iter().any(|candidate| candidate == identifier)
        || !dangerous_html_is_simple_access(expression)
    {
        return false;
    }
    let Some(declaration) = dangerous_html_visible_declaration(identifier, sink_index, source)
    else {
        return false;
    };
    if dangerous_html_containing_parameter_source(identifier, sink_index, source).is_some_and(
        |parameter_source| declaration.declaration_index < parameter_source.declaration_name_index,
    ) {
        return false;
    }
    if !dangerous_html_declaration_is_stable(identifier, &declaration, sink_index, source) {
        return false;
    }
    visited.push(identifier.to_string());
    dangerous_html_explicitly_trusted(
        &declaration.initializer,
        source,
        declaration.initializer_index,
        visited,
    )
}

fn dangerous_html_template_expression_parts(expression: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut cursor = 0;
    while let Some(relative_start) = expression[cursor..].find("${") {
        let start = cursor + relative_start + 2;
        let Some(end) = dangerous_html_matching_delimiter(expression, start - 1, '{', '}') else {
            break;
        };
        parts.push(expression[start..end].to_string());
        cursor = end + 1;
    }
    parts
}

fn dangerous_html_is_simple_access(expression: &str) -> bool {
    let expression = expression.trim();
    let Some(root) = dangerous_html_root_identifier(expression) else {
        return false;
    };
    let mut cursor = root.len();
    while cursor < expression.len() {
        if expression[cursor..].starts_with("?.") {
            cursor += 2;
        } else if expression[cursor..].starts_with('.') {
            cursor += 1;
        } else if expression[cursor..].starts_with('[') {
            let Some(end) = dangerous_html_matching_delimiter(expression, cursor, '[', ']') else {
                return false;
            };
            let key = expression[cursor + 1..end].trim();
            if !(key.bytes().all(|byte| byte.is_ascii_digit())
                || (key.len() >= 2
                    && key.starts_with('"')
                    && key.ends_with('"')
                    && !key[1..key.len() - 1].contains('\n'))
                || (key.len() >= 2
                    && key.starts_with('\'')
                    && key.ends_with('\'')
                    && !key[1..key.len() - 1].contains('\n')))
            {
                return false;
            }
            cursor = end + 1;
            continue;
        } else {
            return false;
        }
        let Some(segment) = dangerous_html_root_identifier(&expression[cursor..]) else {
            return false;
        };
        cursor += segment.len();
    }
    true
}

fn dangerous_html_expression_aliases_identifier(
    expression: &str,
    target_identifier: &str,
    expression_index: usize,
    source: &str,
    visited: &mut Vec<String>,
) -> bool {
    let Some(identifier) = dangerous_html_bare_identifier(expression) else {
        return false;
    };
    if identifier == target_identifier {
        return true;
    }
    if visited.iter().any(|candidate| candidate == identifier) {
        return false;
    }
    let Some(declaration) =
        dangerous_html_visible_declaration(identifier, expression_index, source)
    else {
        return false;
    };
    if !declaration.is_immutable {
        return false;
    }
    visited.push(identifier.to_string());
    dangerous_html_expression_aliases_identifier(
        &declaration.initializer,
        target_identifier,
        declaration.initializer_index,
        source,
        visited,
    )
}

#[derive(Clone)]
struct DangerousHtmlParameterSource {
    body_end_index: usize,
    declaration_name_index: usize,
    function_name: String,
    parameter_index: usize,
}

fn dangerous_html_is_destructured_parameter(
    identifier: &str,
    sink_index: usize,
    source: &str,
) -> bool {
    let prefix_start = dangerous_html_floor_char_boundary(
        source,
        sink_index.saturating_sub(DANGEROUS_HTML_TEMPLATE_MAX_CHARS),
    );
    Regex::new(&format!(
        r"(?:function\s+[\w$]+|(?:const|let|var)\s+[\w$]+\s*=)\s*\(\s*\{{[^}}]*\b{}\b[^}}]*\}}",
        dangerous_html_escape_js_regex_literal(identifier)
    ))
    .is_ok_and(|pattern| {
        dangerous_html_js_regex_is_match(&pattern, &source[prefix_start..sink_index])
    })
}

fn dangerous_html_containing_parameter_source(
    identifier: &str,
    sink_index: usize,
    source: &str,
) -> Option<DangerousHtmlParameterSource> {
    let patterns = [
        Regex::new(r"function\s+([\w$]+)\s*\(([^)]*)\)\s*\{").ok()?,
        Regex::new(r"(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>\s*\{")
            .ok()?,
    ];
    let normalized_source = super::normalize_js_regex_content::normalize_js_regex_content(source);
    let mut closest = None;
    let mut closest_start = None;
    for pattern in patterns {
        for captures in pattern.captures_iter(normalized_source.as_ref()) {
            let full_match = captures.get(0)?;
            if full_match.start() >= sink_index
                || closest_start.is_some_and(|start| full_match.start() < start)
            {
                continue;
            }
            let opening_brace_index = full_match.end() - 1;
            let Some(body_end_index) =
                dangerous_html_matching_delimiter(source, opening_brace_index, '{', '}')
            else {
                continue;
            };
            if body_end_index < sink_index {
                continue;
            }
            let function_name = dangerous_html_original_capture(source, &captures, 1)?;
            let parameters = dangerous_html_original_capture(source, &captures, 2)?;
            let parameter_index = parameters.split(',').position(|parameter| {
                let parameter = parameter.trim().trim_start_matches("...");
                dangerous_html_root_identifier(parameter) == Some(identifier)
            });
            let Some(parameter_index) = parameter_index else {
                continue;
            };
            closest_start = Some(full_match.start());
            closest = Some(DangerousHtmlParameterSource {
                body_end_index,
                declaration_name_index: full_match.start()
                    + source[full_match.start()..full_match.end()].find(function_name)?,
                function_name: function_name.to_string(),
                parameter_index,
            });
        }
    }
    closest
}

fn dangerous_html_is_backed_by_parameter(
    expression: &str,
    expression_index: usize,
    source: &str,
    visited: &mut Vec<String>,
) -> bool {
    let Some(identifier) = dangerous_html_bare_identifier(expression) else {
        return false;
    };
    if visited.iter().any(|candidate| candidate == identifier) {
        return false;
    }
    if dangerous_html_containing_parameter_source(identifier, expression_index, source).is_some() {
        return true;
    }
    let Some(declaration) =
        dangerous_html_visible_declaration(identifier, expression_index, source)
    else {
        return false;
    };
    if !dangerous_html_declaration_is_stable(identifier, &declaration, expression_index, source) {
        return false;
    }
    visited.push(identifier.to_string());
    dangerous_html_is_backed_by_parameter(
        &declaration.initializer,
        declaration.initializer_index,
        source,
        visited,
    )
}

fn dangerous_html_visible_declaration(
    identifier: &str,
    sink_index: usize,
    source: &str,
) -> Option<DangerousHtmlDeclaration> {
    let pattern = Regex::new(&format!(
        r"(const|let|var)\s+{}\s*(?::[^=\n]*)?=\s*([^;\n]+)",
        dangerous_html_escape_js_regex_literal(identifier)
    ))
    .ok()?;
    let normalized_source = super::normalize_js_regex_content::normalize_js_regex_content(source);
    let mut nearest = None;
    let mut nearest_index = None;
    for captures in pattern.captures_iter(normalized_source.as_ref()) {
        let full_match = captures.get(0)?;
        if full_match.start() >= sink_index
            || nearest_index.is_some_and(|index| full_match.start() <= index)
            || dangerous_html_containing_block_end(source, full_match.start()) < sink_index
        {
            continue;
        }
        let initializer_match = captures.get(2)?;
        let initializer = dangerous_html_original_capture(source, &captures, 2)?;
        nearest_index = Some(full_match.start());
        nearest = Some(DangerousHtmlDeclaration {
            declaration_index: full_match.start(),
            initializer_index: initializer_match.start(),
            initializer: initializer.to_string(),
            is_immutable: dangerous_html_original_capture(source, &captures, 1)? == "const",
        });
    }
    nearest
}

fn dangerous_html_containing_block_end(source: &str, target_index: usize) -> usize {
    let mut opening_braces = Vec::new();
    let mut cursor = 0;
    let mut quote = None;
    let mut line_comment = false;
    let mut block_comment = false;
    while cursor < target_index {
        let character = source[cursor..].chars().next().unwrap_or('\0');
        let next = source.as_bytes().get(cursor + 1).copied();
        if line_comment {
            if character == '\n' {
                line_comment = false;
            }
            cursor += character.len_utf8();
            continue;
        }
        if block_comment {
            if character == '*' && next == Some(b'/') {
                block_comment = false;
                cursor += 2;
            } else {
                cursor += character.len_utf8();
            }
            continue;
        }
        if let Some(active_quote) = quote {
            if character == active_quote && !source[..cursor].ends_with('\\') {
                quote = None;
            }
            cursor += character.len_utf8();
            continue;
        }
        if character == '/' && next == Some(b'/') {
            line_comment = true;
            cursor += 2;
            continue;
        }
        if character == '/' && next == Some(b'*') {
            block_comment = true;
            cursor += 2;
            continue;
        }
        if matches!(character, '\'' | '"' | '`') {
            quote = Some(character);
        } else if character == '{' {
            opening_braces.push(cursor);
        } else if character == '}' {
            opening_braces.pop();
        }
        cursor += character.len_utf8();
    }
    opening_braces
        .last()
        .and_then(|opening| dangerous_html_matching_delimiter(source, *opening, '{', '}'))
        .unwrap_or(source.len())
}

fn dangerous_html_declaration_is_stable(
    identifier: &str,
    declaration: &DangerousHtmlDeclaration,
    sink_index: usize,
    source: &str,
) -> bool {
    if declaration.is_immutable {
        return true;
    }
    let start = declaration.initializer_index + declaration.initializer.len();
    let Some(text) = source.get(start..sink_index) else {
        return false;
    };
    Regex::new(&format!(
        r"(?:^|[^\w$.]){}\s*=",
        dangerous_html_escape_js_regex_literal(identifier)
    ))
    .is_ok_and(|pattern| {
        let normalized_text = super::normalize_js_regex_content::normalize_js_regex_content(text);
        !pattern
            .find_iter(normalized_text.as_ref())
            .any(|found| text.as_bytes().get(found.end()) != Some(&b'='))
    })
}

fn dangerous_html_file_serializer_assignment_is_trusted(identifier: &str, source: &str) -> bool {
    let escaped = dangerous_html_escape_js_regex_literal(identifier);
    Regex::new(&format!(
        r"(?i)\b{escaped}\b\s*[:=]\s*[^\n;]*(?:DOMPurify|sanitize\w*\s*\(|purify\w*\s*\(|(?:katex|shiki|hljs|prism|mermaid)|(?:toHtml|render[A-Za-z]*(?:Html|HTML)|renderToString|renderToStaticMarkup|codeToHtml|codeToHast)\s*\()"
    ))
    .is_ok_and(|pattern| dangerous_html_js_regex_is_match(&pattern, source))
}

fn dangerous_html_file_dom_assignment_is_trusted(identifier: &str, source: &str) -> bool {
    let escaped = dangerous_html_escape_js_regex_literal(identifier);
    Regex::new(&format!(
        r"\b{escaped}\b\s*=\s*[\w$.?\[\]]*\.(?:inner|outer)HTML\s*(?:[;,)\n]|$)"
    ))
    .is_ok_and(|pattern| dangerous_html_js_regex_is_match(&pattern, source))
}

fn dangerous_html_is_trusted_highlighter(value: &str, source: &str, sink_index: usize) -> bool {
    if !value.to_ascii_lowercase().contains("highlight") {
        return false;
    }
    let Some(identifier) = dangerous_html_root_identifier(value) else {
        return false;
    };
    if let Some(declaration) = dangerous_html_visible_declaration(identifier, sink_index, source) {
        return dangerous_html_declaration_is_stable(identifier, &declaration, sink_index, source)
            && dangerous_html_js_regex_is_match(
                &DANGEROUS_HTML_SERIALIZER_PROVENANCE_PATTERN,
                &declaration.initializer,
            );
    }
    value.to_ascii_lowercase().contains("highlighted")
        || dangerous_html_js_regex_is_match(&DANGEROUS_HTML_HIGHLIGHTER_LIBRARY_PATTERN, source)
}

fn dangerous_html_value_tail<'a>(
    window: &'a str,
    sink_offset: usize,
    sink_text: &str,
) -> Option<&'a str> {
    let after_sink = &window[sink_offset + sink_text.len()..];
    if sink_text == "dangerouslySetInnerHTML" {
        let normalized_after_sink =
            super::normalize_js_regex_content::normalize_js_regex_content(after_sink);
        let property_match = DANGEROUS_HTML_PROPERTY_VALUE_PATTERN.find(&normalized_after_sink)?;
        return Some(&after_sink[property_match.end()..]);
    }
    if sink_text.contains("insertAdjacentHTML") {
        let comma_index = dangerous_html_top_level_delimiter(after_sink, ',')?;
        return Some(&after_sink[comma_index + 1..]);
    }
    Some(after_sink)
}

fn dangerous_html_bounded_value_expression(value: &str) -> String {
    let value = value.trim_start();
    let value =
        &value[..dangerous_html_byte_index_at_utf16_limit(value, DANGEROUS_HTML_VALUE_MAX_CHARS)];
    let end = value
        .char_indices()
        .find(|(_, character)| matches!(character, ';' | '}'))
        .map_or(value.len(), |(index, character)| {
            index + character.len_utf8()
        });
    value[..end].to_string()
}

fn dangerous_html_bounded_katex_expression(value: &str) -> String {
    let value = value.trim_start();
    let value = &value
        [..dangerous_html_byte_index_at_utf16_limit(value, DANGEROUS_HTML_TEMPLATE_MAX_CHARS)];
    value[..dangerous_html_expression_end(value, 0)]
        .trim()
        .to_string()
}

fn dangerous_html_template_interpolations(value: &str) -> Option<String> {
    let value = value.trim_start();
    if !value.starts_with('`') {
        return None;
    }
    let close_index = value[1..].find('`')? + 1;
    if value[..close_index].encode_utf16().count() > DANGEROUS_HTML_TEMPLATE_MAX_CHARS {
        return None;
    }
    let body = &value[1..close_index];
    let mut interpolations = Vec::new();
    let mut start = 0;
    while let Some(relative_index) = body[start..].find("${") {
        let interpolation_start = start + relative_index;
        let Some(end_offset) = body[interpolation_start + 2..].find('}') else {
            break;
        };
        let interpolation_end = interpolation_start + 2 + end_offset + 1;
        interpolations.push(&body[interpolation_start..interpolation_end]);
        start = interpolation_end;
    }
    Some(interpolations.join(" "))
}

fn dangerous_html_is_pure_literal_concat(value: &str) -> bool {
    let value = value.trim_start();
    if !matches!(value.chars().next(), Some('"' | '\'')) {
        return false;
    }
    dangerous_html_split_top_level(value, '+')
        .iter()
        .all(|part| {
            let part = part.trim().trim_end_matches([',', ';', ')', '}', ']']);
            matches!(part.chars().next(), Some('"' | '\''))
                && part
                    .chars()
                    .next()
                    .and_then(|quote| dangerous_html_unescaped_quote_end(part, quote))
                    == Some(part.len() - 1)
        })
}

fn dangerous_html_all_concat_operands_are_dom_content(value: &str) -> bool {
    let parts = dangerous_html_split_top_level(value.trim().trim_end_matches([';', '}']), '+');
    parts.len() >= 2
        && parts.iter().all(|part| {
            let normalized = dangerous_html_remove_simple_type_cast(part.trim());
            dangerous_html_js_regex_is_match(&DANGEROUS_HTML_DOM_SOURCE_PATTERN, &normalized)
                && !dangerous_html_js_regex_is_match(
                    &DANGEROUS_HTML_TAINT_PATTERN,
                    &DANGEROUS_HTML_DOM_SOURCE_PATTERN.replace(&normalized, ""),
                )
        })
}

fn dangerous_html_expression_combines_values(value: &str) -> bool {
    dangerous_html_split_top_level(value, '+').len() > 1 || value.matches("${").count() > 1
}

fn dangerous_html_remove_simple_type_cast(value: &str) -> String {
    if value.starts_with('(') && value.contains(" as ") && value.ends_with(')') {
        let body = &value[1..value.len() - 1];
        if let Some((expression, _)) = body.split_once(" as ") {
            return expression.trim().to_string();
        }
    }
    value.to_string()
}

fn dangerous_html_split_top_level(value: &str, delimiter: char) -> Vec<String> {
    let mut parts = Vec::new();
    let mut start = 0;
    let mut depth = 0_i32;
    let mut quote = None;
    let mut escaped = false;
    let characters = value.char_indices().collect::<Vec<_>>();
    for (position, (index, character)) in characters.iter().enumerate() {
        if let Some(active_quote) = quote {
            if escaped {
                escaped = false;
            } else if *character == '\\' {
                escaped = true;
            } else if *character == active_quote {
                quote = None;
            }
            continue;
        }
        if matches!(character, '"' | '\'' | '`') {
            quote = Some(*character);
        } else if matches!(character, '(' | '[' | '{') {
            depth += 1;
        } else if matches!(character, ')' | ']' | '}') {
            depth -= 1;
        } else if *character == delimiter
            && depth == 0
            && characters
                .get(position.wrapping_sub(1))
                .map(|(_, value)| value)
                != Some(character)
            && characters.get(position + 1).map(|(_, value)| value) != Some(character)
        {
            parts.push(value[start..*index].to_string());
            start = *index + character.len_utf8();
        }
    }
    parts.push(value[start..].to_string());
    parts
}

fn dangerous_html_root_identifier(value: &str) -> Option<&str> {
    let value = value.trim_start();
    let end = value
        .char_indices()
        .take_while(|(_, character)| character.is_alphanumeric() || matches!(character, '_' | '$'))
        .last()
        .map(|(index, character)| index + character.len_utf8())?;
    Some(&value[..end])
}

fn dangerous_html_bare_identifier(value: &str) -> Option<&str> {
    let identifier = dangerous_html_root_identifier(value)?;
    let remainder = value.trim_start()[identifier.len()..].trim_start();
    (remainder.is_empty()
        || remainder.starts_with(|character| matches!(character, ';' | ',' | '}' | ')' | '\n')))
    .then_some(identifier)
}

fn dangerous_html_simple_access_root(value: &str) -> Option<&str> {
    let identifier = dangerous_html_root_identifier(value)?;
    let remainder = value.trim()[identifier.len()..].trim();
    (remainder.is_empty()
        || remainder
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_$.?[]'\"0123456789".contains(&byte)))
    .then_some(identifier)
}

fn dangerous_html_top_level_delimiter(value: &str, delimiter: char) -> Option<usize> {
    let mut depth = 0_i32;
    let mut quote = None;
    let mut escaped = false;
    for (index, character) in value.char_indices() {
        if let Some(active_quote) = quote {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == active_quote {
                quote = None;
            }
        } else if matches!(character, '"' | '\'' | '`') {
            quote = Some(character);
        } else if matches!(character, '(' | '[' | '{') {
            depth += 1;
        } else if matches!(character, ')' | ']' | '}') {
            depth -= 1;
        } else if character == delimiter && depth == 0 {
            return Some(index);
        }
    }
    None
}

fn dangerous_html_unescaped_quote_end(value: &str, quote: char) -> Option<usize> {
    let mut escaped = false;
    for (index, character) in value.char_indices().skip(1) {
        if escaped {
            escaped = false;
        } else if character == '\\' {
            escaped = true;
        } else if character == quote {
            return Some(index);
        }
    }
    None
}

fn dangerous_html_is_commented_sink(line: &str, sink_index: usize) -> bool {
    if line
        .trim_start()
        .chars()
        .next()
        .is_some_and(|character| matches!(character, '/' | '*'))
    {
        return true;
    }
    let prefix = &line[..sink_index];
    let mut without_strings = String::with_capacity(prefix.len());
    let mut quote = None;
    let mut escaped = false;
    for character in prefix.chars() {
        if let Some(active_quote) = quote {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == active_quote {
                quote = None;
            }
            without_strings.push(' ');
        } else if matches!(character, '"' | '\'' | '`') {
            quote = Some(character);
            without_strings.push(' ');
        } else {
            without_strings.push(character);
        }
    }
    without_strings
        .match_indices("//")
        .any(|(index, _)| index == 0 || without_strings.as_bytes().get(index - 1) != Some(&b':'))
}

fn dangerous_html_sink_target(line: &str, sink_index: usize) -> Option<&str> {
    let prefix = &line[..sink_index];
    let end = prefix
        .char_indices()
        .rev()
        .find(|(_, character)| !character.is_whitespace())
        .map(|(index, character)| index + character.len_utf8())?;
    let start = prefix[..end]
        .char_indices()
        .rev()
        .take_while(|(_, character)| {
            character.is_alphanumeric() || matches!(character, '_' | '$' | '.')
        })
        .last()
        .map_or(end, |(index, _)| index);
    (start < end).then_some(&prefix[start..end])
}

fn dangerous_html_is_inert_target(target: &str, source: &str) -> bool {
    let root = target.split('.').next().unwrap_or(target);
    let escaped_root = dangerous_html_escape_js_regex_literal(root);
    let escaped_target = dangerous_html_escape_js_regex_literal(target);
    let has_create_element = source.contains("createElement");
    let has_isolated_document = source.contains("createHTMLDocument");
    if !has_create_element && !has_isolated_document {
        return false;
    }
    if Regex::new(&format!(
        r#"\b{escaped_root}\s*=\s*[^\n;]*(?:getElementById|querySelector|getElementsBy|\.current\b|document\.(?:body|head|documentElement))"#
    ))
    .is_ok_and(|pattern| dangerous_html_js_regex_is_match(&pattern, source))
    {
        return false;
    }
    if has_create_element {
        if Regex::new(&format!(
            r#"{escaped_target}\s*=\s*document\.createElement\(\s*[\"'`]template[\"'`]"#
        ))
        .is_ok_and(|pattern| dangerous_html_js_regex_is_match(&pattern, source))
        {
            return true;
        }
        if Regex::new(&format!(
            r#"\b{escaped_root}\s*=\s*[^\n;]*\bcreateElement\(\s*[\"'`](?:style|textarea)[\"'`]"#
        ))
        .is_ok_and(|pattern| dangerous_html_js_regex_is_match(&pattern, source))
        {
            return true;
        }
    }
    if has_isolated_document
        && Regex::new(&format!(
            r"\b{escaped_root}\s*=\s*[^\n;]*\bcreateHTMLDocument\s*\("
        ))
        .is_ok_and(|pattern| dangerous_html_js_regex_is_match(&pattern, source))
    {
        return true;
    }
    if !has_create_element {
        return false;
    }
    let created = Regex::new(&format!(
        r"\b{escaped_root}\s*=\s*[^\n;]*\bcreateElement\s*\("
    ))
    .is_ok_and(|pattern| dangerous_html_js_regex_is_match(&pattern, source));
    if !created {
        return false;
    }
    let attached = Regex::new(&format!(
        r"\b(?:appendChild|append|prepend|before|after|replaceWith|replaceChild|replaceChildren|insertBefore|insertAdjacentElement)\s*\([^)]*\b{escaped_root}\b"
    ))
    .is_ok_and(|pattern| dangerous_html_js_regex_is_match(&pattern, source));
    let returned_as_node =
        Regex::new(&format!(r"\breturn\b[^\n]*\b{escaped_root}\b")).is_ok_and(|pattern| {
            let normalized_source =
                super::normalize_js_regex_content::normalize_js_regex_content(source);
            pattern.find_iter(normalized_source.as_ref()).any(|found| {
                let suffix = &source[found.end()..];
                !dangerous_html_js_regex_is_match(
                    &DANGEROUS_HTML_RETURNED_STRING_PROPERTY_PATTERN,
                    suffix,
                )
            })
        });
    let scratch_read = Regex::new(&format!(
        r"\b{escaped_root}\.(?:textContent|innerText|querySelector|querySelectorAll|children|childNodes)\b"
    ))
    .is_ok_and(|pattern| dangerous_html_js_regex_is_match(&pattern, source));
    !attached && !returned_as_node && scratch_read
}

fn dangerous_html_is_style_sink(lines: &[&str], line_index: usize, sink_index: usize) -> bool {
    let start = line_index.saturating_sub(5);
    let mut prefix = lines[start..line_index].join("\n");
    if !prefix.is_empty() {
        prefix.push('\n');
    }
    prefix.push_str(&lines[line_index][..sink_index]);
    let lowercase = prefix.to_ascii_lowercase();
    lowercase.rfind("<style").is_some_and(|style_index| {
        if lowercase[style_index + "<style".len()..]
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_alphanumeric() || character == '_')
        {
            return false;
        }
        let after_tag_name = &lowercase[style_index + "<style".len()..];
        !after_tag_name.contains('<') && !after_tag_name.contains('>')
    })
}

fn dangerous_html_byte_index_at_utf16_limit(value: &str, limit: usize) -> usize {
    let mut code_units = 0;
    for (index, character) in value.char_indices() {
        let character_units = character.len_utf16();
        if code_units + character_units > limit {
            return index;
        }
        code_units += character_units;
    }
    value.len()
}

fn dangerous_html_floor_char_boundary(value: &str, index: usize) -> usize {
    let mut boundary = index.min(value.len());
    while boundary > 0 && !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    boundary
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dangerous_html_finds_a_sink_after_an_equality_comparison() {
        let findings = scan(
            "src/preview.ts",
            "/tmp/preview.ts",
            "const same = first.innerHTML === value; second.innerHTML = props.html;",
            false,
        );
        assert_eq!(findings.len(), 1);
    }

    #[test]
    fn dangerous_html_requires_exact_html_property_syntax() {
        assert!(
            dangerous_html_value_tail(
                "dangerouslySetInnerHTML={{ __htmlValue: props.html }}",
                0,
                "dangerouslySetInnerHTML",
            )
            .is_none()
        );
    }

    #[test]
    fn dangerous_html_parameter_shadows_outer_static_binding() {
        let source = r#"const payload = "<p>Static</p>";
function inject(element, payload) {
  element.innerHTML = payload;
}"#;
        let sink_index = source.find(".innerHTML").unwrap();
        assert!(!dangerous_html_value_is_exempt(
            "payload;",
            None,
            None,
            source,
            sink_index,
            Path::new("src/preview.ts"),
        ));
    }

    #[test]
    fn dangerous_html_keeps_generic_serializer_exemptions() {
        assert!(dangerous_html_value_is_exempt(
            "renderPartialHTML(props.first) + renderPartialHTML(props.second);",
            None,
            None,
            "",
            0,
            Path::new("src/preview.ts"),
        ));
        let source = r#"import katex from "katex";"#;
        assert!(dangerous_html_value_is_exempt(
            "katex.renderToString(props.value, { trust: true });",
            None,
            None,
            source,
            source.len(),
            Path::new("src/preview.ts"),
        ));
    }

    #[test]
    fn dangerous_html_applies_env_exemption_after_unsafe_katex_proof() {
        let source = r#"import katex from "katex";"#;
        let value =
            "katex.renderToString(props.value, { trust: true }) || process.env.STATIC_HTML;";
        assert!(dangerous_html_value_is_exempt(
            value,
            None,
            Some(value),
            source,
            source.len(),
            Path::new("src/preview.tsx"),
        ));
    }

    #[test]
    fn dangerous_html_matches_exact_template_targets_with_backticks() {
        let exact_source = "holder.template = document.createElement(`template`);";
        assert!(dangerous_html_is_inert_target(
            "holder.template",
            exact_source
        ));
        let root_source = "holder = document.createElement(`template`);";
        assert!(!dangerous_html_is_inert_target(
            "holder.template",
            root_source
        ));
    }

    #[test]
    fn dangerous_html_style_tag_match_has_a_word_boundary() {
        assert!(dangerous_html_is_style_sink(
            &["<style dangerouslySetInnerHTML"],
            0,
            7,
        ));
        assert!(!dangerous_html_is_style_sink(
            &["<stylesheet dangerouslySetInnerHTML"],
            0,
            12,
        ));
    }

    #[test]
    fn dangerous_html_cross_file_limits_match_the_canonical_contract() {
        assert_eq!(DANGEROUS_HTML_CROSS_FILE_PROOF_MAX_DEPTH, 2);
        assert_eq!(DANGEROUS_HTML_CROSS_FILE_PARSE_MAX_BYTES, 2_000_000);
        assert_eq!(
            dangerous_html_cross_file_depth(&[
                "identifier".to_string(),
                "file:/tmp/one.ts".to_string(),
                "file:/tmp/two.ts".to_string(),
            ]),
            2,
        );
    }

    #[test]
    fn dangerous_html_call_parts_skips_grouped_receivers() {
        let (callee, arguments, _) =
            dangerous_html_call_parts("((props.value)).replaceAll(\"<\", \"&lt;\")").unwrap();

        assert_eq!(callee, "((props.value)).replaceAll");
        assert_eq!(arguments, ["\"<\"", "\"&lt;\""]);
    }

    #[test]
    fn dangerous_html_sanitizer_match_uses_javascript_non_unicode_case_folding() {
        assert!(dangerous_html_has_sanitizer("sanitizeHtml(props.html)"));
        assert!(!dangerous_html_has_sanitizer("ſanitizeHtml(props.html)"));
    }
}
