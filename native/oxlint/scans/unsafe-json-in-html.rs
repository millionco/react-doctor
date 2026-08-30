use lazy_regex::{Lazy, Regex, lazy_regex};
use rustc_hash::FxHashSet;

use super::{ScanFinding, get_location_at_index::get_location_at_index};

const MESSAGE: &str = "JSON.stringify is embedded in HTML/script markup without HTML-escaping; data containing `</script>` or `<` breaks out and becomes XSS.";
const RETURN_LOOKAHEAD_CHARS: usize = 160;

static UNSAFE_JSON_DANGEROUS_SINK_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?is)dangerouslySetInnerHTML\s*=\s*\{\{\s*__html\s*:[\s\S]{0,300}?(?-u:\b)JSON\.stringify\s*\("
);
static UNSAFE_JSON_INLINE_SCRIPT_OPEN_PATTERN: Lazy<Regex> = lazy_regex!(r"(?i-u:<script\b)");
static UNSAFE_JSON_INLINE_SCRIPT_CLOSE_PATTERN: Lazy<Regex> = lazy_regex!(r"(?i-u:</script>)");
static UNSAFE_JSON_STRINGIFY_TOKEN_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i-u:\bJSON\.stringify\s*\()");
static UNSAFE_JSON_STRING_LITERAL_PATTERN: Lazy<Regex> =
    lazy_regex!(r#"\"(?:[^\"\\\n]|\\.)*\"|'(?:[^'\\\n]|\\.)*'"#);
static UNSAFE_JSON_KEYWORD_OR_NUMBER_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i-u)\b(?:true|false|null)\b|[\d.]+(?:e[+-]?\d+)?");
static UNSAFE_JSON_ESCAPE_WRAPPER_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?:(?-u:\b)(?:escapeHtml|escapeJSON|escapeJson|htmlEscape|jsesc)|(?:^|[^.A-Za-z0-9_])(?:serialize|serializeJavascript|devalue|uneval|superjson))\s*\(\s*$"
);
pub fn scan(relative_path: &str, source: &str) -> Vec<ScanFinding> {
    if !super::is_production_file_path::is_production_source_path(relative_path)
        || !source.contains("JSON.stringify")
    {
        return Vec::new();
    }
    let comment_stripped =
        super::strip_comments_preserving_positions::strip_comments_preserving_positions(source);
    let scannable =
        super::normalize_js_regex_content::normalize_js_regex_content(&comment_stripped);
    let mut seen_sink_indices = FxHashSet::default();
    let mut finding_indices = Vec::new();

    for sink_match in UNSAFE_JSON_DANGEROUS_SINK_PATTERN.find_iter(&scannable) {
        let sink_text = &scannable[sink_match.start()..sink_match.end()];
        let Some(stringify_match) = UNSAFE_JSON_STRINGIFY_TOKEN_PATTERN
            .find_iter(sink_text)
            .last()
        else {
            continue;
        };
        let stringify_index = sink_match.start() + stringify_match.start();
        if !unsafe_json_sink_is_safe(&scannable, stringify_index, sink_match.start())
            && seen_sink_indices.insert(sink_match.start())
        {
            finding_indices.push(sink_match.start());
        }
    }

    let mut search_start = 0;
    while let Some(script_open) =
        UNSAFE_JSON_INLINE_SCRIPT_OPEN_PATTERN.find(&scannable[search_start..])
    {
        let open_script_index = search_start + script_open.start();
        let after_script_open = search_start + script_open.end();
        search_start = after_script_open;
        let Some(tag_close_offset) = scannable[after_script_open..].find('>') else {
            continue;
        };
        let body_start = after_script_open + tag_close_offset + 1;
        let body_end = UNSAFE_JSON_INLINE_SCRIPT_CLOSE_PATTERN
            .find(&scannable[body_start..])
            .map_or(scannable.len(), |script_close| {
                body_start + script_close.start()
            });
        let Some(stringify_match) =
            UNSAFE_JSON_STRINGIFY_TOKEN_PATTERN.find(&scannable[body_start..body_end])
        else {
            continue;
        };
        let stringify_index = body_start + stringify_match.start();
        let between_tag_and_stringify = &scannable[body_start..stringify_index];
        if between_tag_and_stringify.encode_utf16().count() > 300 {
            continue;
        }
        search_start = stringify_index + stringify_match.end() - stringify_match.start();
        if !unsafe_json_has_markup_junction(between_tag_and_stringify)
            || unsafe_json_is_jsx_expression_child(between_tag_and_stringify)
            || unsafe_json_sink_is_safe(&scannable, stringify_index, open_script_index)
        {
            continue;
        }
        if seen_sink_indices.insert(open_script_index) {
            finding_indices.push(open_script_index);
        }
    }

    finding_indices
        .into_iter()
        .map(|sink_index| {
            let (line, column) = get_location_at_index(source, &scannable, sink_index);
            ScanFinding::inherited(MESSAGE, line, column)
        })
        .collect()
}

fn unsafe_json_sink_is_safe(source: &str, stringify_index: usize, sink_index: usize) -> bool {
    if UNSAFE_JSON_ESCAPE_WRAPPER_PATTERN.is_match(&source[sink_index..stringify_index]) {
        return true;
    }
    let Some(open_parenthesis_offset) = source[stringify_index..].find('(') else {
        return false;
    };
    let open_parenthesis_index = stringify_index + open_parenthesis_offset;
    let Some(close_parenthesis_index) =
        unsafe_json_matching_bracket(source, open_parenthesis_index, '(', ')')
    else {
        return false;
    };
    let return_start = close_parenthesis_index + 1;
    let return_end = return_start
        + unsafe_json_byte_index_at_utf16_limit(&source[return_start..], RETURN_LOOKAHEAD_CHARS);
    if unsafe_json_has_return_escape(&source[close_parenthesis_index + 1..return_end]) {
        return true;
    }
    unsafe_json_is_fully_static_argument(
        &source[open_parenthesis_index + 1..close_parenthesis_index],
    )
}

fn unsafe_json_byte_index_at_utf16_limit(value: &str, limit: usize) -> usize {
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

fn unsafe_json_has_return_escape(after_return: &str) -> bool {
    let trimmed = after_return
        .trim_start_matches(|character: char| is_js_whitespace(character) || character == ')');
    let Some(after_replace) = trimmed.strip_prefix(".replace") else {
        return false;
    };
    let after_replace = after_replace.trim_start_matches(is_js_whitespace);
    if !after_replace.starts_with('(') {
        return false;
    }
    let close_parenthesis_index = after_replace[1..]
        .find(')')
        .map_or(after_replace.len(), |offset| 1 + offset);
    let arguments = &after_replace[1..close_parenthesis_index];
    arguments.contains("\\u003c")
        || arguments.contains("\\u003C")
        || arguments.contains("&lt;")
        || arguments.contains('<')
}

fn unsafe_json_is_fully_static_argument(argument: &str) -> bool {
    if argument.contains('`') || argument.contains("${") {
        return false;
    }
    let without_strings = UNSAFE_JSON_STRING_LITERAL_PATTERN.replace_all(argument, "");
    let without_keywords = UNSAFE_JSON_KEYWORD_OR_NUMBER_PATTERN.replace_all(&without_strings, "");
    !without_keywords
        .bytes()
        .any(|byte| byte.is_ascii_alphabetic() || matches!(byte, b'_' | b'$'))
}

fn unsafe_json_has_markup_junction(value: &str) -> bool {
    let trimmed = value.trim_end();
    value.contains("${")
        || trimmed.strip_suffix('+').is_some_and(|prefix| {
            matches!(prefix.trim_end().chars().last(), Some('"' | '\'' | '`'))
        })
}

fn unsafe_json_is_jsx_expression_child(value: &str) -> bool {
    let trimmed = value.trim_start();
    trimmed.starts_with('{') && !trimmed.starts_with("{{")
}

fn unsafe_json_matching_bracket(
    source: &str,
    opening_index: usize,
    opening: char,
    closing: char,
) -> Option<usize> {
    let mut depth = 0_u32;
    let mut quote = None;
    let mut is_escaped = false;
    for (relative_index, character) in source[opening_index..].char_indices() {
        if let Some(active_quote) = quote {
            if is_escaped {
                is_escaped = false;
            } else if character == '\\' {
                is_escaped = true;
            } else if character == active_quote {
                quote = None;
            }
            continue;
        }
        if matches!(character, '"' | '\'' | '`') {
            quote = Some(character);
        } else if character == opening {
            depth += 1;
        } else if character == closing {
            depth = depth.saturating_sub(1);
            if depth == 0 {
                return Some(opening_index + relative_index);
            }
        }
    }
    None
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
