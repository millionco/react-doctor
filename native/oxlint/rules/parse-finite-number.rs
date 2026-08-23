fn parse_finite_number(value: &str) -> Option<f64> {
    use oxc_ecmascript::StringToNumber;

    let number = value
        .trim_matches(|character: char| character.is_whitespace() || character == '\u{feff}')
        .string_to_number();
    number.is_finite().then_some(number)
}
