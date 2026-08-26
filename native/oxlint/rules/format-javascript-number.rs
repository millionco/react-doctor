const JAVASCRIPT_EXPONENTIAL_MINIMUM_ABSOLUTE_VALUE: f64 = 0.000_001;
const JAVASCRIPT_EXPONENTIAL_MAXIMUM_ABSOLUTE_VALUE: f64 = 1e21;

fn format_javascript_number(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_string();
    }
    if value == 0.0 {
        return "0".to_string();
    }
    if value == f64::INFINITY {
        return "Infinity".to_string();
    }
    if value == f64::NEG_INFINITY {
        return "-Infinity".to_string();
    }
    let absolute_value = value.abs();
    if !(JAVASCRIPT_EXPONENTIAL_MINIMUM_ABSOLUTE_VALUE
        ..JAVASCRIPT_EXPONENTIAL_MAXIMUM_ABSOLUTE_VALUE)
        .contains(&absolute_value)
    {
        let mut exponential_value = format!("{value:e}");
        let exponent_index = exponential_value
            .find('e')
            .unwrap_or(exponential_value.len());
        if exponential_value
            .as_bytes()
            .get(exponent_index + 1)
            .is_some_and(u8::is_ascii_digit)
        {
            exponential_value.insert(exponent_index + 1, '+');
        }
        return exponential_value;
    }
    value.to_string()
}
