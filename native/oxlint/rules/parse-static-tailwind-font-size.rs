fn parse_static_tailwind_font_size(utility: &str) -> Option<f64> {
    let standard_utility = utility.split('/').next().unwrap_or(utility);
    let standard_size = match standard_utility {
        "text-xs" => Some(12.0),
        "text-sm" => Some(14.0),
        "text-base" => Some(16.0),
        "text-lg" => Some(18.0),
        "text-xl" => Some(20.0),
        "text-2xl" => Some(24.0),
        "text-3xl" => Some(30.0),
        "text-4xl" => Some(36.0),
        "text-5xl" => Some(48.0),
        "text-6xl" => Some(60.0),
        "text-7xl" => Some(72.0),
        "text-8xl" => Some(96.0),
        "text-9xl" => Some(128.0),
        _ => None,
    };
    if standard_size.is_some() {
        return standard_size;
    }
    let (base_utility, line_height) = utility
        .split_once('/')
        .map_or((utility, None), |(base, suffix)| (base, Some(suffix)));
    if line_height.is_some_and(str::is_empty) {
        return None;
    }
    let lowercase_utility = base_utility.to_ascii_lowercase();
    let arbitrary_value = lowercase_utility
        .strip_prefix("text-[")?
        .strip_suffix(']')?;
    let arbitrary_value = arbitrary_value
        .strip_prefix("length:")
        .unwrap_or(arbitrary_value);
    let (number, multiplier) = arbitrary_value
        .strip_suffix("rem")
        .map(|number| (number, 16.0))
        .or_else(|| {
            arbitrary_value
                .strip_suffix("px")
                .map(|number| (number, 1.0))
        })?;
    is_unsigned_decimal_literal(number)
        .then(|| number.parse::<f64>().ok().map(|value| value * multiplier))
        .flatten()
}

fn is_unsigned_decimal_literal(value: &str) -> bool {
    if value.is_empty() {
        return false;
    }
    let mut decimal_point_count = 0;
    let mut digit_count = 0;
    for byte in value.bytes() {
        if byte.is_ascii_digit() {
            digit_count += 1;
        } else if byte == b'.' {
            decimal_point_count += 1;
            if decimal_point_count > 1 {
                return false;
            }
        } else {
            return false;
        }
    }
    digit_count > 0
}
