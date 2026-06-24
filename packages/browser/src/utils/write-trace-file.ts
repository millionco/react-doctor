import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Write raw Chrome DevTools trace events to `path` in the `{ traceEvents }`
// shape the DevTools Performance panel imports, returning the absolute path.
export const writeTraceFile = async (path: string, traceEvents: unknown[]): Promise<string> => {
  const absolutePath = resolve(path);
  await writeFile(absolutePath, JSON.stringify({ traceEvents }));
  return absolutePath;
};
