import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseJSON5 } from "confbox";
import { isPlainObject } from "@react-doctor/core";
import type { LegacyConfigLocation } from "@react-doctor/core";

const MIGRATED_CONFIG_FILENAME = "doctor.config.ts";
const CONFIG_INDENT_SPACES = 2;

/**
 * Renames a pre-migration `react-doctor.config.json` to a typed
 * `doctor.config.ts`, preserving the user's settings as the default export.
 * `$schema` is dropped — the `ReactDoctorConfig` type supersedes it for
 * editor autocomplete. Returns the new file's absolute path, or `null` when
 * the legacy file can't be parsed as an object (left untouched so the user
 * can resolve it by hand).
 */
export const migrateLegacyConfig = (legacy: LegacyConfigLocation): string | null => {
  let parsed: unknown;
  try {
    parsed = parseJSON5(readFileSync(legacy.legacyFilePath, "utf-8"));
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;

  const config = { ...parsed };
  delete config.$schema;

  const targetPath = path.join(legacy.directory, MIGRATED_CONFIG_FILENAME);
  const serialized = JSON.stringify(config, null, CONFIG_INDENT_SPACES);
  const contents = `import type { ReactDoctorConfig } from "react-doctor/api";

export default ${serialized} satisfies ReactDoctorConfig;
`;
  writeFileSync(targetPath, contents);
  rmSync(legacy.legacyFilePath, { force: true });
  return targetPath;
};
