import { expect, test } from "vite-plus/test";
import { cdpPortFromEndpoint } from "../src/utils/cdp-port.js";

test("cdpPortFromEndpoint returns the explicit port", () => {
  expect(cdpPortFromEndpoint("http://127.0.0.1:9333")).toBe("9333");
});

test("cdpPortFromEndpoint falls back to the default when no port is present", () => {
  expect(cdpPortFromEndpoint("http://localhost")).toBe("9222");
});

test("cdpPortFromEndpoint falls back to the default for an unparseable endpoint", () => {
  expect(cdpPortFromEndpoint("not a url")).toBe("9222");
});
