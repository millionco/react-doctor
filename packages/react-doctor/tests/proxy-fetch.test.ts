import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { proxyFetch } from "../src/utils/proxy-fetch.js";

const mockUndiciState = vi.hoisted(() => ({
  shouldThrow: false,
}));

vi.mock("undici", () => ({
  ProxyAgent: class MockProxyAgent {
    proxyUrl: string;

    constructor(proxyUrl: string) {
      if (mockUndiciState.shouldThrow) {
        throw new Error("proxy unavailable");
      }
      this.proxyUrl = proxyUrl;
    }
  },
}));

describe("proxyFetch", () => {
  const originalFetch = globalThis.fetch;
  const originalProcessDescriptor = Object.getOwnPropertyDescriptor(globalThis, "process");
  const originalProxyEnvironment = {
    HTTPS_PROXY: process.env.HTTPS_PROXY,
    https_proxy: process.env.https_proxy,
    HTTP_PROXY: process.env.HTTP_PROXY,
    http_proxy: process.env.http_proxy,
  };

  beforeEach(() => {
    mockUndiciState.shouldThrow = false;
    delete process.env.HTTPS_PROXY;
    delete process.env.https_proxy;
    delete process.env.HTTP_PROXY;
    delete process.env.http_proxy;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalProcessDescriptor) {
      Object.defineProperty(globalThis, "process", originalProcessDescriptor);
    }
    for (const [name, value] of Object.entries(originalProxyEnvironment)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  it("calls fetch without dispatcher when no proxy env is set", async () => {
    const fetchMock = vi.fn(async () => new Response("ok"));
    globalThis.fetch = fetchMock;

    await proxyFetch("https://example.com", { method: "POST" });

    expect(fetchMock).toHaveBeenCalledWith("https://example.com", { method: "POST" });
  });

  it("calls fetch without dispatcher when global process does not look like Node", async () => {
    const fetchMock = vi.fn(async () => new Response("ok"));
    globalThis.fetch = fetchMock;
    Object.defineProperty(globalThis, "process", {
      configurable: true,
      value: { versions: {} },
    });

    await proxyFetch("https://example.com");

    expect(fetchMock).toHaveBeenCalledWith("https://example.com", {});
  });

  it("adds an undici dispatcher when HTTPS_PROXY is set", async () => {
    process.env.HTTPS_PROXY = "http://127.0.0.1:8080";
    const fetchMock = vi.fn(async () => new Response("ok"));
    globalThis.fetch = fetchMock;

    await proxyFetch("https://example.com", { headers: { accept: "application/json" } });

    const init = fetchMock.mock.calls[0][1];
    expect(init.headers).toEqual({ accept: "application/json" });
    expect(init.dispatcher).toBeDefined();
  });

  it("falls back to normal fetch when proxy dispatcher cannot be created", async () => {
    mockUndiciState.shouldThrow = true;
    process.env.HTTPS_PROXY = "http://127.0.0.1:8080";
    const fetchMock = vi.fn(async () => new Response("ok"));
    globalThis.fetch = fetchMock;

    await proxyFetch("https://example.com");

    expect(fetchMock).toHaveBeenCalledWith("https://example.com", {});
  });
});
