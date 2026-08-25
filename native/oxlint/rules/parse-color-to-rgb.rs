#[derive(Clone, Copy)]
struct Rgb {
    red: f64,
    green: f64,
    blue: f64,
}

fn parse_color_to_rgb(value: &str) -> Option<Rgb> {
    let normalized = value
        .trim_matches(|character| is_js_whitespace(character))
        .to_lowercase()
        .replace('_', " ");
    if let Some(hex) = normalized.strip_prefix('#') {
        let channels = match hex.len() {
            3 | 4 => [
                format!("{0}{0}", &hex[0..1]),
                format!("{0}{0}", &hex[1..2]),
                format!("{0}{0}", &hex[2..3]),
            ],
            6 | 8 => [
                hex[0..2].to_string(),
                hex[2..4].to_string(),
                hex[4..6].to_string(),
            ],
            _ => return None,
        };
        return Some(Rgb {
            red: u8::from_str_radix(&channels[0], 16).ok()? as f64,
            green: u8::from_str_radix(&channels[1], 16).ok()? as f64,
            blue: u8::from_str_radix(&channels[2], 16).ok()? as f64,
        });
    }
    if normalized.contains("rgb") {
        if let Some(color) = parse_rgb_color_function_pattern(&normalized) {
            return Some(color);
        }
    }
    if normalized.contains("hsl") {
        return parse_hsl_color_function_pattern(&normalized);
    }
    None
}

fn parse_rgb_color_function_pattern(value: &str) -> Option<Rgb> {
    value
        .char_indices()
        .find_map(|(index, _)| parse_rgb_color_function_pattern_at_start(&value[index..]))
}

fn parse_rgb_color_function_pattern_at_start(value: &str) -> Option<Rgb> {
    let contents = value
        .strip_prefix("rgb(")
        .or_else(|| value.strip_prefix("rgba("))?
        .trim_start_matches(|character| is_js_whitespace(character));
    let (red, remainder) = parse_color_unsigned_integer_prefix(contents)?;
    let (green, remainder) = parse_separated_color_unsigned_integer(remainder)?;
    let (blue, _) = parse_separated_color_unsigned_integer(remainder)?;
    Some(Rgb { red, green, blue })
}

fn parse_hsl_color_function_pattern(value: &str) -> Option<Rgb> {
    value
        .char_indices()
        .find_map(|(index, _)| parse_hsl_color_function_pattern_at_start(&value[index..]))
}

fn parse_hsl_color_function_pattern_at_start(value: &str) -> Option<Rgb> {
    let contents = value
        .strip_prefix("hsl(")
        .or_else(|| value.strip_prefix("hsla("))?
        .trim_start_matches(|character| is_js_whitespace(character));
    let (hue, remainder) = parse_color_unsigned_decimal_prefix(contents)?;
    let remainder = remainder.strip_prefix("deg").unwrap_or(remainder);
    let remainder = strip_color_component_separator(remainder)?;
    let (saturation, remainder) = parse_color_unsigned_decimal_prefix(remainder)?;
    let remainder = remainder.strip_prefix('%')?;
    let remainder = strip_color_component_separator(remainder)?;
    let (lightness, remainder) = parse_color_unsigned_decimal_prefix(remainder)?;
    remainder.strip_prefix('%')?;
    hsl_color_to_rgb(hue, saturation, lightness)
}

fn parse_separated_color_unsigned_integer(value: &str) -> Option<(f64, &str)> {
    parse_color_unsigned_integer_prefix(strip_color_component_separator(value)?)
}

fn strip_color_component_separator(value: &str) -> Option<&str> {
    let remainder = value
        .trim_start_matches(|character: char| character == ',' || is_js_whitespace(character));
    (remainder.len() < value.len()).then_some(remainder)
}

fn parse_color_unsigned_integer_prefix(value: &str) -> Option<(f64, &str)> {
    let end = value
        .find(|character: char| !character.is_ascii_digit())
        .unwrap_or(value.len());
    if end == 0 {
        return None;
    }
    Some((value[..end].parse().ok()?, &value[end..]))
}

fn parse_color_unsigned_decimal_prefix(value: &str) -> Option<(f64, &str)> {
    let end = value
        .find(|character: char| !character.is_ascii_digit() && character != '.')
        .unwrap_or(value.len());
    if end == 0 {
        return None;
    }
    Some((parse_color_javascript_float_digits(&value[..end])?, &value[end..]))
}

fn parse_color_javascript_float_digits(value: &str) -> Option<f64> {
    let mut dot_count = 0;
    let mut digit_count = 0;
    for character in value.chars() {
        if character == '.' {
            dot_count += 1;
            if dot_count > 1 {
                return None;
            }
        } else if character.is_ascii_digit() {
            digit_count += 1;
        } else {
            return None;
        }
    }
    if digit_count == 0 {
        return None;
    }
    value.parse().ok()
}

fn hsl_color_to_rgb(
    hue_degrees: f64,
    saturation_percent: f64,
    lightness_percent: f64,
) -> Option<Rgb> {
    let hue = ((hue_degrees % 360.0) + 360.0) % 360.0;
    let saturation = saturation_percent / 100.0;
    let lightness = lightness_percent / 100.0;
    let chroma = (1.0 - (2.0 * lightness - 1.0).abs()) * saturation;
    let secondary = chroma * (1.0 - ((hue / 60.0) % 2.0 - 1.0).abs());
    let offset = lightness - chroma / 2.0;
    let channels = match (hue / 60.0).floor() as i32 {
        0 => [chroma, secondary, 0.0],
        1 => [secondary, chroma, 0.0],
        2 => [0.0, chroma, secondary],
        3 => [0.0, secondary, chroma],
        4 => [secondary, 0.0, chroma],
        _ => [chroma, 0.0, secondary],
    };
    Some(Rgb {
        red: ((channels[0] + offset) * 255.0).round(),
        green: ((channels[1] + offset) * 255.0).round(),
        blue: ((channels[2] + offset) * 255.0).round(),
    })
}
