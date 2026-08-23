fn first_js_whitespace_token(value: &str) -> Option<&str> {
    value
        .trim_matches(|character| is_js_whitespace(character))
        .split(|character| is_js_whitespace(character))
        .find(|token| !token.is_empty())
}
