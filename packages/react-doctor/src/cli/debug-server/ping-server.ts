import http from "node:http";
import { DEBUG_LOCK_PING_TIMEOUT_MS } from "../utils/constants.js";

// Confirm the listener at host:port is actually a debug server, not just any
// process that happened to bind the lock's port: require a 200 whose body is
// the `{ "ok": true }` health response from `GET /`.
const isHealthyDebugResponse = (statusCode: number | undefined, body: string): boolean => {
  if (statusCode !== 200) return false;
  try {
    return JSON.parse(body)?.ok === true;
  } catch {
    return false;
  }
};

export const pingDebugServer = (host: string, port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const request = http.get(
      { hostname: host, port, path: "/", timeout: DEBUG_LOCK_PING_TIMEOUT_MS },
      (response) => {
        let body = "";
        response.on("data", (chunk: Buffer) => (body += chunk));
        response.on("end", () => resolve(isHealthyDebugResponse(response.statusCode, body)));
        response.on("error", () => resolve(false));
      },
    );
    request.on("error", () => resolve(false));
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
  });
