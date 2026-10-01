import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { listSourceFiles } from "@react-doctor/core";
import { initGitRepo, writeFile } from "./_helpers.js";

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-cloudflare-"));

afterAll(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

describe("issue #1851: .cloudflare directory exclusion", () => {
  it("excludes .cloudflare build output from source file discovery", () => {
    const projectDirectory = path.join(temporaryRoot, "cloudflare-project");
    fs.mkdirSync(projectDirectory, { recursive: true });

    writeFile(path.join(projectDirectory, "src/worker.ts"), "export default { fetch() {} };\n");
    writeFile(
      path.join(projectDirectory, ".cloudflare/output/v0/bundle/worker.js"),
      "module.exports = {};\n",
    );
    writeFile(
      path.join(projectDirectory, ".cloudflare/cache/account.json"),
      '{"accountId":"abc123"}\n',
    );

    initGitRepo(projectDirectory);

    const filePaths = listSourceFiles(projectDirectory);

    expect(filePaths).toContain("src/worker.ts");
    expect(filePaths).not.toContain(".cloudflare/output/v0/bundle/worker.js");
    expect(filePaths).not.toContain(".cloudflare/cache/account.json");
  });
});
