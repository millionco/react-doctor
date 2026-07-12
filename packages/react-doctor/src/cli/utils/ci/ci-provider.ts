import type { BlockingLevel, ScopeValue } from "@react-doctor/core";

// One CI backend React Doctor can scaffold and manage. GitHub Actions is the
// fully supported provider; GitLab CI is a gate-only scaffold (no PR-opening,
// no comment/status reporter yet), so the interface lets each provider declare
// exactly what it supports instead of forcing every backend to implement the
// full surface.
export type CiProviderId = "github-actions" | "gitlab-ci";

// The pull-request gate: how React Doctor behaves on each scan. The values map
// 1:1 to the GitHub Action inputs (action.yml), so a gate round-trips between
// the workflow file and the `ci config` command without translation.
export type CiGateKey = "blocking" | "scope" | "comment" | "reviewComments" | "commitStatus";

export interface CiGate {
  // Whether a finding fails the check: "none" reports only, "warning" fails on
  // any finding, "error" fails on error-level findings.
  readonly blocking: BlockingLevel;
  // Which issues a pull-request scan reports (see SCOPE_CHOICES for the copy).
  readonly scope: ScopeValue;
  // Post a summary comment on each pull request.
  readonly comment: boolean;
  // Add inline review comments on changed lines.
  readonly reviewComments: boolean;
  // Report a commit status carrying the health score.
  readonly commitStatus: boolean;
}

// The advisory default every fresh scaffold starts from: report on every pull
// request, never fail the check. Mirrors the GitHub Action's own input
// defaults so an advisory gate produces the canonical commented template.
export const ADVISORY_GATE: CiGate = {
  blocking: "none",
  scope: "changed",
  comment: true,
  reviewComments: true,
  commitStatus: true,
};

// A workflow file read from disk, ready to parse or edit.
export interface CiWorkflowFile {
  readonly path: string;
  readonly content: string;
}

export interface CiScaffoldResult {
  readonly status: "created" | "exists" | "failed";
  readonly path: string;
}

export interface CiEditResult {
  readonly content: string;
  readonly changed: boolean;
}

// A choice the `ci config` prompt offers for an enum gate field, paired with
// the plain-language line shown after the change so the question and the recap
// never drift.
export interface CiGateChoice<Value extends string> {
  readonly value: Value;
  readonly title: string;
  readonly description: string;
}

export const BLOCKING_CHOICES: ReadonlyArray<CiGateChoice<BlockingLevel>> = [
  {
    value: "none",
    title: "Advisory",
    description: "Report findings, never fail the check",
  },
  {
    value: "error",
    title: "Block on errors",
    description: "Fail the check on new error-level findings",
  },
  {
    value: "warning",
    title: "Block on warnings",
    description: "Fail the check on any new finding",
  },
];

export const SCOPE_CHOICES: ReadonlyArray<CiGateChoice<ScopeValue>> = [
  {
    value: "changed",
    title: "New issues",
    description: "Only the issues a change introduces",
  },
  {
    value: "files",
    title: "Changed files",
    description: "Every issue in the files a change touches",
  },
  {
    value: "lines",
    title: "Changed lines",
    description: "Issues on the exact lines a change edits",
  },
  {
    value: "full",
    title: "Whole project",
    description: "Every issue in the project, on every run",
  },
];

// One toggle gate field. `description` is the prompt label and doubles as the
// "on" recap line; `whenOff` is the recap line when it's disabled.
export interface CiGateToggleInfo {
  readonly key: Extract<CiGateKey, "comment" | "reviewComments" | "commitStatus">;
  readonly title: string;
  readonly description: string;
  readonly whenOff: string;
}

export const TOGGLE_INFO: ReadonlyArray<CiGateToggleInfo> = [
  {
    key: "comment",
    title: "Summary comment",
    description: "Post a summary comment on each pull request",
    whenOff: "Skip the summary comment",
  },
  {
    key: "reviewComments",
    title: "Inline review comments",
    description: "Add inline review comments on changed lines",
    whenOff: "Skip inline review comments",
  },
  {
    key: "commitStatus",
    title: "Commit status",
    description: "Report a commit status with the health score",
    whenOff: "Skip the commit status",
  },
];

