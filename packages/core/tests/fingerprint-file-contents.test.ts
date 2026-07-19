import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { fingerprintFileContents } from "../src/utils/fingerprint-file-contents.js";

const FINGERPRINT_LENGTH = 16;

let temporaryDirectory: string | null = null;

afterEach(() => {
  if (temporaryDirectory !== null) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = null;
  }
});

describe("fingerprintFileContents", () => {
  it("refreshes a same-size file fingerprint after an in-process rebuild", () => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-file-fingerprint-"));
    const filePath = path.join(temporaryDirectory, "plugin.js");
    fs.writeFileSync(filePath, "first-build");
    const initialFingerprint = fingerprintFileContents(filePath, FINGERPRINT_LENGTH);

    fs.writeFileSync(filePath, "later-build");
    const updatedModifiedTime = new Date("2100-01-01T00:00:00.000Z");
    fs.utimesSync(filePath, updatedModifiedTime, updatedModifiedTime);
    const rebuiltFingerprint = fingerprintFileContents(filePath, FINGERPRINT_LENGTH);

    expect(rebuiltFingerprint).not.toBe(initialFingerprint);
    expect(fingerprintFileContents(filePath, FINGERPRINT_LENGTH)).toBe(rebuiltFingerprint);
  });
});
