use lazy_regex::{Lazy, Regex, lazy_regex};

use super::{ScanFinding, get_location_at_index::get_location_at_index};

const MESSAGE: &str = "MDX/markdown rendering code may evaluate user or repository content during SSR or static generation.";
const MAX_TRIGGER_TO_RISK_UTF16_UNITS: usize = 700;

static MDX_TRIGGER_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i-u:@mdx-js/mdx|next-mdx-remote|\b(?:MDXRemote|compileMDX|evaluateMdx)\b)");
static MDX_RISK_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?:(?i-u:\b(?:repo\b|customer|tenant|user[-_]?(?:content|markdown|mdx|input|provided|generated|submitted)|untrusted|searchParams|req\.|request\.|prisma\.|db\.|database|rehypeRaw|allowDangerousHtml))|(?i-u:\bfetch)[\t\n\x0B\x0C\r \u{00A0}\u{1680}\u{2000}-\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}]*\()"
);

pub fn scan(relative_path: &str, source: &str) -> Vec<ScanFinding> {
    if !super::is_production_file_path::is_production_source_path(relative_path) {
        return Vec::new();
    }
    let comment_stripped =
        super::strip_comments_preserving_positions::strip_comments_preserving_positions(source);
    let scannable =
        super::normalize_js_regex_content::normalize_js_regex_content(&comment_stripped);
    let risk_indices = MDX_RISK_PATTERN
        .find_iter(&scannable)
        .map(|risk| risk.start())
        .collect::<Vec<_>>();
    let Some(trigger) = MDX_TRIGGER_PATTERN.find_iter(&scannable).find(|trigger| {
        let risk_position = risk_indices.partition_point(|risk_index| *risk_index < trigger.end());
        risk_indices.get(risk_position).is_some_and(|risk_index| {
            scannable[trigger.end()..*risk_index]
                .chars()
                .take(MAX_TRIGGER_TO_RISK_UTF16_UNITS + 1)
                .count()
                <= MAX_TRIGGER_TO_RISK_UTF16_UNITS
        })
    }) else {
        return Vec::new();
    };
    let (line, column) = get_location_at_index(source, &scannable, trigger.start());
    vec![ScanFinding::inherited(MESSAGE, line, column)]
}

#[cfg(test)]
mod tests {
    use super::scan;

    #[test]
    fn bounds_risk_search_by_utf16_units() {
        let at_limit = format!("MDXRemote{}userContent", "x".repeat(700));
        let past_limit = format!("MDXRemote{}userContent", "x".repeat(701));

        assert_eq!(scan("src/page.tsx", &at_limit).len(), 1);
        assert!(scan("src/page.tsx", &past_limit).is_empty());
    }

    #[test]
    fn counts_astral_characters_as_two_utf16_units() {
        let source = format!("MDXRemote{}userContent", "\u{1F642}".repeat(350));

        assert_eq!(scan("src/page.tsx", &source).len(), 1);
    }
}
