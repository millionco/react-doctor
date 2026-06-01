import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { LegacyConfigLocation } from "@react-doctor/core";
import { readObjectFile } from "./read-object-file.js";
import { serializeTsObjectLiteral } from "./serialize-ts-object-literal.js";

const MIGRATED_CONFIG_FILENAME = "doctor.config.ts";

/**
 * Renames a pre-migration `react-doctor.config.json` to a typed
 * `doctor.config.ts`, preserving the user's settings as the default export.
 * `$schema` is dropped — the `ReactDoctorConfig` type supersedes it for
 * editor autocomplete. Returns the new file's absolute path, or `null` when
 * the legacy file can't be parsed as an object (left untouched so the user
 * can resolve it by hand).
 */
export const migrateLegacyConfig = (legacy: LegacyConfigLocation): string | null => {
  const parsed = readObjectFile(legacy.legacyFilePath);
  if (!parsed) return null;

  const config = { ...parsed };
  delete config.$schema;

  const targetPath = path.join(legacy.directory, MIGRATED_CONFIG_FILENAME);
  const contents = `import type { ReactDoctorConfig } from "react-doctor/api";

export default ${serializeTsObjectLiteral(config)} satisfies ReactDoctorConfig;
`;
  writeFileSync(targetPath, contents);
  rmSync(legacy.legacyFilePath, { force: true });
  return targetPath;
};
