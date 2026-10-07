// rule: js-set-map-lookups
// weakness: name-heuristic
// source: GitHub issue #1733
// verdict: pass

const hasCode = (messages: unknown[], code: string) =>
  messages.some((entry) => String(entry).includes(code));
