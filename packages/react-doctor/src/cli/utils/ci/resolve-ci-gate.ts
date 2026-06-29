import { isValidBlockingLevel } from "../resolve-blocking-level.js";
import { isScopeValue } from "../resolve-scope.js";
import { BLOCKING_CHOICES, SCOPE_CHOICES, type CiGate } from "./ci-provider.js";

// The gate fields a command can set non-interactively. Commander leaves an
// absent flag `undefined` and resolves `--comment` / `--no-comment` to a single
// boolean, so an unset field means "leave the current value alone".
export interface CiGateFlagInput {
  readonly blocking?: string;
  readonly scope?: string;
  readonly comment?: boolean;
  readonly reviewComments?: boolean;
  readonly commitStatus?: boolean;
}

export interface CiGateFlagResult {
  readonly gate: CiGate;
  // A human-readable message when a flag carried an invalid value; the gate is
  // unchanged in that case so the caller can report and stop.
  readonly error: string | null;
}

const expectedValues = (choices: ReadonlyArray<{ readonly value: string }>): string =>
  choices.map((choice) => choice.value).join(", ");

// Layers the flags a user passed onto a base gate (the advisory default for
// `ci install`, or the current on-disk gate for `ci config`), validating the
// two enum fields against the same guards the scanner uses.
export const applyGateFlags = (base: CiGate, flags: CiGateFlagInput): CiGateFlagResult => {
  let next = base;

  if (flags.blocking !== undefined) {
    if (!isValidBlockingLevel(flags.blocking)) {
      return {
        gate: base,
        error: `Invalid --blocking "${flags.blocking}". Expected one of: ${expectedValues(BLOCKING_CHOICES)}.`,
      };
    }
    next = { ...next, blocking: flags.blocking };
  }

  if (flags.scope !== undefined) {
    if (!isScopeValue(flags.scope)) {
      return {
        gate: base,
        error: `Invalid --scope "${flags.scope}". Expected one of: ${expectedValues(SCOPE_CHOICES)}.`,
      };
    }
    next = { ...next, scope: flags.scope };
  }

  if (flags.comment !== undefined) next = { ...next, comment: flags.comment };
  if (flags.reviewComments !== undefined) next = { ...next, reviewComments: flags.reviewComments };
  if (flags.commitStatus !== undefined) next = { ...next, commitStatus: flags.commitStatus };

  return { gate: next, error: null };
};

// True when at least one gate flag was supplied, which puts `ci config` into
// non-interactive mode (apply exactly what was passed, ask nothing).
export const hasAnyGateFlag = (flags: CiGateFlagInput): boolean =>
  flags.blocking !== undefined ||
  flags.scope !== undefined ||
  flags.comment !== undefined ||
  flags.reviewComments !== undefined ||
  flags.commitStatus !== undefined;
