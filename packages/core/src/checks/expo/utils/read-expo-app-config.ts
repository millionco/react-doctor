import * as fs from "node:fs";
import * as path from "node:path";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { isFile } from "../../../project-info/index.js";

// A dynamic `app.config.{js,ts,cjs,mjs}` is Expo's source of truth when present:
// Expo reads the static config, passes it into the dynamic file, and uses that
// file's RETURN value — so it can override any value in `app.json` (a stale
// `newArchEnabled: false` / `disableAntiBrickingMeasures: true` there may be
// flipped at build time). We can't evaluate it offline, so when one exists we
// report no config (a documented false-negative, never a false positive).
const APP_CONFIG_JSON_FILES = ["app.config.json", "app.json"] as const;
const APP_CONFIG_DYNAMIC_FILES = [
  "app.config.ts",
  "app.config.js",
  "app.config.cjs",
  "app.config.mjs",
] as const;

// Only the fields the Expo checks read. `Schema.Struct` ignores unknown keys,
// so the rest of the (large) app config passes through harmlessly; `app.json` /
// `app.config.json` nest everything under an `expo` key.
const ExpoConfigSchema = Schema.Struct({
  newArchEnabled: Schema.optional(Schema.Boolean),
  updates: Schema.optional(
    Schema.Struct({ disableAntiBrickingMeasures: Schema.optional(Schema.Boolean) }),
  ),
});
const AppManifestSchema = Schema.Struct({ expo: Schema.optional(ExpoConfigSchema) });

export type ExpoConfig = Schema.Schema.Type<typeof ExpoConfigSchema>;

export interface ExpoAppConfig {
  readonly config: ExpoConfig | null;
  readonly configFile: string | null;
}

const NO_CONFIG: ExpoAppConfig = { config: null, configFile: null };

const decodeExpoConfig = (filePath: string): ExpoConfig | null => {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
  return Option.getOrNull(Schema.decodeUnknownOption(AppManifestSchema)(raw))?.expo ?? null;
};

export const readExpoAppConfig = (rootDirectory: string): ExpoAppConfig => {
  if (APP_CONFIG_DYNAMIC_FILES.some((fileName) => isFile(path.join(rootDirectory, fileName)))) {
    return NO_CONFIG;
  }
  for (const fileName of APP_CONFIG_JSON_FILES) {
    const filePath = path.join(rootDirectory, fileName);
    if (!isFile(filePath)) continue;
    const config = decodeExpoConfig(filePath);
    if (config) return { config, configFile: fileName };
  }
  return NO_CONFIG;
};
