// Neutralizes untrusted, remote text before it is woven into a diagnostic's
// `message`/`help`, which the CLI prints to the terminal without stripping
// escape sequences. Socket alert strings (`type`, `file`, `note`) describe a
// potentially malicious package and are attacker-controlled, so a crafted
// filename or note could otherwise inject ANSI/OSC terminal escapes (spoofing
// or hiding the very warning) or break the diagnostic's `code` / "quote"
// framing. Drops C0/C1 control characters (including ESC, which drives those
// escape sequences) and replaces backticks with a straight quote.
const isControlCharacter = (codePoint: number): boolean =>
  codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);

export const sanitizeTerminalText = (value: string): string => {
  let sanitized = "";
  for (const character of value) {
    if (isControlCharacter(character.codePointAt(0) ?? 0)) continue;
    sanitized += character === "`" ? "'" : character;
  }
  return sanitized;
};
