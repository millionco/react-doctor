import type { Jiti } from "jiti";

export const importDefaultExport = async (
  jitiInstance: Jiti,
  filePath: string,
): Promise<unknown> => {
  const imported = await jitiInstance.import<{ default?: unknown }>(filePath);
  return imported?.default ?? imported;
};
