use lazy_regex::{Lazy, Regex, lazy_regex};

use super::{
    ScanFinding, first_pattern_finding::first_pattern_finding, scan_content::ScanContent,
};

const MESSAGE: &str = "An agent-callable tool appears to expose network, filesystem, shell, or code-execution capability.";

static TOOL_DEFINITION_PATTERN: Lazy<Regex> = lazy_regex!(
    r"\b(?:tool\s*\(\s*\{|createTool\s*\(|defineTool\s*\(|new\s+(?:DynamicTool|StructuredTool)\s*\()"
);
static TOOL_PREFILTER_PATTERN: Lazy<Regex> =
    lazy_regex!(r"\b(?:tool|createTool|defineTool|DynamicTool|StructuredTool)\b");
static TOOL_CONTEXT_PATH_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)(?:^|/)(?:agents?|tools?|mcp)(?:/|$)|(?:agent|tool|mcp)[^/]*\.[cm]?[jt]sx?$");
static DANGEROUS_CAPABILITY_PATTERN: Lazy<Regex> = lazy_regex!(
    r"\b(?:exec|execSync|spawn|child_process|eval|new Function|vm\.run|readFile|writeFile|fs\.read|fs\.write|fetch|axios|http\.request|sandbox|runCode|executeCode)\b"
);

pub fn scan(relative_path: &str, source: &ScanContent<'_>) -> Vec<ScanFinding> {
    if !super::is_production_file_path::is_production_source_path(relative_path) {
        return Vec::new();
    }
    let normalized_path =
        super::normalize_js_regex_content::normalize_js_regex_content(relative_path);
    if !TOOL_CONTEXT_PATH_PATTERN.is_match(&normalized_path) {
        return Vec::new();
    }
    let normalized_source = source.normalized_source();
    if !TOOL_PREFILTER_PATTERN.is_match(&normalized_source)
        || !DANGEROUS_CAPABILITY_PATTERN.is_match(&normalized_source)
    {
        return Vec::new();
    }
    let content = source.normalized_scannable(true);
    if !DANGEROUS_CAPABILITY_PATTERN.is_match(&content) {
        return Vec::new();
    }
    first_pattern_finding(source, &content, &[&TOOL_DEFINITION_PATTERN], MESSAGE)
}
