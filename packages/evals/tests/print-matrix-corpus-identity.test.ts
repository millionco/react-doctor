import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { hashMatrixCorpusProjectSet } from "../src/matrix-treatment-descriptor.js";

const temporaryDirectories: string[] = [];
const identityScriptPath = fileURLToPath(
  new URL("../src/print-matrix-corpus-identity.ts", import.meta.url),
);

const runIdentityScript = (manifestPath: string) =>
  spawnSync(process.execPath, ["--import", "tsx", identityScriptPath, manifestPath], {
    encoding: "utf8",
  });

afterEach(() => {
  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

describe("matrix-corpus-identity", () => {
  it("hashes the exact strict manifest bytes and canonical project tuples", () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-identity-"));
    temporaryDirectories.push(temporaryDirectory);
    const repositories = [
      { org: "example", name: "second", ref: "b".repeat(40), rootDir: "packages/app" },
      { org: "example", name: "first", ref: "a".repeat(40), rootDir: "." },
    ];
    const contents = `${JSON.stringify(repositories, null, 2)}\n`;
    const manifestPath = path.join(temporaryDirectory, "corpus.json");
    fs.writeFileSync(manifestPath, contents);

    const result = runIdentityScript(manifestPath);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      manifestSha256: createHash("sha256").update(contents).digest("hex"),
      projectSetSha256: hashMatrixCorpusProjectSet(repositories),
      projectCount: repositories.length,
    });
  });

  it("rejects a manifest that the matrix runner rejects", () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-identity-invalid-"));
    temporaryDirectories.push(temporaryDirectory);
    const manifestPath = path.join(temporaryDirectory, "corpus.json");
    fs.writeFileSync(
      manifestPath,
      `${JSON.stringify([
        { org: "example", name: "first", ref: "a".repeat(40), rootDir: ".", extra: true },
      ])}\n`,
    );

    const result = runIdentityScript(manifestPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("repository 1 is invalid");
  });
});
