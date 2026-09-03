use std::borrow::Cow;

use lazy_regex::{Lazy, Regex, lazy_regex};

static SOURCE_FILE_PATTERN: Lazy<Regex> = lazy_regex!(r"(?i)\.[cm]?[jt]sx?$");

pub fn get_scannable_content<'a>(
    relative_path: &str,
    source: &'a str,
    ignore_string_literals: bool,
) -> Cow<'a, str> {
    let normalized_path =
        super::normalize_js_regex_content::normalize_js_regex_content(relative_path);
    if !SOURCE_FILE_PATTERN.is_match(&normalized_path)
        && !super::is_firebase_rules_path::is_firebase_rules_path(relative_path)
    {
        return Cow::Borrowed(source);
    }
    if ignore_string_literals {
        Cow::Owned(
            super::strip_comments_preserving_positions::strip_comments_and_string_literals_preserving_positions(
                source,
            ),
        )
    } else if source.contains("//") || source.contains("/*") {
        Cow::Owned(
            super::strip_comments_preserving_positions::strip_comments_preserving_positions(source),
        )
    } else {
        Cow::Borrowed(source)
    }
}
