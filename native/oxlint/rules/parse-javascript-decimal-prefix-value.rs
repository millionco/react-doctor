fn parse_javascript_decimal_prefix_value(value: &str) -> Option<f64> {
    let bytes = value.as_bytes();
    let mut end = bytes
        .iter()
        .take_while(|byte| byte.is_ascii_digit())
        .count();
    if bytes.get(end) == Some(&b'.') {
        end += 1;
        end += bytes[end..]
            .iter()
            .take_while(|byte| byte.is_ascii_digit())
            .count();
    }
    if end == 0 || end == 1 && bytes[0] == b'.' {
        return None;
    }
    value[..end].parse().ok()
}