// Recap copy for the two enum fields, keyed by value so there's no nested
// ternary. Phrased as actions ("Fail the check…") to read under "will now:".
const BLOCKING_SUMMARY: Record<BlockingLevel, string> = {
  none: "Report findings without failing the check",
  warning: "Fail the check on any new finding",
  error: "Fail the check on new error-level findings",
};

const SCOPE_SUMMARY: Record<ScopeValue, string> = {
  full: "Scan the whole project on every run",
  files: "Report every issue in changed files",
  lines: "Report issues whose source spans touch changed lines",
  changed: "Report only the issues a change introduces",
};

// The interface every CI backend implements. A provider owns its file format
// (workflow YAML, `.gitlab-ci.yml`), so the command layer stays format-blind:
// it detects a provider, reads the gate, edits it, and reports the result.
export interface CiProvider {
  readonly id: CiProviderId;
  // Human name for prompts and messages ("GitHub Actions").
  readonly displayName: string;
  // Project-relative path of the file this provider owns, for messages.
  readonly fileLabel: string;
  // Gate fields this provider can act on. GitLab supports only blocking + scope
  // (it has no PR comment or commit-status reporter yet), so `ci config` hides
  // the toggles it can't honor instead of writing settings that do nothing.
  readonly supportedGateKeys: ReadonlyArray<CiGateKey>;
  // Whether `ci install --pr` / `ci upgrade --pr` can open a pull request.
  readonly supportsPullRequest: boolean;
  readonly workflowPath: (projectRoot: string) => string;
  // Reads the provider's file, or null when it's absent or unreadable.
  readonly readWorkflow: (projectRoot: string) => CiWorkflowFile | null;
  // Whether `content` actually wires up React Doctor (a GitHub step, a GitLab
  // scan job) — distinct from the file merely existing, since a `.gitlab-ci.yml`
  // can be a full pipeline with no React Doctor job at all.
  readonly containsReactDoctor: (content: string) => boolean;
  // Writes a fresh file from the gate. Returns "exists" without overwriting.
  readonly scaffold: (projectRoot: string, defaultBranch: string, gate: CiGate) => CiScaffoldResult;
  // The gate currently in effect in `content` (advisory defaults when nothing
  // is configured explicitly).
  readonly parseGate: (content: string) => CiGate;
  // Rewrites `content` to the new gate, or null when the file diverged from
  // what React Doctor generates and editing it could clobber the user's work
  // (the caller then prints `renderSnippet` for the user to paste).
  readonly applyGate: (content: string, gate: CiGate) => CiEditResult | null;
  // The block a user pastes by hand when `applyGate` declines to edit.
  readonly renderSnippet: (gate: CiGate) => string;
  // Bumps a pinned floating major to the current one (GitHub only).
  readonly upgradeMajor?: (content: string) => CiEditResult;
}

// True when two gates request the same behavior on every field.
export const gatesEqual = (left: CiGate, right: CiGate): boolean =>
  left.blocking === right.blocking &&
  left.scope === right.scope &&
  left.comment === right.comment &&
  left.reviewComments === right.reviewComments &&
  left.commitStatus === right.commitStatus;

// Plain-language recap of what a gate does, one line per supported field, for
// the message printed after `ci config` writes the change. Keeps users from
// having to read YAML to know what they just turned on.
export const summarizeGate = (
  gate: CiGate,
  supportedGateKeys: ReadonlyArray<CiGateKey>,
): ReadonlyArray<string> => {
  const lines: string[] = [];
  if (supportedGateKeys.includes("blocking")) lines.push(BLOCKING_SUMMARY[gate.blocking]);
  if (supportedGateKeys.includes("scope")) lines.push(SCOPE_SUMMARY[gate.scope]);
  for (const toggle of TOGGLE_INFO) {
    if (!supportedGateKeys.includes(toggle.key)) continue;
    lines.push(gate[toggle.key] ? toggle.description : toggle.whenOff);
  }
  return lines;
};
