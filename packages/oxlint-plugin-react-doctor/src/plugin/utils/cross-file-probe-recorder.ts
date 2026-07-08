// Filesystem-probe recorder for the cross-file dependency collectors
// (`cross-file-dependencies.ts`). While a recorder is active, every
// cross-file helper that touches the filesystem reports WHICH paths its
// outcome depends on — existence probes (module-resolution candidates,
// package.json walks) and content probes (files whose bytes were read or
// whose parsed shape was consumed). The recorded probe set is the file's
// dependency fingerprint input: if every probed path still has the same
// answer (existence classification / content hash) on a later scan, the
// helpers — and therefore the cross-file rules built on them — are
// guaranteed to produce the same verdict for an unchanged file.
//
// SOUNDNESS INVARIANT (the whole sidecar-cache scheme rests on this):
// every helper reachable from a cross-file rule that reads the existence
// or content of a file OTHER than the one being linted MUST report each
// consulted path here. Two integration rules keep that true:
//
//   - single-file-derived caches (`parse-source-file`,
//     `does-module-export-name`, `is-barrel-index-module`) record the
//     content probe BEFORE their cache lookup — the cached value is a pure
//     function of that one file's content, so the probe alone captures the
//     dependency and the cache stays warm;
//   - multi-file-derived memos (`classify-package-platform`'s directory
//     walk, `resolve-tsconfig-alias`'s extends-chain loader) BYPASS their
//     memo while a recorder is active (still repopulating it), because a
//     memo hit would skip the intermediate probes the fingerprint needs.
//
// Recording is synchronous and single-flight: collectors run in the core
// orchestrator's synchronous sections, so a module-level slot is safe.
// When no recorder is active (every production lint path inside oxlint),
// both record functions are a single null check.

export interface CrossFileProbeTrace {
  /** Paths whose existence classification (file / dir / none) was consulted. */
  readonly existencePaths: Set<string>;
  /** Paths whose content (bytes, exports, parse) was consulted. */
  readonly contentPaths: Set<string>;
}

let activeProbeTrace: CrossFileProbeTrace | null = null;

export const recordExistenceProbe = (absolutePath: string): void => {
  activeProbeTrace?.existencePaths.add(absolutePath);
};

export const recordContentProbe = (absolutePath: string): void => {
  activeProbeTrace?.contentPaths.add(absolutePath);
};

export const isProbeRecorderActive = (): boolean => activeProbeTrace !== null;

// Runs `collect` with a fresh trace installed and returns everything it
// probed. Re-entrant use is a programming error — the collectors never
// nest — so the previous trace is restored defensively rather than merged.
export const collectCrossFileProbes = (collect: () => void): CrossFileProbeTrace => {
  const previousTrace = activeProbeTrace;
  const trace: CrossFileProbeTrace = {
    existencePaths: new Set<string>(),
    contentPaths: new Set<string>(),
  };
  activeProbeTrace = trace;
  try {
    collect();
  } finally {
    activeProbeTrace = previousTrace;
  }
  return trace;
};
