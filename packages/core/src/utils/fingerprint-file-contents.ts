import crypto from "node:crypto";
import * as fs from "node:fs";

interface FileFingerprintCacheEntry {
  readonly fingerprint: string;
  readonly modifiedTimeNanoseconds: bigint;
  readonly sizeBytes: bigint;
}

const fingerprintCacheByFilePath = new Map<string, FileFingerprintCacheEntry>();

export const fingerprintFileContents = (filePath: string, fingerprintLength: number): string => {
  const fileStats = fs.statSync(filePath, { bigint: true });
  const cachedFingerprint = fingerprintCacheByFilePath.get(filePath);
  if (
    cachedFingerprint?.modifiedTimeNanoseconds === fileStats.mtimeNs &&
    cachedFingerprint.sizeBytes === fileStats.size
  ) {
    return cachedFingerprint.fingerprint;
  }

  const fingerprint = crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex")
    .slice(0, fingerprintLength);
  fingerprintCacheByFilePath.set(filePath, {
    fingerprint,
    modifiedTimeNanoseconds: fileStats.mtimeNs,
    sizeBytes: fileStats.size,
  });
  return fingerprint;
};
