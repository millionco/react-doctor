import * as path from "node:path";
import * as crypto from "node:crypto";
import {
  SOURCE_PROJECT_FINGERPRINT_MAX_PROBE_COUNT,
  SOURCE_PROJECT_FINGERPRINT_MAX_TOTAL_BYTES,
  SOURCE_PROJECT_FINGERPRINT_SNAPSHOT_VERSION,
} from "./constants.js";

export interface SourceProjectProbeSnapshot {
  readonly absolutePath: string;
  readonly kind: "content" | "existence";
  readonly signature: string;
}

interface SourceProjectFingerprintTraceSnapshot {
  readonly contentPaths: ReadonlyArray<string>;
  readonly existencePaths: ReadonlyArray<string>;
}

export interface SourceProjectFingerprintSnapshot {
  readonly checksum: string;
  readonly version: number;
  readonly rootDirectory: string;
  readonly membership: string;
  readonly probes: ReadonlyArray<SourceProjectProbeSnapshot>;
  readonly trace: SourceProjectFingerprintTraceSnapshot;
}

export interface SourceProjectFingerprintCache {
  snapshot?: string;
}

export const readSourceProjectFingerprintSnapshot = (
  serialized: string | undefined,
): SourceProjectFingerprintSnapshot | null => {
  if (!serialized || serialized.length > SOURCE_PROJECT_FINGERPRINT_MAX_TOTAL_BYTES) return null;
  try {
    const snapshot = JSON.parse(serialized);
    if (
      !snapshot ||
      typeof snapshot.checksum !== "string" ||
      snapshot.version !== SOURCE_PROJECT_FINGERPRINT_SNAPSHOT_VERSION ||
      typeof snapshot.rootDirectory !== "string" ||
      !path.isAbsolute(snapshot.rootDirectory) ||
      typeof snapshot.membership !== "string" ||
      !Array.isArray(snapshot.probes) ||
      snapshot.probes.length > SOURCE_PROJECT_FINGERPRINT_MAX_PROBE_COUNT ||
      !snapshot.trace ||
      !Array.isArray(snapshot.trace.contentPaths) ||
      !Array.isArray(snapshot.trace.existencePaths)
    )
      return null;
    const { checksum, ...contents } = snapshot;
    if (crypto.createHash("sha256").update(JSON.stringify(contents)).digest("hex") !== checksum)
      return null;
    const keys = new Set<string>();
    for (const probe of snapshot.probes) {
      if (
        !probe ||
        typeof probe.absolutePath !== "string" ||
        !path.isAbsolute(probe.absolutePath) ||
        (probe.kind !== "content" && probe.kind !== "existence") ||
        typeof probe.signature !== "string" ||
        (probe.kind === "content"
          ? probe.signature !== "absent" && !/^[a-f0-9]{64}$/.test(probe.signature)
          : !["absent", "file", "directory"].includes(probe.signature))
      )
        return null;
      const key = JSON.stringify([probe.kind, probe.absolutePath]);
      if (keys.has(key)) return null;
      keys.add(key);
    }
    for (const [kind, paths] of [
      ["content", snapshot.trace.contentPaths],
      ["existence", snapshot.trace.existencePaths],
    ]) {
      if (
        paths.length > SOURCE_PROJECT_FINGERPRINT_MAX_PROBE_COUNT ||
        new Set(paths).size !== paths.length ||
        !paths.every(
          (absolutePath: unknown) =>
            typeof absolutePath === "string" && keys.has(JSON.stringify([kind, absolutePath])),
        )
      )
        return null;
    }
    return snapshot;
  } catch {
    return null;
  }
};
