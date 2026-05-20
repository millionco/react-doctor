import { isNonInteractiveEnvironment } from "./is-non-interactive-environment.js";

// Returns true only when the stream `ora` will render to looks safe to
// drive an animated spinner. We default to `process.stderr` because that
// is `ora`'s default stream — checking `process.stdout` instead leaves
// the bug intact in the case where stderr is the TTY with `columns`
// 0/undefined but stdout looks healthy (the typical Git pre-push hook
// shape, where stdout is piped to the hook runner but stderr inherits
// the parent TTY).
//
// `ora`'s built-in `isInteractive` check only consults `stream.isTTY`,
// `TERM`, and the `CI` env var. That misses two non-interactive contexts
// where the inherited stream is still a TTY:
//
//   1. Child processes launched under `script(1)` or a Git hook
//      (lefthook / husky / pre-commit / simple-git-hooks). The parent
//      TTY is inherited but `stream.columns` can be `0` or `undefined`.
//      Ora's render loop then computes `Math.ceil(width / 0) === Infinity`
//      lines and emits an unbounded stream of `\x1b[1A\x1b[0K`
//      (cursor-up + erase line) escapes, pegging a core at 99% CPU and
//      never terminating (issue #293). Git hooks are also caught by
//      `GIT_DIR` in `isNonInteractiveEnvironment` — belt and suspenders.
//   2. Other CI-ish env vars (`GITHUB_ACTIONS`, `GITLAB_CI`,
//      `BUILDKITE`, etc.) and agent shells (`CURSOR_AGENT`,
//      `CLAUDECODE`) where animation has no consumer.
export const isSpinnerInteractive = (stream: NodeJS.WriteStream = process.stderr): boolean => {
  if (stream.isTTY !== true) return false;
  const columnCount = stream.columns;
  if (!columnCount || columnCount <= 0) return false;
  if (process.env.TERM === "dumb") return false;
  if (isNonInteractiveEnvironment()) return false;
  return true;
};
