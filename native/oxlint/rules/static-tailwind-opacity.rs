fn static_tailwind_opacity(utility: &str) -> Option<f64> {
    let value = utility.strip_prefix("opacity-")?;
    let value = if let Some(arbitrary_value) = value
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
    {
        arbitrary_value.strip_suffix('%').unwrap_or(arbitrary_value)
    } else {
        value
    };
    is_unsigned_tailwind_decimal(value)
        .then(|| value.parse().ok())
        .flatten()
}

fn is_unsigned_tailwind_decimal(value: &str) -> bool {
    if value.is_empty() {
        return false;
    }
    let mut parts = value.split('.');
    let integer = parts.next().unwrap_or_default();
    let fraction = parts.next();
    if parts.next().is_some() {
        return false;
    }
    match fraction {
        Some(fraction) => {
            (!integer.is_empty() || !fraction.is_empty())
                && integer.bytes().all(|byte| byte.is_ascii_digit())
                && fraction.bytes().all(|byte| byte.is_ascii_digit())
        }
        None => !integer.is_empty() && integer.bytes().all(|byte| byte.is_ascii_digit()),
    }
}
