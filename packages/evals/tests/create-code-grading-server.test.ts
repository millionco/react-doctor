import { once } from "node:events";
import type { Server } from "node:http";
import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { CodeGradingEvaluator } from "../src/code-grading-schema.js";
import type {
  CodeGradingAdmission,
  CodeGradingServerOptions,
} from "../src/create-code-grading-server.js";
import { createCodeGradingServer } from "../src/create-code-grading-server.js";
import { CODE_GRADING_MAX_REQUEST_BYTES } from "../src/constants.js";

const servers: Server[] = [];
const startServer = async (options: Partial<CodeGradingServerOptions> = {}) => {
  const evaluate = vi.fn<CodeGradingEvaluator["evaluate"]>(async () => ({
    choice: "valid",
    probabilities: { valid: 0.99, violation: 0.01, insufficient_context: 0 },
    contextSufficient: 0.99,
    inputTokens: 1,
  }));
  const server = createCodeGradingServer({
    apiKey: "test-key",
    evaluator: { id: "test", evaluate },
    ...options,
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  return { url: `http://127.0.0.1:${address.port}/v1/check`, evaluate };
};

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        }),
    ),
  );
});

describe("code grading HTTP API", () => {
  it("rejects firewall failures before model work and only checks authenticated requests", async () => {
    const checkAdmission = vi.fn(
      async (): Promise<CodeGradingAdmission> => ({ status: "limited" }),
    );
    const { url, evaluate } = await startServer({ checkAdmission });
    expect((await fetch(url, { method: "POST" })).status).toBe(401);
    expect(checkAdmission).not.toHaveBeenCalled();
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: "Bearer test-key", "content-type": "application/json" },
      body: JSON.stringify({ items: [{}] }),
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(checkAdmission).toHaveBeenCalledTimes(1);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("aborts model work when the HTTP client disconnects", async () => {
    const started = Promise.withResolvers<void>();
    const cancelled = Promise.withResolvers<void>();
    const { url } = await startServer({
      evaluator: {
        id: "test",
        evaluate: async (_context, signal) => {
          signal?.addEventListener("abort", () => cancelled.resolve(), { once: true });
          started.resolve();
          return new Promise(() => {});
        },
      },
    });
    const controller = new AbortController();
    const pending = fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: "Bearer test-key",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        items: [
          {
            id: "valid",
            code: "<div />",
            rule: {
              key: "react-doctor/jsx-no-duplicate-props",
              description: "No duplicate JSX props",
              exceptions: [],
            },
          },
        ],
      }),
    });
    const rejected = expect(pending).rejects.toThrow();
    await started.promise;
    controller.abort();
    await rejected;
    await cancelled.promise;
  });

  it("caps active batches before accepting more grading work", async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<Awaited<ReturnType<CodeGradingEvaluator["evaluate"]>>>();
    const evaluate = vi.fn(async () => {
      started.resolve();
      return release.promise;
    });
    const { url } = await startServer({ evaluator: { id: "test", evaluate } });
    const send = () =>
      fetch(url, {
        method: "POST",
        headers: {
          authorization: "Bearer test-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          items: [
            {
              id: "valid",
              code: "<div />",
              rule: {
                key: "react-doctor/jsx-no-duplicate-props",
                description: "No duplicate JSX props",
                exceptions: [],
              },
            },
          ],
        }),
      });
    const first = send();
    await started.promise;
    const secondAndThird = [send(), send()];
    const busy = await Promise.race(secondAndThird);
    expect(busy.status).toBe(503);
    expect(busy.headers.get("retry-after")).toBe("1");
    release.resolve({
      choice: "valid",
      probabilities: { valid: 1, violation: 0, insufficient_context: 0 },
      contextSufficient: 1,
      inputTokens: 1,
    });
    const responses = await Promise.all([first, ...secondAndThird]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 503]);
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it("limits unauthorized bots by connection address despite spoofed forwarding headers", async () => {
    const { url, evaluate } = await startServer({ rateLimit: { addressRequests: 2 } });
    for (const forwarded of ["192.0.2.1", "192.0.2.2"]) {
      expect((await fetch(url, { headers: { "x-forwarded-for": forwarded } })).status).toBe(401);
    }
    const blocked = await fetch(url, { headers: { "x-forwarded-for": "192.0.2.3" } });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("limits authenticated requests and refills the budget", async () => {
    let now = 0;
    const { url, evaluate } = await startServer({
      now: () => now,
      rateLimit: { requests: 2, windowMs: 1000 },
    });
    const send = () =>
      fetch(url, {
        method: "POST",
        headers: {
          authorization: "Bearer test-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({ mode: "offline", items: [null] }),
      });
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    const blocked = await send();
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("1");
    now = 500;
    expect((await send()).status).toBe(200);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("charges batch items separately so large batches cannot bypass request limits", async () => {
    const { url, evaluate } = await startServer({ rateLimit: { items: 2 } });
    const send = (items: unknown[]) =>
      fetch(url, {
        method: "POST",
        headers: {
          authorization: "Bearer test-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({ mode: "offline", items }),
      });
    expect((await send([null, null])).status).toBe(200);
    expect((await send([null])).status).toBe(429);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("rejects compressed and non-JSON uploads before parsing", async () => {
    const { url, evaluate } = await startServer();
    for (const headers of [
      { "content-type": "text/plain", "content-encoding": "identity" },
      { "content-type": "application/json", "content-encoding": "gzip" },
    ]) {
      const response = await fetch(url, {
        method: "POST",
        headers: { ...headers, authorization: "Bearer test-key" },
        body: "{}",
      });
      expect(response.status).toBe(415);
    }
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("closes slow uploads after the body deadline", async () => {
    const { url, evaluate } = await startServer({ bodyTimeoutMs: 20 });
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(
        url,
        {
          method: "POST",
          headers: {
            authorization: "Bearer test-key",
            "content-type": "application/json",
            "content-length": 100,
          },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      request.on("error", reject);
      request.write("{");
    });
    expect(status).toBe(408);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("rejects oversized request bodies without making a model call", async () => {
    const { url, evaluate } = await startServer();
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(
        url,
        {
          method: "POST",
          headers: {
            authorization: "Bearer test-key",
            "content-type": "application/json",
            "content-length": CODE_GRADING_MAX_REQUEST_BYTES + 1,
          },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      request.on("error", reject);
      request.end();
    });
    expect(status).toBe(413);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("requires authentication and validates the route and method", async () => {
    const { url, evaluate } = await startServer();
    expect((await fetch(url)).status).toBe(401);
    const headers = { authorization: "Bearer test-key", "content-type": "application/json" };
    expect((await fetch(url, { headers })).status).toBe(405);
    expect((await fetch(`${url}/missing`, { headers })).status).toBe(404);
    expect((await fetch(url, { method: "POST", headers, body: "{" })).status).toBe(400);
    expect((await fetch(url, { method: "POST", headers, body: '{"items":[]}' })).status).toBe(400);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("grades batches and serves the cached assessment offline", async () => {
    const { url, evaluate } = await startServer();
    const items = [
      {
        id: "valid",
        code: "<div />",
        detected: false,
        rule: {
          key: "react-doctor/jsx-no-duplicate-props",
          description: "No duplicate JSX props.",
          exceptions: [],
        },
      },
    ];
    const send = async (mode: string) =>
      fetch(url, {
        method: "POST",
        headers: { authorization: "Bearer test-key", "content-type": "application/json" },
        body: JSON.stringify({ items, mode }),
      });
    const live = await send("live");
    expect(live.status).toBe(200);
    expect(live.headers.get("cache-control")).toBe("no-store");
    expect(await live.json()).toMatchObject({
      results: [{ verdict: "likely_tn" }],
      summary: { modelCalls: 1 },
    });
    const offline = await send("offline");
    expect(await offline.json()).toMatchObject({ summary: { modelCalls: 0, cached: 1 } });
    expect(evaluate).toHaveBeenCalledTimes(1);
  });
});
