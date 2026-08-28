import * as fs from "node:fs";
import { isPlainObject } from "./project-info/index.js";

const stripJsoncComments = (raw: string): string => {
  let result = "";
  let cursor = 0;
  let inString = false;
  let stringQuote = "";
  while (cursor < raw.length) {
    const character = raw[cursor];
    const nextCharacter = raw[cursor + 1];
    if (inString) {
      result += character;
      if (character === "\\" && cursor + 1 < raw.length) {
        result += nextCharacter;
        cursor += 2;
        continue;
      }
      if (character === stringQuote) inString = false;
      cursor += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      inString = true;
      stringQuote = character;
      result += character;
      cursor += 1;
      continue;
    }
    if (character === "/" && nextCharacter === "/") {
      const lineEndIndex = raw.indexOf("\n", cursor);
      cursor = lineEndIndex === -1 ? raw.length : lineEndIndex;
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      const blockEndIndex = raw.indexOf("*/", cursor + 2);
      cursor = blockEndIndex === -1 ? raw.length : blockEndIndex + 2;
      continue;
    }
    result += character;
    cursor += 1;
  }
  return result;
};

const parseJsonOrJsonc = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return JSON.parse(stripJsoncComments(raw));
  }
};

export interface AdoptedLintConfigSettings {
  readonly [pluginName: string]: unknown;
}

export const readAdoptedLintConfigSettings = (
  configPaths: ReadonlyArray<string>,
): AdoptedLintConfigSettings => {
  const mergedSettings: Record<string, unknown> = {};

  for (const configPath of configPaths) {
    let parsed: unknown;
    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      parsed = parseJsonOrJsonc(raw);
    } catch {
      continue;
    }

    if (!isPlainObject(parsed)) continue;

    const settings = parsed.settings;
    if (!isPlainObject(settings)) continue;

    for (const [pluginName, pluginSettings] of Object.entries(settings)) {
      if (pluginName === "react-doctor") continue;
      mergedSettings[pluginName] = pluginSettings;
    }
  }

  return mergedSettings;
};
