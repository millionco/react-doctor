use lazy_regex::{Lazy, Regex, lazy_regex};

use super::{ScanFinding, get_location_at_index::get_location_at_index};

const MESSAGE: &str = "An MCP tool/resource/prompt handler appears to expose file, shell, network, or code-execution capability.";

static MCP_IMPORT_PATTERN: Lazy<Regex> = lazy_regex!(
    r#"(?-u:\b)from\s+[\"']@modelcontextprotocol/sdk[^\"']*[\"']|(?-u:\b)McpServer(?-u:\b)|(?-u:\b)McpAgent(?-u:\b)"#
);
static MCP_TOOL_SURFACE_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?-u:\b)server\.\s*tool\s*\(|(?-u:\b)registerTool\s*\(|(?-u:\b)setRequestHandler\s*\(\s*CallToolRequestSchema"
);
static DANGEROUS_CAPABILITY_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?-u:\b)(?:exec|execSync|spawn|child_process|eval|new Function|vm\.run|readFile|writeFile|fs\.read|fs\.write|fetch|axios|http\.request|sandbox|runCode|executeCode)(?-u:\b)"
);

pub fn scan(relative_path: &str, source: &str) -> Vec<ScanFinding> {
    if !super::is_production_file_path::is_production_source_path(relative_path)
        || (!source.contains("@modelcontextprotocol/sdk")
            && !source.contains("McpServer")
            && !source.contains("McpAgent"))
        || (!source.contains("tool")
            && !source.contains("registerTool")
            && !source.contains("setRequestHandler"))
        || !DANGEROUS_CAPABILITY_PATTERN.is_match(source)
    {
        return Vec::new();
    }
    let scannable =
        super::get_scannable_content::get_scannable_content(relative_path, source, true);
    let normalized = super::normalize_js_regex_content::normalize_js_regex_content(&scannable);
    if !MCP_IMPORT_PATTERN.is_match(normalized.as_ref())
        || !DANGEROUS_CAPABILITY_PATTERN.is_match(normalized.as_ref())
    {
        return Vec::new();
    }
    let Some(found) = MCP_TOOL_SURFACE_PATTERN.find(normalized.as_ref()) else {
        return Vec::new();
    };
    let (line, column) = get_location_at_index(source, normalized.as_ref(), found.start());
    vec![ScanFinding::inherited(MESSAGE, line, column)]
}
