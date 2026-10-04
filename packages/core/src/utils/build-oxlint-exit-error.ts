import { ABORT_EXIT_CODES } from "../constants.js";
import { OxlintBatchExceeded, ReactDoctorError } from "../errors.js";

export interface BuildOxlintExitErrorInput {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderrOutput: string;
}

// Windows has no POSIX signals: an aborting child (the native binding
// panicking under memory pressure) reports `signal: null` plus a well-known
// abort exit code, so those exits are folded into the same OOM class a POSIX
// SIGABRT produces. Returns `null` for a regular (non-signal) exit.
export const buildOxlintExitError = ({
  exitCode,
  signal,
  stderrOutput,
}: BuildOxlintExitErrorInput): ReactDoctorError | null => {
  const isAbortExitCode = exitCode !== null && ABORT_EXIT_CODES.has(exitCode);
  if (!signal && !isAbortExitCode) return null;
  const isOom = signal === "SIGABRT" || isAbortExitCode;
  const detailParts: string[] = [
    signal ? `killed by ${signal}` : `aborted with exit code ${exitCode}`,
  ];
  if (isOom) detailParts.push("try scanning fewer files with --diff");
  if (stderrOutput) detailParts.push(stderrOutput);
  return new ReactDoctorError({
    reason: new OxlintBatchExceeded({
      kind: isOom ? "oom" : "killed",
      detail: detailParts.join(" — "),
    }),
  });
};
