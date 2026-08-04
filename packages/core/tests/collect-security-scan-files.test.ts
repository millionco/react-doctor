import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { collectSecurityScanFiles } from "../src/checks/security-scan/collect-security-scan-files.js";

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-security-scan-files-"));

afterAll(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

describe("collectSecurityScanFiles", () => {
  it("does not walk excluded descendant projects", () => {
    const excludedDirectory = path.join(temporaryRoot, "packages", "web");
    fs.mkdirSync(excludedDirectory, { recursive: true });
    fs.writeFileSync(path.join(temporaryRoot, ".env"), "ROOT_SECRET=value\n");
    fs.writeFileSync(path.join(excludedDirectory, ".env"), "CHILD_SECRET=value\n");

    const relativePaths = [
      ...collectSecurityScanFiles(temporaryRoot, new Set([excludedDirectory])),
    ].flatMap((file) => (file === null ? [] : [file.relativePath]));

    expect(relativePaths).toContain(".env");
    expect(relativePaths).not.toContain("packages/web/.env");
  });
});
