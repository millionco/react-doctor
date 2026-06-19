import type { Server } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createLogServer, DEFAULT_HOST } from "@react-doctor/debug";
import { z } from "zod";
import { jsonResult, runTool, textResult } from "../utils/tool-result.js";

// Log servers started via `debug_serve` must outlive the tool call (the agent
// instruments the app, then reads them back), so they live for the MCP process
// and are closed when it exits. A stale lock from a hard kill self-heals: the
// reuse path pings for liveness and clears a dead lock before binding.
const liveServers = new Set<Server>();
let cleanupRegistered = false;
const trackLogServer = (logServer: Server): void => {
  liveServers.add(logServer);
  logServer.on("close", () => liveServers.delete(logServer));
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  process.once("exit", () => {
    for (const server of liveServers) server.close();
  });
};

export const registerDebugTools = (server: McpServer): void => {
  server.registerTool(
    "debug_serve",
    {
      title: "Start the runtime debug log server",
      description:
        "Start the NDJSON logging server for the debug job. Instrument your app to POST runtime logs to the returned endpoint, reproduce the bug, then read them with debug_read_logs. Reuses an already-running server for this project, returning its endpoint.",
      inputSchema: {
        sessionId: z
          .string()
          .optional()
          .describe("Session id to write under (default: random hex)"),
        port: z.number().int().optional().describe("Port to listen on (default: random)"),
        host: z
          .string()
          .optional()
          .describe(`Host to bind (default ${DEFAULT_HOST}; keep it loopback)`),
      },
      annotations: { openWorldHint: true },
    },
    (args) =>
      runTool(async () => {
        const {
          server: logServer,
          info,
          reused,
        } = await createLogServer({
          sessionId: args.sessionId,
          port: args.port,
          host: args.host,
          cwd: process.cwd(),
        });
        if (logServer) trackLogServer(logServer);
        return jsonResult({ ...info, reused });
      }),
  );

  server.registerTool(
    "debug_read_logs",
    {
      title: "Read captured runtime logs",
      description:
        "Fetch the NDJSON runtime logs the debug log server has captured at the given endpoint (returned by debug_serve).",
      inputSchema: {
        endpoint: z
          .string()
          .describe("The endpoint from debug_serve, e.g. http://127.0.0.1:PORT/ingest/<sessionId>"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) =>
      runTool(async () => {
        const response = await fetch(args.endpoint);
        if (!response.ok) {
          return {
            content: [{ type: "text", text: `Log server returned ${response.status}` }],
            isError: true,
          };
        }
        const logs = await response.text();
        return textResult(logs.length > 0 ? logs : "(no logs captured yet)");
      }),
  );

  server.registerTool(
    "debug_clear_logs",
    {
      title: "Clear captured runtime logs",
      description:
        "Delete the runtime logs captured so far at the given endpoint (returned by debug_serve), so the next reproduction starts from a clean slate.",
      inputSchema: {
        endpoint: z.string().describe("The endpoint from debug_serve to clear"),
      },
      annotations: { openWorldHint: true },
    },
    (args) =>
      runTool(async () => {
        const response = await fetch(args.endpoint, { method: "DELETE" });
        return response.ok
          ? textResult("Cleared logs")
          : {
              content: [{ type: "text", text: `Log server returned ${response.status}` }],
              isError: true,
            };
      }),
  );
};
