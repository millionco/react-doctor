/**
 * Dedicated entry for `react-doctor mcp`. The bin shim fast-paths to this
 * module so the MCP server runs without loading the CLI (commander / prompts /
 * ora), which would otherwise touch `process.stdin` before the stdio transport
 * attaches and break the JSON-RPC stream. Nothing on this path may write to
 * stdout — the transport owns it.
 */
import { startMcpServer } from "@react-doctor/mcp";
import { METRIC } from "./cli/utils/constants.js";
import { recordCount } from "./cli/utils/record-metric.js";
import { VERSION } from "./cli/utils/version.js";
import { initializeSentry } from "./instrument.js";

export const startReactDoctorMcp = (): Promise<void> => {
  initializeSentry();
  recordCount(METRIC.cliInvoked, 1, { command: "mcp" });
  return startMcpServer({ version: VERSION });
};
