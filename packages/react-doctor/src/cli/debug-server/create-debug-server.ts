import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  DEBUG_DEFAULT_HOST,
  DEBUG_LOG_DIRECTORY_NAME,
  DEBUG_SESSION_ID_BYTE_LENGTH,
} from "../utils/constants.js";
import { SESSION_ID_PATTERN } from "./debug-session-store.js";
import { createIngestRequestListener } from "./ingest-request-listener.js";
import { pingDebugServer } from "./ping-server.js";
import { readDebugServerLock, removeDebugServerLock, writeDebugServerLock } from "./server-lock.js";

export interface DebugServerOptions {
  sessionId?: string;
  cwd?: string;
  logPath?: string;
  host?: string;
  port?: number;
}

export interface DebugServerInfo {
  sessionId: string;
  port: number;
  endpoint: string;
  logPath: string;
}

export interface DebugServerResult {
  server: http.Server | null;
  info: DebugServerInfo;
  reused: boolean;
}

export const createDebugServer = async (
  options: DebugServerOptions = {},
): Promise<DebugServerResult> => {
  if (options.sessionId !== undefined && !SESSION_ID_PATTERN.test(options.sessionId)) {
    throw new Error(
      "Invalid --session-id: only letters, digits, '-' and '_' are allowed (no path separators).",
    );
  }
  const sessionId =
    options.sessionId || crypto.randomBytes(DEBUG_SESSION_ID_BYTE_LENGTH).toString("hex");
  const logDirectory = path.join(options.cwd || os.tmpdir(), DEBUG_LOG_DIRECTORY_NAME);
  const primaryLogPath = options.logPath || path.join(logDirectory, `debug-${sessionId}.log`);
  const host = options.host || DEBUG_DEFAULT_HOST;
  const requestedPort = options.port || 0;

  if (!fs.existsSync(logDirectory)) fs.mkdirSync(logDirectory, { recursive: true });

  const existingLock = readDebugServerLock(logDirectory);
  if (existingLock) {
    const isAlive = await pingDebugServer(existingLock.host, existingLock.port);
    if (isAlive) {
      return {
        server: null,
        info: {
          sessionId: existingLock.sessionId,
          port: existingLock.port,
          endpoint: existingLock.endpoint,
          logPath: existingLock.logPath,
        },
        reused: true,
      };
    }
    removeDebugServerLock(logDirectory);
  }

  const server = http.createServer(
    createIngestRequestListener({ primarySessionId: sessionId, primaryLogPath, logDirectory }),
  );

  return new Promise<DebugServerResult>((resolve, reject) => {
    server.listen(requestedPort, host, () => {
      const serverAddress = server.address();
      if (!serverAddress || typeof serverAddress === "string") {
        reject(new Error("Failed to get debug server address"));
        return;
      }

      const info: DebugServerInfo = {
        sessionId,
        port: serverAddress.port,
        endpoint: `http://${host}:${serverAddress.port}/ingest/${sessionId}`,
        logPath: primaryLogPath,
      };

      writeDebugServerLock(logDirectory, {
        pid: process.pid,
        host,
        port: serverAddress.port,
        sessionId,
        endpoint: info.endpoint,
        logPath: primaryLogPath,
      });

      server.on("close", () => removeDebugServerLock(logDirectory));
      // SIGINT runs the CLI's `exitGracefully` handler, which calls
      // `process.exit` before the server's `close` event can fire, so wire
      // lock removal to `exit` (always fires) to avoid a stale lock file.
      process.once("exit", () => removeDebugServerLock(logDirectory));

      resolve({ server, info, reused: false });
    });
    server.on("error", reject);
  });
};
