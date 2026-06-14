import { REACT_DOCTOR_RULES } from "oxlint-plugin-react-doctor";
import type { FileScan, ScannedFile } from "oxlint-plugin-react-doctor";
import { buildSecurityScanDiagnostic } from "./checks/security-scan/build-security-scan-diagnostic.js";
import type { SecurityScanRuleEntry } from "./checks/security-scan/build-security-scan-diagnostic.js";
import { collectSecurityScanFiles } from "./checks/security-scan/collect-security-scan-files.js";
import { buildCapabilities, shouldEnableRule } from "./runners/oxlint/capabilities.js";
import type { Diagnostic, ProjectInfo } from "./types/index.js";
import { isPathGitIgnored } from "./utils/is-path-git-ignored.js";

export interface CheckSecurityScanOptions {
  readonly project?: ProjectInfo;
  readonly ignoredTags?: ReadonlySet<string>;
}

interface EnabledScanRule {
  readonly entry: SecurityScanRuleEntry;
  readonly scan: FileScan;
}

// Rules whose finding asserts a file is "checked into the repository". A file
// git actually ignores (a local-only `.env`, a gitignored key) is not
// committed, so its findings are dropped. Other scan rules (artifact leaks,
// public-debug, …) deliberately inspect gitignored build output, so they are
// unaffected. Suppress only on a definitive `true` — when git can't decide
// (no repo, git missing) the finding stands.
const COMMITTED_FILE_RULE_IDS = new Set(["repository-secret-file", "key-lifecycle-risk"]);

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
  const capabilities = options.project ? buildCapabilities(options.project) : new Set<string>();
  const ignoredTags = options.ignoredTags ?? new Set<string>();

  const enabledScanRules: EnabledScanRule[] = REACT_DOCTOR_RULES.flatMap((entry) => {
    const rule = entry.rule;
    const scan = rule.scan;
    if (typeof scan !== "function") return [];
    if (rule.defaultEnabled === false) return [];
    if (!shouldEnableRule(rule.requires, rule.tags, capabilities, ignoredTags, rule.disabledBy)) {
      return [];
    }
    return [{ entry, scan }];
  });
  if (enabledScanRules.length === 0) return [];

  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  const gitIgnoredCache = new Map<string, boolean | null>();
  const isCommittedFileGitIgnored = (file: ScannedFile): boolean => {
    let status = gitIgnoredCache.get(file.absolutePath);
    if (status === undefined) {
      status = isPathGitIgnored(rootDirectory, file.absolutePath);
      gitIgnoredCache.set(file.absolutePath, status);
    }
    return status === true;
  };

  for (const file of collectSecurityScanFiles(rootDirectory)) {
    for (const { entry, scan } of enabledScanRules) {
      const dropWhenGitIgnored = COMMITTED_FILE_RULE_IDS.has(entry.id);
      for (const finding of scan(file)) {
        if (dropWhenGitIgnored && isCommittedFileGitIgnored(file)) continue;
        const diagnostic = buildSecurityScanDiagnostic(finding, entry, file.relativePath);
        const key = `${diagnostic.rule}:${diagnostic.filePath}:${diagnostic.line}:${diagnostic.column}:${diagnostic.message}`;
        if (seen.has(key)) continue;
        seen.add(key);
        diagnostics.push(diagnostic);
      }
    }
  }

  return diagnostics;
};
