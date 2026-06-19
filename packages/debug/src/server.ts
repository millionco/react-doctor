import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {
  DEFAULT_HOST,
  MAX_DEDUP_ENTRIES,
  MAX_REQUEST_BODY_BYTES,
  SESSION_ID_BYTE_LENGTH,
} from "./constants.js";
import type { LogEntry, LogServerInfo, LogServerOptions, LogServerResult } from "./types.js";
import { pingServer } from "./utils/ping-server.js";
import { resolveLogDirectory } from "./utils/resolve-log-directory.js";
import { readServerLock, removeServerLock, writeServerLock } from "./utils/server-lock.js";

// Per-session view of the log file plus the ids already written, so a retried
// POST (same `id`) is acknowledged without appending a duplicate line.
interface SessionState {
  logPath: string;
  processedEntryIds: Set<string>;
}

const parseIngestSessionId = (requestUrl: string): string | null => {
  try {
    const { pathname } = new URL(requestUrl, "http://localhost");
    const match = pathname.match(/^\/ingest\/([a-zA-Z0-9_-]+)\/?$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
};

const sendJson = (response: http.ServerResponse, statusCode: number, payload: unknown): void => {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
};

// One server can host many sessions; each owns one log file and posts to
// `/ingest/<sessionId>`. Starting twice is safe: a live server holding the lock
// is returned with `reused: true` and no second port is bound.
export const createLogServer = async (options: LogServerOptions = {}): Promise<LogServerResult> => {
  const sessionId = options.sessionId || crypto.randomBytes(SESSION_ID_BYTE_LENGTH).toString("hex");
  const logDirectory = resolveLogDirectory(options.cwd);
  const logFilePathFor = (id: string): string => path.join(logDirectory, `debug-${id}.log`);
  const primaryLogPath = options.logPath || logFilePathFor(sessionId);
  const host = options.host || DEFAULT_HOST;
  const requestedPort = options.port || 0;

  if (!fs.existsSync(logDirectory)) fs.mkdirSync(logDirectory, { recursive: true });

  const existingLock = readServerLock(logDirectory);
  if (existingLock) {
    if (await pingServer(existingLock.host, existingLock.port)) {
      // The running server hosts any `/ingest/<id>` on demand and writes each to
      // `logFilePathFor(id)` in this (shared, per-project) directory. So when the
      // caller asked for a different session id, return info pointing at THAT
      // session instead of the lock's original — otherwise they'd instrument and
      // read the wrong endpoint/file. An explicit `--log-path` can't be honored on
      // reuse: the already-running server owns where it writes, so `logPath`
      // reflects the server's real location, not the requested one.
      const usesRequestedSession =
        Boolean(options.sessionId) && sessionId !== existingLock.sessionId;
      const info: LogServerInfo = usesRequestedSession
        ? {
            sessionId,
            port: existingLock.port,
            endpoint: `http://${existingLock.host}:${existingLock.port}/ingest/${sessionId}`,
            logPath: logFilePathFor(sessionId),
          }
        : {
            sessionId: existingLock.sessionId,
            port: existingLock.port,
            endpoint: existingLock.endpoint,
            logPath: existingLock.logPath,
          };
      return { server: null, info, reused: true };
    }
    removeServerLock(logDirectory);
  }

  const sessions = new Map<string, SessionState>();
  const getSessionState = (requestSessionId: string): SessionState => {
    const existing = sessions.get(requestSessionId);
    if (existing) return existing;
    const logPath =
      requestSessionId === sessionId ? primaryLogPath : logFilePathFor(requestSessionId);
    const sessionState: SessionState = { logPath, processedEntryIds: new Set() };
    sessions.set(requestSessionId, sessionState);
    return sessionState;
  };

  const appendLog = (
    sessionState: SessionState,
    requestSessionId: string,
    requestBody: string,
  ): boolean => {
    const logEntry: LogEntry = JSON.parse(requestBody);
    if (typeof logEntry !== "object" || logEntry === null)
      throw new Error("Body must be an object");
    if (logEntry.id && sessionState.processedEntryIds.has(logEntry.id)) return true;

    logEntry.sessionId = logEntry.sessionId || requestSessionId;
    logEntry.timestamp = logEntry.timestamp || Date.now();
    fs.appendFileSync(sessionState.logPath, `${JSON.stringify(logEntry)}\n`);

    if (logEntry.id) {
      if (sessionState.processedEntryIds.size >= MAX_DEDUP_ENTRIES) {
        sessionState.processedEntryIds.clear();
      }
      sessionState.processedEntryIds.add(logEntry.id);
    }
    return false;
  };

  const server = http.createServer((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }

    const requestUrl = request.url || "/";

    // Liveness marker `pingServer` checks before reusing this server.
    if (requestUrl === "/" && request.method === "GET") {
      sendJson(response, 200, { ok: true });
      return;
    }

    const requestSessionId = parseIngestSessionId(requestUrl);
    if (!requestSessionId) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }

    const sessionState = getSessionState(requestSessionId);

    if (request.method === "POST") {
      const chunks: Buffer[] = [];
      let byteLength = 0;
      request.on("data", (chunk: Buffer) => {
        byteLength += chunk.length;
        if (byteLength > MAX_REQUEST_BODY_BYTES) {
          sendJson(response, 413, { error: "Body too large" });
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      request.on("end", () => {
        if (response.writableEnded) return;
        try {
          const wasDuplicate = appendLog(
            sessionState,
            requestSessionId,
            Buffer.concat(chunks).toString("utf-8"),
          );
          sendJson(response, 200, wasDuplicate ? { ok: true, duplicate: true } : { ok: true });
        } catch {
          sendJson(response, 400, { error: "Invalid JSON" });
        }
      });
      return;
    }

    if (request.method === "DELETE") {
      try {
        if (fs.existsSync(sessionState.logPath)) fs.unlinkSync(sessionState.logPath);
        sessionState.processedEntryIds.clear();
        sendJson(response, 200, { ok: true, cleared: true });
      } catch {
        // Generic, not the raw error: don't echo filesystem detail back to a
        // client (it's the local log file's path/permissions).
        sendJson(response, 500, { error: "Failed to clear log" });
      }
      return;
    }

    if (request.method === "GET") {
      try {
        const logContent = fs.existsSync(sessionState.logPath)
          ? fs.readFileSync(sessionState.logPath, "utf-8")
          : "";
        response.writeHead(200, { "Content-Type": "application/x-ndjson" });
        response.end(logContent);
      } catch {
        response.writeHead(500, { "Content-Type": "text/plain" });
        response.end("Failed to read log");
      }
      return;
    }

    response.writeHead(405).end();
  });

  return new Promise<LogServerResult>((resolve, reject) => {
    server.listen(requestedPort, host, () => {
      const serverAddress = server.address();
      if (!serverAddress || typeof serverAddress === "string") {
        reject(new Error("Failed to read the bound server address"));
        return;
      }

      const info: LogServerInfo = {
        sessionId,
        port: serverAddress.port,
        endpoint: `http://${host}:${serverAddress.port}/ingest/${sessionId}`,
        logPath: primaryLogPath,
      };

      writeServerLock(logDirectory, { ...info, pid: process.pid, host });
      server.on("close", () => removeServerLock(logDirectory));

      resolve({ server, info, reused: false });
    });
    server.on("error", reject);
  });
};
