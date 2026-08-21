import * as http from "node:http";
import {
  RUNTIME_SCAN_LOCAL_DEV_PORTS,
  RUNTIME_SCAN_LOCAL_SERVER_PROBE_TIMEOUT_MS,
} from "./constants.js";

export interface RuntimeScanLocalUrlSuggestion {
  readonly port: number;
  readonly url: string;
}

const LOCAL_HTTP_HOSTS: ReadonlyArray<string> = ["127.0.0.1", "::1"];

const probeLocalHttpHost = (port: number, host: string): Promise<boolean> =>
  new Promise((resolve) => {
    let didResolve = false;
    const resolveOnce = (isReachable: boolean): void => {
      if (didResolve) return;
      didResolve = true;
      resolve(isReachable);
    };
    const request = http.request(
      {
        agent: false,
        host,
        method: "HEAD",
        path: "/",
        port,
      },
      (response) => {
        response.resume();
        resolveOnce(true);
      },
    );
    request.setTimeout(RUNTIME_SCAN_LOCAL_SERVER_PROBE_TIMEOUT_MS, () => request.destroy());
    request.on("error", () => resolveOnce(false));
    request.on("close", () => resolveOnce(false));
    request.end();
  });

const probeLocalHttpPort = async (port: number): Promise<RuntimeScanLocalUrlSuggestion | null> => {
  const reachableHosts = await Promise.all(
    LOCAL_HTTP_HOSTS.map((host) => probeLocalHttpHost(port, host)),
  );
  if (!reachableHosts.some(Boolean)) return null;
  return {
    port,
    url: `http://localhost:${port}`,
  };
};

export const detectLocalRuntimeUrls = async (
  ports: ReadonlyArray<number> = RUNTIME_SCAN_LOCAL_DEV_PORTS,
): Promise<ReadonlyArray<RuntimeScanLocalUrlSuggestion>> => {
  const probeResults = await Promise.all(ports.map(probeLocalHttpPort));
  const suggestions: RuntimeScanLocalUrlSuggestion[] = [];
  for (const probeResult of probeResults) {
    if (probeResult !== null) suggestions.push(probeResult);
  }
  return suggestions;
};
