const ANSI_ESCAPE_SEQUENCE = String.raw`\u001B\[[0-9;]*m`;
const ANSI_ESCAPE_PATTERN = new RegExp(ANSI_ESCAPE_SEQUENCE, "g");

export const stripAnsi = (text: string): string => text.replace(ANSI_ESCAPE_PATTERN, "");
