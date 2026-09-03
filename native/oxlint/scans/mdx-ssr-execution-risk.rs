use lazy_regex::{Lazy, Regex, lazy_regex};

use super::{ScanFinding, get_location_at_index::get_location_at_index};

const MESSAGE: &str = "MDX/markdown rendering code may evaluate user or repository content during SSR or static generation.";

static MDX_SSR_EXECUTION_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?is)(?:@mdx-js/mdx|next-mdx-remote|(?-u:\b)(?:MDXRemote|compileMDX|evaluateMdx)(?-u:\b)).{0,700}(?-u:\b)(?:repo(?-u:\b)|customer|tenant|user[-_]?(?:content|markdown|mdx|input|provided|generated|submitted)|untrusted|searchParams|req\.|request\.|fetch\s*\(|prisma\.|db\.|database|rehypeRaw|allowDangerousHtml)"
);

pub fn scan(relative_path: &str, source: &str) -> Vec<ScanFinding> {
    if !super::is_production_file_path::is_production_source_path(relative_path) {
        return Vec::new();
    }
    let scannable =
        super::get_scannable_content::get_scannable_content(relative_path, source, false);
    let normalized = super::normalize_js_regex_content::normalize_js_regex_content(&scannable);
    let Some(found) = MDX_SSR_EXECUTION_PATTERN.find(normalized.as_ref()) else {
        return Vec::new();
    };
    let (line, column) = get_location_at_index(source, normalized.as_ref(), found.start());
    vec![ScanFinding::inherited(MESSAGE, line, column)]
}
