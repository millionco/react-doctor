// rule: no-document-write
// weakness: name-heuristic
// source: ISSUES_TO_FIX_ASAP.md semantic mutation matrix
const document = {
  write: (value: string) => value,
};

export const writeToBuffer = (value: string) => document.write(value);
