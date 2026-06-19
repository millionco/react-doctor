import { expect, test } from "vite-plus/test";
import { parseLogEndpoint } from "../src/utils/parse-log-endpoint.js";

test("accepts a loopback /ingest/<id> endpoint", () => {
  const url = parseLogEndpoint("http://127.0.0.1:7331/ingest/abc123");
  expect(url.hostname).toBe("127.0.0.1");
  expect(url.pathname).toBe("/ingest/abc123");
});

test("accepts localhost and ::1", () => {
  expect(() => parseLogEndpoint("http://localhost:7331/ingest/x")).not.toThrow();
  expect(() => parseLogEndpoint("http://[::1]:7331/ingest/x")).not.toThrow();
});

test("rejects a non-loopback host", () => {
  expect(() => parseLogEndpoint("http://example.com/ingest/x")).toThrow(/non-loopback/);
  expect(() => parseLogEndpoint("http://169.254.169.254/ingest/x")).toThrow(/non-loopback/);
});

test("rejects a non-ingest path", () => {
  expect(() => parseLogEndpoint("http://127.0.0.1:7331/admin")).toThrow(/expected \/ingest/);
});

test("rejects a malformed URL", () => {
  expect(() => parseLogEndpoint("not a url")).toThrow(/Invalid endpoint/);
});
