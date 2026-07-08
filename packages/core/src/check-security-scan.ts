import { REACT_DOCTOR_RULES } from "oxlint-plugin-react-doctor";
import type { FileScan, ScannedFile } from "oxlint-plugin-react-doctor";
import { buildSecurityScanDiagnostic } from "./checks/security-scan/build-security-scan-diagnostic.js";
import type { SecurityScanRuleEntry } from "./checks/security-scan/build-security-scan-diagnostic.js";
import { collectSecurityScanFiles } from "./checks/security-scan/collect-security-scan-files.js";
import { COOPERATIVE_YIELD_BUDGET_MS } from "./constants.js";
import { getCapabilities, shouldEnableRule } from "./project-info/capabilities.js";
import type { Diagnostic, ProjectInfo } from "./types/index.js";
import { isPathGitIgnored } from "./utils/is-path-git-ignored.js";
import { yieldToEventLoop } from "./utils/yield-to-event-loop.js";
import type { Capability } from "oxlint-plugin-react-doctor";

export interface CheckSecurityScanOptions {
  readonly project?: ProjectInfo;
  readonly ignoredTags?: ReadonlySet<string>;
}

interface EnabledScanRule {
  readonly entry: SecurityScanRuleEntry;
  readonly scan: FileScan;
  // `rule.committedFilesOnly`, precomputed per rule (see `Rule` for semantics).
  readonly committedFilesOnly: boolean;
}

interface SecurityScanSession {
  /**
   * Runs every enabled scan rule over one file, accumulating into
   * `diagnostics`. Yields once per rule so the cooperative driver can
   * re-check its time budget between rules — a single 8 MB bundle file
   * held the event loop for the whole rule set otherwise.
   */
  readonly scanFileByRule: (file: ScannedFile) => Generator<void, void, void>;
  readonly diagnostics: Diagnostic[];
}

// Shared setup for both drivers below: resolves the enabled scan rules through
// the capability/tag gate and returns a `scanFile` closure over the dedupe set
// + git-ignore cache. `null` when no scan rule is enabled, so callers can
// short-circuit the whole-tree walk.
const createSecurityScanSession = (
  rootDirectory: string,
  options: CheckSecurityScanOptions,
): SecurityScanSession | null => {
  const capabilities = options.project ? getCapabilities(options.project) : new Set<Capability>();
  const ignoredTags = options.ignoredTags ?? new Set<string>();

  const enabledScanRules: EnabledScanRule[] = REACT_DOCTOR_RULES.flatMap((entry) => {
    const rule = entry.rule;
    const scan = rule.scan;
    if (typeof scan !== "function") return [];
    if (rule.defaultEnabled === false) return [];
    if (!shouldEnableRule(rule.requires, rule.tags, capabilities, ignoredTags, rule.disabledWhen)) {
      return [];
    }
    return [{ entry, scan, committedFilesOnly: rule.committedFilesOnly === true }];
  });
  if (enabledScanRules.length === 0) return null;

  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  const gitIgnoredCache = new Map<string, boolean | null>();
  const isFileGitIgnored = (file: ScannedFile): boolean => {
    let status = gitIgnoredCache.get(file.absolutePath);
    if (status === undefined) {
      status = isPathGitIgnored(rootDirectory, file.absolutePath);
      gitIgnoredCache.set(file.absolutePath, status);
    }
    return status === true;
  };

  const scanFileByRule = function* (file: ScannedFile | null): Generator<void, void, void> {
    if (file === null) return;
    for (const { entry, scan, committedFilesOnly } of enabledScanRules) {
      for (const finding of scan(file)) {
        // A committed-file rule's finding doesn't apply to a path git ignores
        // (it isn't actually checked in). The check is deferred to here, gated
        // on an actual finding, on purpose: `scan` is cheap regex but
        // `isFileGitIgnored` spawns a `git check-ignore` subprocess — hoisting
        // it above `scan` would spawn git for every scanned file, not just the
        // rare file that trips a committed-file rule.
        if (committedFilesOnly && isFileGitIgnored(file)) continue;
        const diagnostic = buildSecurityScanDiagnostic(finding, entry, file.relativePath);
        const key = `${diagnostic.rule}:${diagnostic.filePath}:${diagnostic.line}:${diagnostic.column}:${diagnostic.message}`;
        if (seen.has(key)) continue;
        seen.add(key);
        diagnostics.push(diagnostic);
      }
      yield;
    }
  };

  return { scanFileByRule, diagnostics };
};

// Project-level security scan check: registry rules carrying a
// `scan` are excluded from the generated oxlint config and instead run here
// over one bounded whole-tree walk (shipped artifacts, dotenv/config files,
// SQL — paths lint never sees). Selection goes through the same
// `shouldEnableRule` capability/tag gate as lint rules, so `--ignore-tag
// security-scan` and `disabledBy` behave identically across both engines.
export const checkSecurityScan = (
  rootDirectory: string,
  options: CheckSecurityScanOptions = {},
): Diagnostic[] => {
  const session = createSecurityScanSession(rootDirectory, options);
  if (session === null) return [];
  for (const file of collectSecurityScanFiles(rootDirectory)) {
    if (file === null) continue;
    for (const _ruleStep of session.scanFileByRule(file)) {
      // Sync driver: exhaust the per-rule steps without yielding.
    }
  }
  return session.diagnostics;
};

// Cooperative variant: identical output to `checkSecurityScan`, but hands the
// event loop back whenever a scan slice has held it for
// `COOPERATIVE_YIELD_BUDGET_MS`, checked between every walk step and every
// (file, rule) step, so a caller that forks it (the orchestrator) can overlap
// its CPU with other async work. A time budget rather than a file interval:
// lint's child processes are spawned and drained from main-thread
// continuations, so any long stall idles the whole worker pool — and one
// large minified bundle could previously stall for its entire rule set (as
// could a large tree's whole directory walk, before the walk markers).
export const checkSecurityScanCooperative = async (
  rootDirectory: string,
  options: CheckSecurityScanOptions = {},
): Promise<Diagnostic[]> => {
  const session = createSecurityScanSession(rootDirectory, options);
  if (session === null) return [];
  let sliceStartedAt = performance.now();
  for (const file of collectSecurityScanFiles(rootDirectory)) {
    if (file === null) {
      if (performance.now() - sliceStartedAt >= COOPERATIVE_YIELD_BUDGET_MS) {
        await yieldToEventLoop();
        sliceStartedAt = performance.now();
      }
      continue;
    }
    for (const _ruleStep of session.scanFileByRule(file)) {
      if (performance.now() - sliceStartedAt >= COOPERATIVE_YIELD_BUDGET_MS) {
        await yieldToEventLoop();
        sliceStartedAt = performance.now();
      }
    }
  }
  return session.diagnostics;
};
