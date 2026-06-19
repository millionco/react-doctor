import { homedir } from "node:os";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const textResult = (text: string): CallToolResult => ({
  content: [{ type: "text", text }],
});

export const jsonResult = (value: unknown): CallToolResult =>
  textResult(JSON.stringify(value, null, 2));

// Tool output is sent to the model (and may be logged), so keep the user's home
// directory out of error messages — Chrome/profile/CDP errors otherwise carry an
// absolute path that includes the username.
const scrubHomePath = (text: string): string => {
  const home = homedir();
  return home ? text.split(home).join("~") : text;
};

export const errorResult = (text: string): CallToolResult => ({
  content: [{ type: "text", text: scrubHomePath(text) }],
  isError: true,
});

// MCP convention: a tool reports a failure as a result with `isError: true` so
// the model sees the message and can react, rather than throwing — which would
// abort the protocol turn. Wrap every handler so a missing browser, an
// unreachable Chrome, or a failed scan comes back as readable tool output.
export const runTool = async (run: () => Promise<CallToolResult>): Promise<CallToolResult> => {
  try {
    return await run();
  } catch (error: unknown) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
};
