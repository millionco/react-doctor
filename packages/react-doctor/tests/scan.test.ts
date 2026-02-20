import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { scan } from "../src/scan.js";

const FIXTURES_DIRECTORY = path.resolve(import.meta.dirname, "fixtures");

vi.mock("ora", () => ({
  default: () => ({
    text: "",
    start: function () {
      return this;
    },
    stop: function () {
      return this;
    },
    succeed: () => {},
    fail: () => {},
  }),
}));

const noReactTempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-test-"));
fs.writeFileSync(
  path.join(noReactTempDirectory, "package.json"),
  JSON.stringify({ name: "no-react", dependencies: {} }),
);

afterAll(() => {
  fs.rmSync(noReactTempDirectory, { recursive: true, force: true });
});

describe("scan", () => {
  it("completes without throwing on a valid React project", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await scan(path.join(FIXTURES_DIRECTORY, "basic-react"), {
        lint: true,
        deadCode: false,
      });
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("throws when React dependency is missing", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(scan(noReactTempDirectory, { lint: true, deadCode: false })).rejects.toThrow(
        "No React dependency found",
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("skips lint when option is disabled", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await scan(path.join(FIXTURES_DIRECTORY, "basic-react"), {
        lint: false,
        deadCode: false,
      });
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("runs lint and dead code in parallel when both enabled", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const startTime = performance.now();
      await scan(path.join(FIXTURES_DIRECTORY, "basic-react"), {
        lint: true,
        deadCode: true,
      });
      const elapsedMilliseconds = performance.now() - startTime;

      expect(elapsedMilliseconds).toBeLessThan(30_000);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("writes report.html and logs report path when diagnostics exist", async () => {
    const logCalls: string[] = [];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation((message: string) => {
      logCalls.push(message);
    });
    try {
      await scan(path.join(FIXTURES_DIRECTORY, "basic-react"), {
        lint: true,
        deadCode: false,
      });
      const hasReportWrittenMessage = logCalls.some((call) => call.includes("report written to"));
      const hasReportOpenMessage = logCalls.some((call) => call.includes("report.html"));
      expect(hasReportWrittenMessage).toBe(true);
      expect(hasReportOpenMessage).toBe(true);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
