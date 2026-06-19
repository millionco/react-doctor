import { expect, test } from "vite-plus/test";
import { isLoopbackHost } from "../src/utils/is-loopback-host.js";

test("accepts loopback hosts", () => {
  expect(isLoopbackHost("127.0.0.1")).toBe(true);
  expect(isLoopbackHost("localhost")).toBe(true);
  expect(isLoopbackHost("::1")).toBe(true);
  expect(isLoopbackHost("[::1]")).toBe(true);
  expect(isLoopbackHost("LOCALHOST")).toBe(true);
});

test("rejects routable and all-interface hosts", () => {
  expect(isLoopbackHost("0.0.0.0")).toBe(false);
  expect(isLoopbackHost("example.com")).toBe(false);
  expect(isLoopbackHost("169.254.169.254")).toBe(false);
  expect(isLoopbackHost("192.168.1.5")).toBe(false);
});
