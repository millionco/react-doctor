import { isBrowserEnvironmentError } from "@react-doctor/browser";
import { isProjectDiscoveryError, isReactDoctorError } from "@react-doctor/core";
import { CliInputError } from "./cli-input-error.js";

/**
 * Whether `error` is an expected, user-actionable failure — the user's project
 * or input, not a react-doctor bug. Such failures must be kept out of crash
 * reporting (Sentry + the alertable error-rate metric) and rendered via
 * `handleUserError` (a plain message — no "Something went wrong", prefilled
 * issue, Discord link, or Sentry reference), since there is no bug to report.
 *
 * Three distinct shapes reach the CLI's catch blocks:
 *
 * - **Project-discovery failures** (`NoReactDependencyError`,
 *   `ProjectNotFoundError`, `PackageJsonNotFoundError`, `NotADirectoryError`,
 *   `AmbiguousProjectError`) arrive as their plain legacy classes (so
 *   `isReactDoctorError` is `false` for them) — narrow with
 *   `isProjectDiscoveryError`. Running react-doctor against a directory that
 *   has no React, or a path that doesn't exist, is the canonical example.
 * - **CLI invocation mistakes** (`CliInputError`): a malformed
 *   `<file>:<line>` argument, mutually exclusive flags, or an unknown
 *   `--project` name.
 * - **Bad `--diff` input** (`GitBaseBranchInvalid` / `GitBaseBranchMissing`)
 *   stays the tagged `ReactDoctorError`, so dispatch on the reason `_tag`.
 * - **Browser environment failures** (`BrowserEnvironmentError`): no Chrome to
 *   launch, `playwright-core` not installed, or no debuggable Chrome to attach
 *   to. The message is the fix ("install Chrome", "npm i -D playwright-core"),
 *   so a newcomer running a `browser` command on a fresh machine gets that —
 *   not a "this is a bug, file an issue" crash report.
 *
 * This composes the existing narrowers rather than introducing a new
 * error-shape helper (AGENTS.md): it encodes CLI-layer reporting policy, not
 * knowledge of the `ReactDoctorError` shape.
 */
export const isExpectedUserError = (error: unknown): boolean =>
  error instanceof CliInputError ||
  isBrowserEnvironmentError(error) ||
  isProjectDiscoveryError(error) ||
  (isReactDoctorError(error) &&
    (error.reason._tag === "GitBaseBranchInvalid" || error.reason._tag === "GitBaseBranchMissing"));
