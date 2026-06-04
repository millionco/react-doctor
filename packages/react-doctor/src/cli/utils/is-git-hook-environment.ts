// `GIT_DIR` is set by git itself whenever it invokes a hook (per
// `git-hooks(5)`), which covers lefthook, husky, simple-git-hooks, pre-commit,
// and anything else that lives in `.git/hooks/`. It's the canonical "I'm inside
// a git hook" signal: a hook inherits the parent TTY (so `isTTY` can be true)
// yet must never emit cursor-escape animations (issue #293).
export const isGitHookEnvironment = (): boolean => Boolean(process.env.GIT_DIR);
