import ts from "typescript";

export interface ParsedTypeScriptConfig {
  compilerOptions?: {
    outDir?: unknown;
    rootDir?: unknown;
    noEmit?: unknown;
  };
  include?: unknown;
  exclude?: unknown;
}

export const parseTypeScriptConfig = (
  configPath: string,
  source: string,
): ParsedTypeScriptConfig | undefined => {
  const parsedConfig = ts.parseConfigFileTextToJson(configPath, source);
  return parsedConfig.error ? undefined : parsedConfig.config;
};
