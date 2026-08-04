import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { activeScanAbortRegistry } from "../src/cli/utils/active-scan-abort-registry.js";
import { collectProjectSourceFileCounts } from "../src/cli/utils/collect-project-source-file-counts.js";

describe("collectProjectSourceFileCounts", () => {
  let rootDirectory: string;

  beforeEach(() => {
    rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-source-counts-"));
  });

  afterEach(() => {
    activeScanAbortRegistry.abortAll();
    fs.rmSync(rootDirectory, { recursive: true, force: true });
  });

  it("stops workspace enumeration when active scans are cancelled", async () => {
    const sourceFileCounts = collectProjectSourceFileCounts(rootDirectory, [rootDirectory]);
    activeScanAbortRegistry.abortAll();

    await expect(sourceFileCounts).rejects.toThrow();
  });
});
