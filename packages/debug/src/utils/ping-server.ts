import http from "node:http";
import { LOCK_PING_TIMEOUT_MS } from "../constants.js";

// Resolves true only when OUR server answers (200 + the `{ ok: true }` marker
// the `/` route returns), so a stale lock left by a crashed server — or an
// unrelated process that took the recycled port — reads as dead.
export const pingServer = (host: string, port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const request = http.get(
      { hostname: host, port, path: "/", timeout: LOCK_PING_TIMEOUT_MS },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          resolve(false);
          return;
        }
        let body = "";
        response.on("data", (chunk: Buffer) => (body += chunk));
        response.on("end", () => {
          try {
            resolve(JSON.parse(body)?.ok === true);
          } catch {
            resolve(false);
          }
        });
      },
    );
    request.on("error", () => resolve(false));
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
  });
