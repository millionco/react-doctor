// rule: no-unguarded-throwing-parse-call
// weakness: source-tracing
// source: adversarial audit of PR parsing/string-safety group

import chroma from "chroma-js";

export const readThemeColor = (theme: { colorPrimary: string }): string =>
  chroma(theme.colorPrimary).hex();
