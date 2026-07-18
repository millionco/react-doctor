// rule: no-unguarded-throwing-parse-call
// weakness: control-flow
// source: adversarial audit of PR parsing/string-safety group

export const decodeHashes = (hashes: string[]): string[] => {
  try {
    return Array.from(hashes, (hash) => decodeURIComponent(hash));
  } catch {
    return [];
  }
};
