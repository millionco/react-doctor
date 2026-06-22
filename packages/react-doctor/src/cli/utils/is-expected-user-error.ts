import { isProjectDiscoveryError, isReactDoctorError } from "@react-doctor/core";
import { CliInputError } from "./cli-input-error.js";
import { isEnvironmentError } from "./is-environment-error.js";

/**
 * Whether `error` is an expected, user-actionable failure — the user's project
 * or input, not a react-doctor bug. Such failures must be kept out of crash
 * reporting (Sentry + the alertable error-rate metric) and rendered via
 * `handleUserError` (a plain message — no "Something went wrong", prefilled
 * issue, Discord link, or Sentry reference), since there is no bug to report.
 *
 * Four distinct shapes reach the CLI's catch blocks:
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
 * - **Environment failures** (`ENOSPC`, `EIO`, `EROFS`, `EACCES`, `EPERM`,
 *   `ENOTDIR`, plus a `spawn`-scoped `ENOENT` for a missing binary) — disk
 *   full / failing / read-only, permission denied, or a path blocked by a
 *   file. React Doctor cannot fix the user's environment; exit cleanly with an
 *   actionable message instead of crashing. See `is-environment-error.ts` for
 *   why the set stays narrow (codes that usually mean our bug keep reaching
 *   Sentry).
 *
 * This composes the existing core narrowers rather than introducing a new
 * error-shape helper (AGENTS.md): it encodes CLI-layer reporting policy, not
 * knowledge of the `ReactDoctorError` shape.
 */
export const isExpectedUserError = (error: unknown): boolean =>
  error instanceof CliInputError ||
  isProjectDiscoveryError(error) ||
  isEnvironmentError(error) ||
  (isReactDoctorError(error) &&
    (error.reason._tag === "GitBaseBranchInvalid" || error.reason._tag === "GitBaseBranchMissing"));
