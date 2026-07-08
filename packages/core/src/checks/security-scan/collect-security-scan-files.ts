import * as fs from "node:fs";
import * as path from "node:path";
import {
  classifySecurityScanFile,
  shouldReadSecurityScanContent,
} from "oxlint-plugin-react-doctor";
import type { ScannedFile } from "oxlint-plugin-react-doctor";
import { readDirectoryEntries } from "../../project-info/fs-utils.js";
import { isLargeMinifiedFile } from "../../utils/is-large-minified-file.js";
import {
  SECURITY_SCAN_MAX_BUNDLE_FILE_SIZE_BYTES,
  SECURITY_SCAN_MAX_DIRECTORY_DEPTH,
  SECURITY_SCAN_MAX_FILES,
  SECURITY_SCAN_MAX_FILE_SIZE_BYTES,
  SKIPPED_DIRECTORY_NAMES,
} from "./constants.js";

interface DirectoryStackEntry {
  readonly absolutePath: string;
  readonly depth: number;
}

interface SecurityScanCandidate {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly isGeneratedBundleByName: boolean;
}

const readScannedFile = (candidate: SecurityScanCandidate): ScannedFile | null => {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(candidate.absolutePath);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;

  const isGeneratedBundle =
    candidate.isGeneratedBundleByName || isLargeMinifiedFile(candidate.absolutePath);
  const maxSizeBytes = isGeneratedBundle
    ? SECURITY_SCAN_MAX_BUNDLE_FILE_SIZE_BYTES
    : SECURITY_SCAN_MAX_FILE_SIZE_BYTES;
  if (stat.size > maxSizeBytes) return null;
  if (!shouldReadSecurityScanContent(candidate.relativePath, isGeneratedBundle)) return null;

  try {
    return {
      absolutePath: candidate.absolutePath,
      relativePath: candidate.relativePath,
      content: fs.readFileSync(candidate.absolutePath, "utf-8"),
      isGeneratedBundle,
    };
  } catch {
    return null;
  }
};

// Bounded whole-tree walk feeding the security-scan rules: candidate paths
// are bucketed priority → artifact → other by `classifySecurityScanFile`
// so config/secret files and shipped browser artifacts survive the cap on
// huge repositories. Only paths are collected up front; contents are read
// lazily, one file per iteration (capped at SECURITY_SCAN_MAX_FILES
// successful reads per bucket), so a caller that streams findings never
// holds more than one file's content at a time.
//
// `null` is a walk-progress marker, yielded once per directory processed: the
// path-collection phase runs BEFORE any file can be yielded (the buckets need
// the whole tree), so without markers a large tree's readdir + classify pass
// would be one unyielding burst — the cooperative driver uses them as budget
// checkpoints. Drivers that don't pace themselves just skip them.
export function* collectSecurityScanFiles(
  rootDirectory: string,
): Generator<ScannedFile | null, void, void> {
  const priorityCandidates: SecurityScanCandidate[] = [];
  const artifactCandidates: SecurityScanCandidate[] = [];
  const otherCandidates: SecurityScanCandidate[] = [];
  const stack: DirectoryStackEntry[] = [{ absolutePath: rootDirectory, depth: 0 }];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    if (current.depth > SECURITY_SCAN_MAX_DIRECTORY_DEPTH) continue;

    for (const entry of readDirectoryEntries(current.absolutePath)) {
      const absolutePath = path.join(current.absolutePath, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORY_NAMES.has(entry.name)) {
          stack.push({ absolutePath, depth: current.depth + 1 });
        }
        continue;
      }

      const relativePath = path.relative(rootDirectory, absolutePath).replaceAll("\\", "/");
      const classification = classifySecurityScanFile(relativePath);
      if (classification === null) continue;
      const candidates =
        classification.bucket === "priority"
          ? priorityCandidates
          : classification.bucket === "artifact"
            ? artifactCandidates
            : otherCandidates;
      candidates.push({
        absolutePath,
        relativePath,
        isGeneratedBundleByName: classification.isGeneratedBundleByName,
      });
    }
    yield null;
  }

  for (const candidates of [priorityCandidates, artifactCandidates, otherCandidates]) {
    let yieldedCount = 0;
    for (const candidate of candidates) {
      if (yieldedCount >= SECURITY_SCAN_MAX_FILES) break;
      const scannedFile = readScannedFile(candidate);
      if (scannedFile === null) continue;
      yieldedCount += 1;
      yield scannedFile;
    }
  }
}
