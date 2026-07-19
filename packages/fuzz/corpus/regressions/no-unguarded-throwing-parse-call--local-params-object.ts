// rule: no-unguarded-throwing-parse-call
// weakness: name-heuristic
// source: adversarial audit of PR parsing/string-safety group

export const decodeFixedPath = (value: string): string => {
  const params = { path: encodeURIComponent(value) };
  return decodeURIComponent(params.path);
};
