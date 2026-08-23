fn get_effective_nonzero_tailwind_tracking<'a>(
    tokens: &'a [TailwindClassNameToken<'a>],
) -> Option<&'a str> {
    let effective_utility = get_effective_tailwind_class_name_token(tokens, |utility| {
        utility.starts_with("tracking-") || utility.starts_with("-tracking-")
    })?;
    if matches!(
        effective_utility,
        "tracking-tight"
            | "tracking-tighter"
            | "tracking-wide"
            | "tracking-wider"
            | "tracking-widest"
    ) {
        return Some(effective_utility);
    }
    parse_arbitrary_tracking_value(effective_utility)
        .is_some_and(|value| value != 0.0)
        .then_some(effective_utility)
}

fn parse_arbitrary_tracking_value(utility: &str) -> Option<f64> {
    const LENGTH_UNITS: [&str; 31] = [
        "cap", "ch", "cm", "dvh", "dvw", "em", "ex", "ic", "in", "lh", "lvh", "lvw", "mm", "pc",
        "pt", "px", "q", "rcap", "rch", "rem", "rex", "ric", "rlh", "svh", "svw", "vb", "vh", "vi",
        "vmax", "vmin", "vw",
    ];
    let lowercase_utility = utility.to_ascii_lowercase();
    let arbitrary_value = lowercase_utility
        .strip_prefix("tracking-[")
        .or_else(|| lowercase_utility.strip_prefix("-tracking-["))?
        .strip_suffix(']')?;
    let arbitrary_value = arbitrary_value
        .strip_prefix("length:")
        .unwrap_or(arbitrary_value);
    let unit = LENGTH_UNITS
        .iter()
        .filter(|unit| arbitrary_value.ends_with(**unit))
        .max_by_key(|unit| unit.len())?;
    let number = &arbitrary_value[..arbitrary_value.len() - unit.len()];
    is_signed_decimal_literal(number)
        .then(|| number.parse::<f64>().ok())
        .flatten()
}

fn is_signed_decimal_literal(value: &str) -> bool {
    let unsigned_value = value.strip_prefix('-').unwrap_or(value);
    if unsigned_value.is_empty() {
        return false;
    }
    let mut decimal_point_count = 0;
    let mut digit_count = 0;
    for byte in unsigned_value.bytes() {
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
