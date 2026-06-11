// Repo tooling (release scripts, Django management commands, build entry
// points) takes its input from argv and config, not web callers — request-
// shaped taint heuristics misread their f-strings and path joins.
export const isDevToolingPath = (relativePath: string): boolean =>
  /(?:^|\/)(?:tools?|scripts?)\/|(?:^|\/)management\/commands\/|(?:^|\/)(?:build|make|gulpfile|gruntfile)\.[cm]?[jt]s$/i.test(
    relativePath,
  );
