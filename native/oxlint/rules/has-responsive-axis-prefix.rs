fn has_responsive_axis_prefix(class_name_value: &str, axis_prefix: &str) -> bool {
    class_name_value.split_whitespace().any(|class_token| {
        let Some((responsive_prefix, utility)) = class_token.split_once(':') else {
            return false;
        };
        !responsive_prefix.is_empty()
            && responsive_prefix
                .bytes()
                .all(|character| character.is_ascii_alphanumeric() || character == b'_')
            && utility.starts_with(axis_prefix)
            && utility.as_bytes().get(axis_prefix.len()) == Some(&b'-')
    })
}
