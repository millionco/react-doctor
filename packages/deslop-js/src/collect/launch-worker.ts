import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";

/**
 * Launches a worker module that sits next to `fromModuleUrl`: the TypeScript
 * source (via tsx) when the caller itself runs from source — tests and direct
 * `tsx` execution — and the built `.mjs` sibling when running from dist.
 */
export const launchSiblingWorker = (fromModuleUrl: string, workerBaseName: string): Worker => {
  const isTypeScriptSource = fromModuleUrl.endsWith(".ts");
  const workerPath = fileURLToPath(
    new URL(
      isTypeScriptSource ? `./${workerBaseName}.ts` : `./${workerBaseName}.mjs`,
      fromModuleUrl,
    ),
  );
  return new Worker(workerPath, {
    ...(isTypeScriptSource ? { execArgv: ["--import", "tsx"] } : {}),
  });
};
