import { spawn } from "node:child_process";
import { createLogServer, DEFAULT_HOST, type LogServerOptions } from "@react-doctor/debug";
import { cliLogger as logger } from "../utils/cli-logger.js";
import { METRIC } from "../utils/constants.js";
import { recordCount } from "../utils/record-metric.js";

export interface DebugServeOptions {
  port?: number;
  host: string;
  sessionId?: string;
  logPath?: string;
  daemon?: boolean;
  json?: boolean;
}

const toServerOptions = (options: DebugServeOptions): LogServerOptions => ({
  port: options.port,
  host: options.host,
  sessionId: options.sessionId,
  logPath: options.logPath,
  // Scope the lock + default log directory to this project so a different
  // codebase's `debug serve` can't reuse this server and cross its sessions.
  cwd: process.cwd(),
});

const installShutdown = (server: { close: () => void }): void => {
  const shutdown = (): void => {
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};

// Re-spawn `debug serve --json` detached so the server outlives this process,
// forward the one JSON info line it prints on startup, then exit. The agent gets
// the endpoint without a server stuck in its foreground.
const startDaemon = async (options: DebugServeOptions): Promise<void> => {
  const childArguments = [process.argv[1], "debug", "serve", "--json"];
  if (options.port) childArguments.push("--port", String(options.port));
  if (options.host !== DEFAULT_HOST) childArguments.push("--host", options.host);
  if (options.sessionId) childArguments.push("--session-id", options.sessionId);
  if (options.logPath) childArguments.push("--log-path", options.logPath);

  const child = spawn(process.execPath, childArguments, {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdoutBuffer = "";
  let stderrBuffer = "";
  child.stderr?.on("data", (chunk: Buffer) => (stderrBuffer += chunk.toString()));
  const infoLine = await new Promise<string>((resolve, reject) => {
    const resolveFromBuffer = (): boolean => {
      const newlineIndex = stdoutBuffer.indexOf("\n");
      if (newlineIndex === -1) return false;
      resolve(stdoutBuffer.slice(0, newlineIndex));
      return true;
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      resolveFromBuffer();
    });
    child.on("error", reject);
    // `close` (not `exit`) so stdout is fully drained: the reuse path prints its
    // info line and exits 0 immediately, which can beat the `data` event, so the
    // line is only guaranteed buffered once the pipe closes. A long-running
    // server never closes stdout — it's already resolved via `data` above.
    child.on("close", (code) => {
      if (resolveFromBuffer()) return;
      const detail = stderrBuffer.trim();
      reject(new Error(`Debug log server exited with code ${code}${detail ? `: ${detail}` : ""}`));
    });
  });

  logger.log(infoLine);
  child.unref();
  process.exit(0);
};

// Foreground server that prints one JSON info line then keeps listening, for
// agents that background it themselves (`… &`).
const startJson = async (options: DebugServeOptions): Promise<void> => {
  const { server, info } = await createLogServer(toServerOptions(options));
  logger.log(JSON.stringify(info));
  if (!server) {
    process.exit(0);
  }
  installShutdown(server);
};

const startInteractive = async (options: DebugServeOptions): Promise<void> => {
  const { server, info } = await createLogServer(toServerOptions(options));
  if (!server) {
    logger.success(`Debug log server already running on port ${info.port}`);
    logger.dim(`  ${info.endpoint}`);
    return;
  }
  logger.success(`Debug log server listening on port ${info.port}`);
  logger.dim(`  Endpoint: ${info.endpoint}`);
  logger.dim(`  Log path: ${info.logPath}`);
  installShutdown(server);
};

export const debugServeAction = async (options: DebugServeOptions): Promise<void> => {
  recordCount(METRIC.cliInvoked, 1, { command: "debug.serve" });
  if (options.daemon) return startDaemon(options);
  if (options.json) return startJson(options);
  return startInteractive(options);
};
