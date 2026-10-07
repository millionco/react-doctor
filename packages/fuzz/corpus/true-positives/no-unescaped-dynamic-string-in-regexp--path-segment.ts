// rule: no-unescaped-dynamic-string-in-regexp
// verdict: fail
// weakness: name-heuristic
// source: ReactBench RDFPFN792026 dynamic RegExp false-negative audit

export const stripRootDirectory = (relativePath: string, directorySegment: string): string =>
  relativePath.replace(new RegExp(`^${directorySegment}/`), "");
