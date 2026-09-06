use lazy_regex::{Lazy, Regex, lazy_regex};

use super::{
    ScanFinding, get_location_at_index::get_location_at_index, scan_content::ScanContent,
};

const MESSAGE: &str =
    "Filesystem access appears to use request, query, params, or body data as part of the path.";

static FILE_ACCESS_CALL_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?-u:\b)(?:readFile|readFileSync|writeFile|writeFileSync)\s*\(");
static PATH_CALL_PATTERN: Lazy<Regex> = lazy_regex!(r"(?-u:\b)path\.(?:join|resolve)\s*\(");
static TAINT_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?-u:\b)(?:req\.|request\.|params\.|query\.|body\.|parsed\.)");

pub fn scan(relative_path: &str, source: &ScanContent<'_>) -> Vec<ScanFinding> {
    if !super::is_production_file_path::is_production_source_path(relative_path)
        || super::security_file_path::is_dev_tooling_path(relative_path)
    {
        return Vec::new();
    }
    let normalized = source.normalized_scannable(false);
    let file_match = FILE_ACCESS_CALL_PATTERN
        .find_iter(normalized.as_ref())
        .find(|found| file_access_argument_has_taint(normalized.as_ref(), found.end()));
    let path_match = PATH_CALL_PATTERN
        .find_iter(normalized.as_ref())
        .find(|found| path_argument_has_taint(normalized.as_ref(), found.end()));
    let found = match (file_match, path_match) {
        (Some(file_match), Some(path_match)) => {
            if file_match.start() <= path_match.start() {
                file_match
            } else {
                path_match
            }
        }
        (Some(found), None) | (None, Some(found)) => found,
        (None, None) => return Vec::new(),
    };
    let (line, column) = get_location_at_index(source, normalized.as_ref(), found.start());
    vec![ScanFinding::inherited(MESSAGE, line, column)]
}

fn file_access_argument_has_taint(source: &str, argument_start: usize) -> bool {
    let argument_start = skip_whitespace(source, argument_start);
    for prefix in ["req.", "request.", "params.", "query.", "body.", "parsed."] {
        if source[argument_start..].starts_with(prefix) {
            return true;
        }
    }
    if source.as_bytes().get(argument_start) != Some(&b'`') {
        return false;
    }
    let Some(template_end) = source[argument_start + 1..]
        .find('`')
        .map(|offset| argument_start + 1 + offset)
    else {
        return false;
    };
    let template = &source[argument_start + 1..template_end];
    TAINT_PATTERN.find_iter(template).any(|found| {
        !found.as_str().starts_with("parsed.") && taint_has_code_prefix(template, found.start())
    })
}

fn path_argument_has_taint(source: &str, argument_start: usize) -> bool {
    let argument_end = source[argument_start..]
        .find(')')
        .map_or(source.len(), |offset| argument_start + offset);
    let arguments = &source[argument_start..argument_end];
    taint_indices(arguments).any(|index| {
        taint_has_code_prefix(arguments, index) && !taint_is_inside_basename(arguments, index)
    })
}

fn taint_indices(source: &str) -> impl Iterator<Item = usize> + '_ {
    TAINT_PATTERN.find_iter(source).map(|found| found.start())
}

fn taint_has_code_prefix(source: &str, index: usize) -> bool {
    source[..index].chars().next_back().is_none_or(|character| {
        !character.is_ascii_alphanumeric()
            && !matches!(character, '-' | '_' | '.' | '/' | '$' | '\'' | '"' | '`')
    })
}

fn taint_is_inside_basename(source: &str, index: usize) -> bool {
    let prefix = &source[..index];
    let whitespace_start = prefix.trim_end_matches(is_javascript_whitespace).len();
    index - whitespace_start <= 4 && prefix[..whitespace_start].ends_with("basename(")
}

fn skip_whitespace(source: &str, mut cursor: usize) -> usize {
    while let Some(character) = source.get(cursor..).and_then(|text| text.chars().next()) {
        if !is_javascript_whitespace(character) {
            break;
        }
        cursor += character.len_utf8();
    }
    cursor
}

fn is_javascript_whitespace(character: char) -> bool {
    matches!(
        character,
        '\u{0009}'
            | '\u{000A}'
            | '\u{000B}'
            | '\u{000C}'
            | '\u{000D}'
            | '\u{0020}'
            | '\u{00A0}'
            | '\u{1680}'
            | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}
