const UTF8_BOM_CHARACTER = "\uFEFF";

export const stripUtf8Bom = (content: string): string =>
  content.startsWith(UTF8_BOM_CHARACTER) ? content.slice(UTF8_BOM_CHARACTER.length) : content;
