// rule: no-dynamic-import-path
// weakness: wrapper-transparency
// verdict: pass
export const loadTheme = () => import("./theme.css" as string);
