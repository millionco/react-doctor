import * as fs from "node:fs";
import * as path from "node:path";
import { isFile } from "./utils/is-file.js";

const TSCONFIG_FILENAMES = ["tsconfig.json", "tsconfig.base.json"];

const ES_TARGET_YEAR: Record<string, number> = {
  es3: 1999,
  es5: 2009,
  es6: 2015,
  es2015: 2015,
  es2016: 2016,
  es2017: 2017,
  es2018: 2018,
  es2019: 2019,
  es2020: 2020,
  es2021: 2021,
  es2022: 2022,
  es2023: 2023,
  es2024: 2024,
  es2025: 2025,
  esnext: 9999,
};

const ES2023_YEAR = 2023;

const ES2023_LIB_ENTRIES = new Set([
  "es2023",
  "es2023.array",
  "es2023.collection",
  "es2023.intl",
  "es2024",
  "es2024.arraybuffer",
  "es2024.collection",
  "es2024.object",
  "es2024.promise",
  "es2024.regexp",
  "es2024.sharedmemory",
  "es2024.string",
  "es2025",
  "esnext",
  "esnext.array",
  "esnext.collection",
  "esnext.intl",
]);

interface TsConfigShape {
  compilerOptions?: {
    target?: string;
    lib?: string[];
  };
}

const readTsConfig = (filePath: string): TsConfigShape | null => {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
};

const targetYearIsPreES2023 = (target: string): boolean => {
  const year = ES_TARGET_YEAR[target.toLowerCase()];
  return year !== undefined && year < ES2023_YEAR;
};

const libIncludesES2023 = (lib: ReadonlyArray<string>): boolean =>
  lib.some((entry) => ES2023_LIB_ENTRIES.has(entry.toLowerCase()));

export const detectPreES2023Target = (directory: string): boolean => {
  for (const filename of TSCONFIG_FILENAMES) {
    const tsConfigPath = path.join(directory, filename);
    if (!isFile(tsConfigPath)) continue;

    const tsConfig = readTsConfig(tsConfigPath);
    if (!tsConfig?.compilerOptions) continue;

    const { target, lib } = tsConfig.compilerOptions;

    if (lib && lib.length > 0) {
      return !libIncludesES2023(lib);
    }

    if (target) {
      return targetYearIsPreES2023(target);
    }
  }

  return false;
};
