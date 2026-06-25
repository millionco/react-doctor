import type { Server } from "node:http";

export interface LogServerOptions {
  sessionId?: string;
  // Project directory used to scope the reuse lock + default log location to a
  // single codebase, so unrelated projects don't share one server.
  cwd?: string;
  logPath?: string;
  host?: string;
  port?: number;
}

export interface LogServerInfo {
  sessionId: string;
  port: number;
  endpoint: string;
  logPath: string;
}

export interface LogServerResult {
  // null when an already-running server was reused, so callers know there is
  // nothing of their own to close.
  server: Server | null;
  info: LogServerInfo;
  reused: boolean;
}

export interface ServerLock extends LogServerInfo {
  pid: number;
  host: string;
}

export interface LogEntry {
  id?: string;
  sessionId?: string;
  timestamp?: number;
  [field: string]: unknown;
}
