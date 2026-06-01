import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createDebugSessionStore,
  parseIngestSessionId,
  rememberProcessedEntryId,
  type DebugSessionState,
} from "./debug-session-store.js";

interface IngestRequestListenerOptions {
  primarySessionId: string;
  primaryLogPath: string;
  logDirectory: string;
}

interface IngestLogEntry {
  id?: string;
  sessionId?: string;
  timestamp?: number;
}

const writeJson = (
  response: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
): void => {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
};

const setCorsHeaders = (response: ServerResponse): void => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
};

const handleIngestPost = (
  request: IncomingMessage,
  response: ServerResponse,
  state: DebugSessionState,
  requestSessionId: string,
): void => {
  let requestBody = "";
  request.on("data", (chunk: Buffer) => (requestBody += chunk));
  request.on("end", () => {
    let logEntry: IngestLogEntry;
    try {
      logEntry = JSON.parse(requestBody);
    } catch {
      writeJson(response, 400, { error: "Invalid JSON" });
      return;
    }

    if (logEntry.id && state.processedEntryIds.has(logEntry.id)) {
      writeJson(response, 200, { ok: true, duplicate: true });
      return;
    }

    logEntry.sessionId = logEntry.sessionId || requestSessionId;
    logEntry.timestamp = logEntry.timestamp || Date.now();
    try {
      fs.appendFileSync(state.logPath, JSON.stringify(logEntry) + "\n");
    } catch {
      writeJson(response, 500, { error: "Failed to write log" });
      return;
    }

    if (logEntry.id) rememberProcessedEntryId(state, logEntry.id);
    writeJson(response, 200, { ok: true });
  });
  request.on("error", () => {
    if (!response.writableEnded) writeJson(response, 400, { error: "Request error" });
  });
};

const handleIngestGet = (response: ServerResponse, state: DebugSessionState): void => {
  try {
    const logContent = fs.existsSync(state.logPath) ? fs.readFileSync(state.logPath, "utf-8") : "";
    response.writeHead(200, { "Content-Type": "application/x-ndjson" });
    response.end(logContent);
  } catch {
    response.writeHead(500, { "Content-Type": "text/plain" });
    response.end("Failed to read log");
  }
};

const handleIngestDelete = (response: ServerResponse, state: DebugSessionState): void => {
  try {
    if (fs.existsSync(state.logPath)) fs.unlinkSync(state.logPath);
    state.processedEntryIds.clear();
    writeJson(response, 200, { ok: true, cleared: true });
  } catch {
    writeJson(response, 500, { error: "Failed to clear log" });
  }
};

// Build the `http.createServer` request handler: CORS + a small route table
// over the health check and the `/ingest/:sessionId` POST/GET/DELETE surface.
export const createIngestRequestListener = (
  options: IngestRequestListenerOptions,
): ((request: IncomingMessage, response: ServerResponse) => void) => {
  const store = createDebugSessionStore(options);

  return (request, response) => {
    setCorsHeaders(response);

    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }

    const url = request.url || "/";

    if (url === "/" && request.method === "GET") {
      writeJson(response, 200, { ok: true });
      return;
    }

    const requestSessionId = parseIngestSessionId(url);
    if (!requestSessionId) {
      writeJson(response, 404, { error: "Not found" });
      return;
    }

    const state = store.get(requestSessionId);

    if (request.method === "POST") {
      handleIngestPost(request, response, state, requestSessionId);
      return;
    }
    if (request.method === "GET") {
      handleIngestGet(response, state);
      return;
    }
    if (request.method === "DELETE") {
      handleIngestDelete(response, state);
      return;
    }

    response.writeHead(405).end();
  };
};
