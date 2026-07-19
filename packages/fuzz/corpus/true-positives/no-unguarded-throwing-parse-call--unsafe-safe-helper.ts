// rule: no-unguarded-throwing-parse-call
// weakness: naming-heuristic
// source: adversarial audit of PR parsing/string-safety group

export const safeDecodePath = (params: { path: string }): string => decodeURIComponent(params.path);
