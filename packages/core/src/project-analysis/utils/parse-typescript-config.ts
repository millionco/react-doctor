import ts from "typescript";

export interface ParsedTypeScriptConfig {
  extends?: unknown;
  files?: unknown;
  compilerOptions?: {
    outDir?: unknown;
    rootDir?: unknown;
    noEmit?: unknown;
    paths?: unknown;
    baseUrl?: unknown;
    jsxImportSource?: unknown;
    types?: unknown;
    plugins?: unknown;
    rootDirs?: unknown;
    typeRoots?: unknown;
  };
  include?: unknown;
  exclude?: unknown;
  references?: unknown;
}

export const parseTypeScriptConfig = (
  configPath: string,
  source: string,
): ParsedTypeScriptConfig | undefined => {
  const parsedConfig = ts.parseConfigFileTextToJson(configPath, source);
  return parsedConfig.error ? undefined : parsedConfig.config;
};
