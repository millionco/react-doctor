import * as http from "node:http";
import { describe, expect, it } from "vite-plus/test";
import { detectLocalRuntimeUrls } from "../src/cli/runtime-scan/detect-local-runtime-urls.js";

const listen = (server: http.Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

const close = (server: http.Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });

describe("detectLocalRuntimeUrls", () => {
  it("finds HTTP apps listening on localhost", async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<title>Local app</title>");
    });
    await listen(server);
    try {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("Expected a TCP server address.");
      }

      await expect(detectLocalRuntimeUrls([address.port])).resolves.toEqual([
        {
          port: address.port,
          url: `http://localhost:${address.port}`,
        },
      ]);
    } finally {
      await close(server);
    }
  });
});
