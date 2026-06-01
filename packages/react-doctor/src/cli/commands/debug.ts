import { spawn } from "node:child_process";
import type { Server } from "node:http";
import { Command } from "commander";
import { highlighter } from "@react-doctor/core";
import { cliLogger as logger } from "../utils/cli-logger.js";
import { createDebugServer, type DebugServerInfo } from "../debug-server/index.js";
import { DEBUG_DEFAULT_HOST } from "../utils/constants.js";
import { spinner } from "../utils/spinner.js";

interface DebugCommandOptions {
  port?: number;
  host: string;
  sessionId?: string;
  logPath?: string;
  daemon?: boolean;
  json?: boolean;
}

// `--json` is also a root-level flag, so Commander binds it to the parent
// program rather than the `debug` subcommand. Read it back from the parent
// (same interplay the `install` command handles for `--yes`).
interface DebugCommandContext {
  parent?: {
    opts?: () => {
      json?: boolean;
    };
  };
}

const registerShutdown = (server: Server): void => {
  const shutdown = () => {
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};

const printServerDetails = (info: DebugServerInfo): void => {
  logger.dim(`  Endpoint: ${info.endpoint}`);
  logger.dim(`  Log path: ${info.logPath}`);
};

const startDaemon = async (options: DebugCommandOptions): Promise<void> => {
  const childArgs = [process.argv[1], "debug", "--json"];
  if (options.port) childArgs.push("-p", String(options.port));
  if (options.host !== DEBUG_DEFAULT_HOST) childArgs.push("-H", options.host);
  if (options.sessionId) childArgs.push("-s", options.sessionId);
  if (options.logPath) childArgs.push("-l", options.logPath);

  const childProcess = spawn(process.execPath, childArgs, {
    detached: true,
    stdio: ["ignore", "pipe", "ignore"],
  });

  if (!childProcess.stdout) {
    logger.error("Failed to start debug server daemon.");
    process.exit(1);
  }

  let stdoutBuffer = "";
  let isSettled = false;
  const serverInfoLine = await new Promise<string>((resolve, reject) => {
    const settle = (action: () => void) => {
      if (isSettled) return;
      isSettled = true;
      action();
    };
    childProcess.stdout!.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      const newlineIndex = stdoutBuffer.indexOf("\n");
      // Strip a trailing CR so the printed line is valid JSON on Windows.
      if (newlineIndex !== -1) {
        settle(() => resolve(stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, "")));
      }
    });
    childProcess.on("error", (error) => settle(() => reject(error)));
    childProcess.on("exit", (code) =>
      // The server child stays alive once it prints its info line, so a
      // resolve always wins the race; reaching `exit` first means it died
      // before printing — reject rather than hang the parent forever.
      settle(() =>
        reject(new Error(`Debug server process exited (code ${code ?? "unknown"}) before startup`)),
      ),
    );
  });

  console.log(serverInfoLine);
  childProcess.unref();
  process.exit(0);
};

const startJson = async (options: DebugCommandOptions): Promise<void> => {
  const { server, info } = await createDebugServer({
    port: options.port,
    host: options.host,
    sessionId: options.sessionId,
    logPath: options.logPath,
  });

  console.log(JSON.stringify(info));

  if (!server) {
    process.exit(0);
  }

  registerShutdown(server);
};

const startInteractive = async (options: DebugCommandOptions): Promise<void> => {
  const startSpinner = spinner("Starting React Doctor debug server...").start();

  const { server, info, reused } = await createDebugServer({
    port: options.port,
    host: options.host,
    sessionId: options.sessionId,
    logPath: options.logPath,
  });

  if (reused || !server) {
    startSpinner.succeed(
      `Debug server already running on port ${highlighter.bold(String(info.port))}`,
    );
    printServerDetails(info);
    return;
  }

  startSpinner.succeed(`Debug server listening on port ${highlighter.bold(String(info.port))}`);
  printServerDetails(info);
  registerShutdown(server);
};

export const debugAction = async (
  options: DebugCommandOptions,
  command?: DebugCommandContext,
): Promise<void> => {
  const isJson = options.json ?? command?.parent?.opts?.().json ?? false;
  if (options.daemon) {
    await startDaemon(options);
    return;
  }
  if (isJson) {
    await startJson(options);
    return;
  }
  await startInteractive(options);
};

export const registerDebugCommand = (program: Command): void => {
  program
    .command("debug")
    .description("Start the NDJSON debug logging server for evidence-based debugging")
    .option("-p, --port <number>", "port to listen on (default: random)", (value) =>
      parseInt(value, 10),
    )
    .option("-H, --host <address>", "host to bind to", "127.0.0.1")
    .option("-s, --session-id <id>", "session ID (default: random 6-char hex)")
    .option("-l, --log-path <path>", "log file path (default: <tmpdir>/react-doctor-debug/...)")
    .option("-d, --daemon", "start the server in the background and exit")
    .option("--json", "output server info as JSON (no spinner/colors)")
    .action(debugAction);
};
