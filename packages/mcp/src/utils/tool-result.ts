import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const textResult = (text: string): CallToolResult => ({
  content: [{ type: "text", text }],
});

export const jsonResult = (value: unknown): CallToolResult =>
  textResult(JSON.stringify(value, null, 2));

// MCP convention: a tool reports a failure as a result with `isError: true` so
// the model sees the message and can react, rather than throwing — which would
// abort the protocol turn. Wrap every handler so a missing browser, an
// unreachable Chrome, or a failed scan comes back as readable tool output.
export const runTool = async (run: () => Promise<CallToolResult>): Promise<CallToolResult> => {
  try {
    return await run();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text: message }], isError: true };
  }
};
