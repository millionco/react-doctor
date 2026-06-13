import { AGENT_TOOL_DANGEROUS_CAPABILITY_PATTERN } from "../../constants/security-scan.js";
import { defineRule } from "../../utils/define-rule.js";
import { isProductionSourcePath } from "./utils/is-production-source-path.js";
import { scanByPattern } from "./utils/scan-by-pattern.js";

const MCP_IMPORT_PATTERN =
  /\bfrom\s+["']@modelcontextprotocol\/sdk[^"']*["']|\bMcpServer\b|\bMcpAgent\b/;

// Only TOOL handlers are the capability surface: a tool runs model-controlled
// actions with the client's authority. `new McpServer()`/`McpAgent()` is just
// construction (and is already the file-level import signal), tool LISTING
// returns metadata, and prompts (message templates) / resources (read-only
// data) are not action surfaces — flagging them produced false positives on
// `new McpServer({...})` and static `registerPrompt(...)` calls.
const MCP_TOOL_SURFACE_PATTERN =
  /\bserver\.\s*tool\s*\(|\bregisterTool\s*\(|\bsetRequestHandler\s*\(\s*CallToolRequestSchema/;

export const mcpToolCapabilityRisk = defineRule({
  id: "mcp-tool-capability-risk",
  title: "MCP tool exposes dangerous capability",
  severity: "warn",
  recommendation:
    "MCP tool calls run with the connecting client's authority. Validate inputs, enforce per-tool authorization, and avoid raw filesystem/shell/network access where possible.",
  scan: scanByPattern({
    shouldScan: (file) => isProductionSourcePath(file.relativePath),
    pattern: MCP_TOOL_SURFACE_PATTERN,
    requireAll: [MCP_IMPORT_PATTERN, AGENT_TOOL_DANGEROUS_CAPABILITY_PATTERN],
    message:
      "An MCP tool/resource/prompt handler appears to expose file, shell, network, or code-execution capability.",
  }),
});
