import { AsyncLocalStorage } from "node:async_hooks";
import type { ResourceHost } from "./resource-host.js";

const resourceHostStorage = new AsyncLocalStorage<ResourceHost>();

export const getCurrentResourceHost = (): ResourceHost | null =>
  resourceHostStorage.getStore() ?? null;

export const readCurrentResourceSource = (filename: string): string | null | undefined =>
  resourceHostStorage.getStore()?.readSource(filename);

export const runWithResourceHost = <Result>(
  resourceHost: ResourceHost,
  operation: () => Result,
): Result => resourceHostStorage.run(resourceHost, operation);
