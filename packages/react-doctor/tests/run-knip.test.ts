import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "knip";
import { runKnip } from "../src/utils/run-knip.js";

vi.mock("knip", () => ({
  main: vi.fn(),
}));

vi.mock("knip/session", () => ({
  createOptions: vi.fn(async () => ({
    parsedConfig: {},
  })),
}));

const tempProjectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-knip-test-"));
fs.mkdirSync(path.join(tempProjectDirectory, "node_modules"));

afterAll(() => {
  fs.rmSync(tempProjectDirectory, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runKnip", () => {
  it("returns diagnostics without throwing when issues.files is missing", async () => {
    vi.mocked(main).mockResolvedValue({
      issues: {
        files: undefined,
        dependencies: {},
        devDependencies: {},
        unlisted: {},
        exports: {},
        types: {},
        duplicates: {},
      },
      counters: {},
    } as never);

    await expect(runKnip(tempProjectDirectory)).resolves.toEqual([]);
  });
});
