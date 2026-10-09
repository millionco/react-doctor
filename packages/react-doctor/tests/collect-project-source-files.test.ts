import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { TEMPORARY_DIRECTORY_REMOVE_MAX_RETRIES } from "./constants.js";
import { activeScanAbortRegistry } from "../src/cli/utils/active-scan-abort-registry.js";
import { collectProjectSourceFiles } from "../src/cli/utils/collect-project-source-files.js";

describe("collectProjectSourceFiles", () => {
  let rootDirectory: string;

  beforeEach(() => {
    rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-source-counts-"));
  });

  afterEach(async () => {
    await activeScanAbortRegistry.abortAll();
    fs.rmSync(rootDirectory, {
      recursive: true,
      force: true,
      maxRetries: TEMPORARY_DIRECTORY_REMOVE_MAX_RETRIES,
    });
  });

  it("stops workspace enumeration when active scans are cancelled", async () => {
    const sourceFiles = collectProjectSourceFiles(rootDirectory, [rootDirectory]);
    await activeScanAbortRegistry.abortAll();

    await expect(sourceFiles).rejects.toThrow();
  });
});
