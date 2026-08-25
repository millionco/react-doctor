const STATIC_TAILWIND_ROOT_FONT_SIZE_PX: f64 = 16.0;
const STATIC_TAILWIND_SPACING_UNIT_PX: f64 = 4.0;
static STATIC_TAILWIND_ARBITRARY_LENGTH_PATTERN: lazy_regex::Lazy<lazy_regex::Regex> =
    lazy_regex::lazy_regex!(r"(?i-u)^\[(?:length:)?(\d+(?:\.\d*)?|\.\d+)(px|rem)\]$");
static STATIC_TAILWIND_SCALE_LENGTH_PATTERN: lazy_regex::Lazy<lazy_regex::Regex> =
    lazy_regex::lazy_regex!(r"(?-u)^(\d+(?:\.\d*)?|\.\d+)$");

fn parse_static_tailwind_length_px(utility: &str, prefix: &str) -> Option<f64> {
    let value = utility.strip_prefix(&format!("{prefix}-"))?;
    if value == "px" {
        return Some(1.0);
    }
    if let Some(captures) = STATIC_TAILWIND_ARBITRARY_LENGTH_PATTERN.captures(value) {
        let number = captures.get(1)?.as_str().parse::<f64>().ok()?;
        return Some(if captures.get(2)?.as_str().eq_ignore_ascii_case("rem") {
            number * STATIC_TAILWIND_ROOT_FONT_SIZE_PX
        } else {
            number
        });
    }
    STATIC_TAILWIND_SCALE_LENGTH_PATTERN
        .captures(value)
        .and_then(|captures| captures.get(1))
        .and_then(|capture| capture.as_str().parse::<f64>().ok())
        .map(|number| number * STATIC_TAILWIND_SPACING_UNIT_PX)
}
