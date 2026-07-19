// rule: no-unescaped-dynamic-string-in-regexp
// weakness: alias-guard
// source: react-bench corpus audit 2026-07 (lumina prompt parser: the private helper's keyword parameter only receives metacharacter-free literals)
function parseLengthAfter(prompt: string, keyword: string) {
  const pattern = new RegExp(`${keyword}\\s+(\\d+(?:\\.\\d+)?)(mm|cm|in|pt|px|em|rem)`, "i");
  return prompt.match(pattern);
}

export function parseAiPromptToSchema(prompt: string) {
  const margin = parseLengthAfter(prompt, "margin") ?? parseLengthAfter(prompt, "margins");
  const header = parseLengthAfter(prompt, "header");
  const footer = parseLengthAfter(prompt, "footer");
  return { margin, header, footer };
}
