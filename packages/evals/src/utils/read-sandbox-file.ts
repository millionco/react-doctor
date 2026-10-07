import type { Sandbox } from "@vercel/sandbox";

import { MILLISECONDS_PER_SECOND } from "../constants.js";

export const readSandboxFile = async (
  sandbox: Sandbox,
  path: string,
  timeoutSeconds: number,
): Promise<Buffer> => {
  const contents = await sandbox.readFileToBuffer(
    { path },
    { signal: AbortSignal.timeout(timeoutSeconds * MILLISECONDS_PER_SECOND) },
  );
  if (contents === null) throw new Error(`Sandbox file is missing: ${path}`);
  return contents;
};
