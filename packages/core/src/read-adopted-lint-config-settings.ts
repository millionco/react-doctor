import * as fs from "node:fs";
import { parseJSONC } from "confbox";
import { isPlainObject } from "./project-info/index.js";

export interface AdoptedLintConfigSettings {
  readonly [pluginName: string]: unknown;
}

export const readAdoptedLintConfigSettings = (
  configPaths: ReadonlyArray<string>,
): AdoptedLintConfigSettings => {
  const mergedSettings = new Map<string, unknown>();

  for (const configPath of configPaths) {
    let parsed: unknown;
    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      parsed = parseJSONC<unknown>(raw, { allowTrailingComma: true });
    } catch {
      continue;
    }

    if (!isPlainObject(parsed)) continue;

    const settings = parsed.settings;
    if (!isPlainObject(settings)) continue;

    for (const [pluginName, pluginSettings] of Object.entries(settings)) {
      if (pluginName === "react-doctor") continue;
      mergedSettings.set(pluginName, pluginSettings);
    }
  }

  return Object.fromEntries(mergedSettings);
};
