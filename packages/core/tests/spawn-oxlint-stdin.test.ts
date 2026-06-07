/**
 * Regression test for issue #698 — react-doctor hung at "Scanning files
 * 89/90" on WSL 2.
 *
 * oxlint's cli.js runs `process.stdin._handle?.setBlocking?.(true)` when
 * stdout is not a TTY (always the case when spawned as a child process).
 * When stdin is a pipe that the parent never closes, this can ref the
 * child's stdin handle and prevent the event loop from draining — hanging
 * the child indefinitely on platforms whose pipe implementation keeps the
 * handle alive (WSL 2).
 *
 * The fix passes `stdio: ["ignore", "pipe", "pipe"]` so the child's stdin
 * is connected to /dev/null. This test asserts that the child sees NO stdin
 * handle — if someone removes the `stdio` option, the child would get a
 * pipe (handle exists), and this test would fail.
 */

import { describe, expect, it } from "vite-plus/test";
import { spawnOxlint } from "../src/runners/oxlint/spawn-oxlint.js";

describe("issue #698: spawnOxlint connects child stdin to /dev/null", () => {
  it("child process has no stdin handle (stdin is /dev/null, not a pipe)", async () => {
    const stdout = await spawnOxlint(
      ["-e", "process.stdout.write(JSON.stringify({hasStdinHandle:!!process.stdin._handle}))"],
      process.cwd(),
      process.execPath,
    );

    const result = JSON.parse(stdout) as { hasStdinHandle: boolean };
    expect(result.hasStdinHandle).toBe(false);
  });

  it("child exits cleanly when it calls setBlocking on stdin (like oxlint)", async () => {
    const script = [
      "process.stdout.isTTY||",
      "(process.stdin._handle?.setBlocking?.(!0),",
      "process.stdout._handle?.setBlocking?.(!0));",
      'process.stdout.write("ok");',
    ].join("");

    const stdout = await spawnOxlint(["-e", script], process.cwd(), process.execPath, 5_000);

    expect(stdout).toBe("ok");
  });
});
