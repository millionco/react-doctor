use lazy_regex::{Lazy, Regex, lazy_regex};

use super::ScanFinding;

const MESSAGE: &str = "Server-side fetch code appears to follow redirects for a URL shaped like caller-controlled input.";

static OUTBOUND_FETCH_START_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?-u:\b)(?:fetch|axios\.\s*(?:get|post|put|delete|head)|got(?:\.\s*(?:get|post))?)(?-u:\b)\s*\(\s*"
);
static CALLER_STYLE_URL_NAME_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i-u:\b(?:url|targetUrl|callbackUrl|redirectUrl|webhookUrl|companyUrl|websiteUrl|domainUrl|imageUrl|fetchUrl|next|return_to|returnTo|destination|location)\b)"
);
static DIRECT_REQUEST_INPUT_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?-u:\breq\.|\brequest\.(?:query|body|params|nextUrl)|\bsearchParams\b|\bparams\.|\bbody\.|\bquery\.)"
);
static INITIALIZER_REQUEST_INPUT_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?-u:\breq\.|\brequest\.|\bsearchParams\b|\$_(?:GET|POST|REQUEST))");
static SAFE_REDIRECT_MODE_PATTERN: Lazy<Regex> =
    lazy_regex!(r#"(?-u:\b)redirect\s*:\s*[\"'](?:manual|error)[\"']"#);
static AMBIENT_REQUEST_TOKEN_PATTERN: Lazy<Regex> = lazy_regex!(r"(?-u:\b)(params|body|query)\.");
static LOCAL_URL_SEARCH_PARAMS_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::[^=;\n]{0,80})?=\s*new\s+URLSearchParams(?-u:\b)"
);

pub fn scan(relative_path: &str, source: &str) -> Vec<ScanFinding> {
    if !super::security_file_path::is_server_route_source_path(relative_path)
        || !OUTBOUND_FETCH_START_PATTERN.is_match(source)
    {
        return Vec::new();
    }
    let lines = source.split('\n').collect::<Vec<_>>();
    let mut findings = Vec::new();
    for (line_index, line) in lines.iter().enumerate() {
        let Some(url_expression) = first_outbound_url_expression(line) else {
            continue;
        };
        if !CALLER_STYLE_URL_NAME_PATTERN.is_match(url_expression)
            || !is_request_sourced_url_expression(url_expression, source)
        {
            continue;
        }
        let fetch_window = lines[line_index..(line_index + 5).min(lines.len())].join("\n");
        let normalized_fetch_window =
            super::normalize_js_regex_content::normalize_js_regex_content(&fetch_window);
        if SAFE_REDIRECT_MODE_PATTERN.is_match(normalized_fetch_window.as_ref()) {
            continue;
        }
        findings.push(ScanFinding::inherited(
            MESSAGE,
            line_index + 1,
            first_non_javascript_whitespace_column(line),
        ));
    }
    findings
}

fn first_outbound_url_expression(line: &str) -> Option<&str> {
    let normalized = super::normalize_js_regex_content::normalize_js_regex_content(line);
    for found in OUTBOUND_FETCH_START_PATTERN.find_iter(normalized.as_ref()) {
        if found.as_str().trim_start().starts_with("fetch")
            && normalized[..found.start()]
                .chars()
                .next_back()
                .is_some_and(|character| {
                    character == '.'
                        || character == '$'
                        || character == '_'
                        || character.is_ascii_alphanumeric()
                })
        {
            continue;
        }
        let expression_start = found.end();
        let expression_end = normalized[expression_start..]
            .find([',', ')'])
            .map_or(line.len(), |offset| expression_start + offset);
        return Some(&line[expression_start..expression_end]);
    }
    None
}

fn is_request_sourced_url_expression(expression: &str, source: &str) -> bool {
    if has_request_sourced_token(expression, source) {
        return true;
    }
    let identifier = expression.trim();
    if identifier.is_empty()
        || !identifier.chars().enumerate().all(|(index, character)| {
            character == '$'
                || character == '_'
                || character.is_ascii_alphanumeric() && (index > 0 || !character.is_ascii_digit())
        })
    {
        return false;
    }
    let assignment_pattern = Regex::new(&format!(
        r"(?:const|let|var)[^=;\n]{{0,80}}(?-u:\b){}(?-u:\b)[^=;\n]{{0,80}}=([^;\n]*)",
        lazy_regex::regex::escape(identifier)
    ))
    .expect("valid URL assignment pattern");
    for captures in assignment_pattern.captures_iter(source) {
        let initializer = captures.get(1).map_or("", |found| found.as_str());
        if INITIALIZER_REQUEST_INPUT_PATTERN.is_match(initializer)
            || has_request_sourced_token(initializer, source)
        {
            return true;
        }
    }
    false
}

fn has_request_sourced_token(expression: &str, source: &str) -> bool {
    if !DIRECT_REQUEST_INPUT_PATTERN.is_match(expression) {
        return false;
    }
    let mut without_local_tokens = String::with_capacity(expression.len());
    let mut previous_end = 0;
    for captures in AMBIENT_REQUEST_TOKEN_PATTERN.captures_iter(expression) {
        let Some(token) = captures.get(0) else {
            continue;
        };
        without_local_tokens.push_str(&expression[previous_end..token.start()]);
        let is_local = captures
            .get(1)
            .is_some_and(|binding| is_locally_constructed_binding(binding.as_str(), source));
        if !is_local {
            without_local_tokens.push_str(token.as_str());
        }
        previous_end = token.end();
    }
    without_local_tokens.push_str(&expression[previous_end..]);
    DIRECT_REQUEST_INPUT_PATTERN.is_match(&without_local_tokens)
}

fn is_locally_constructed_binding(binding: &str, source: &str) -> bool {
    let normalized = super::normalize_js_regex_content::normalize_js_regex_content(source);
    LOCAL_URL_SEARCH_PARAMS_PATTERN
        .captures_iter(normalized.as_ref())
        .any(|captures| {
            captures
                .get(1)
                .is_some_and(|found| found.as_str() == binding)
        })
}

fn first_non_javascript_whitespace_column(line: &str) -> usize {
    line.chars()
        .take_while(|character| {
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
        })
        .map(char::len_utf16)
        .sum::<usize>()
        + 1
}
