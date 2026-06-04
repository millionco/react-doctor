import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SERVER_BIN = path.join(PACKAGE_ROOT, "bin", "react-doctor-language-server.js");

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

export type NotificationHandler = (method: string, params: unknown) => void;

/**
 * Minimal hand-rolled LSP/JSON-RPC client over a spawned server's
 * stdio. Dependency-free (Content-Length framing) so the integration
 * test exercises the real published transport without pulling a client
 * library into the package.
 */
export class LspTestClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly notificationHandlers = new Set<NotificationHandler>();

  constructor() {
    this.child = spawn(process.execPath, [SERVER_BIN, "--stdio"], {
      cwd: PACKAGE_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      // Disable the persistent lint cache so tests never depend on cache
      // state left by a prior run (the cache fingerprint can't see source
      // changes between dev runs, only config/version).
      env: { ...process.env, REACT_DOCTOR_LSP_NO_CACHE: "1" },
    });
    this.child.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    // Surface server logs on failure without failing the pipe.
    this.child.stderr.on("data", () => {});
  }

  onNotification(handler: NotificationHandler): void {
    this.notificationHandlers.add(handler);
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = this.buffer.subarray(0, headerEnd).toString("utf8");
      const match = /Content-Length: (\d+)/i.exec(header);
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const contentLength = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + contentLength) return;
      const body = this.buffer.subarray(bodyStart, bodyStart + contentLength).toString("utf8");
      this.buffer = this.buffer.subarray(bodyStart + contentLength);
      this.dispatch(JSON.parse(body));
    }
  }

  private dispatch(message: {
    id?: number;
    method?: string;
    params?: unknown;
    result?: unknown;
    error?: unknown;
  }): void {
    if (
      typeof message.id === "number" &&
      (message.result !== undefined || message.error !== undefined)
    ) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(message.error);
      else pending.resolve(message.result);
      return;
    }
    if (message.method) {
      for (const handler of this.notificationHandlers) handler(message.method, message.params);
    }
  }

  private send(message: Record<string, unknown>): void {
    const body = JSON.stringify({ jsonrpc: "2.0", ...message });
    const payload = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
    this.child.stdin.write(payload);
  }

  request<T = unknown>(method: string, params: unknown): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.send({ id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.send({ method, params });
  }

  async stop(): Promise<void> {
    try {
      this.child.stdin.end();
    } catch {
      // ignore
    }
    this.child.kill();
    if (this.child.exitCode === null) await once(this.child, "exit").catch(() => {});
  }
}

export const pathToUri = (filePath: string): string => pathToFileURL(filePath).href;

/** Resolves when `predicate` sees a matching notification, or rejects on timeout. */
export const waitForNotification = (
  client: LspTestClient,
  method: string,
  predicate: (params: unknown) => boolean,
  timeoutMs = 20_000,
): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeoutMs);
    client.onNotification((incomingMethod, params) => {
      if (incomingMethod === method && predicate(params)) {
        clearTimeout(timer);
        resolve(params);
      }
    });
  });
