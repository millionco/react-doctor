import { expect, test } from "vite-plus/test";
import { connectToBrowser } from "../src/connect.js";

// An unreachable CDP endpoint refuses fast, so we don't wait the full attach
// timeout. With launching disabled, the attach failure should surface as the
// actionable "start Chrome with --remote-debugging-port" error.
test("connectToBrowser throws an actionable error when attach fails and launch is disabled", async () => {
  await expect(
    connectToBrowser({ cdpEndpoint: "http://127.0.0.1:1", launch: false }),
  ).rejects.toThrow(/--remote-debugging-port=1/);
});
