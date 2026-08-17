import * as http from "node:http";
import {
  RUNTIME_SCAN_LOCAL_DEV_PORTS,
  RUNTIME_SCAN_LOCAL_SERVER_PROBE_TIMEOUT_MS,
} from "./constants.js";

export interface RuntimeScanLocalUrlSuggestion {
  readonly port: number;
  readonly url: string;
}

const probeLocalHttpPort = (port: number): Promise<RuntimeScanLocalUrlSuggestion | null> =>
  new Promise((resolve) => {
    let didResolve = false;
    const resolveOnce = (suggestion: RuntimeScanLocalUrlSuggestion | null): void => {
      if (didResolve) return;
      didResolve = true;
      resolve(suggestion);
    };
    const request = http.request(
      {
        agent: false,
        host: "127.0.0.1",
        method: "HEAD",
        path: "/",
        port,
      },
      (response) => {
        response.resume();
        resolveOnce({
          port,
          url: `http://localhost:${port}`,
        });
      },
    );
    request.setTimeout(RUNTIME_SCAN_LOCAL_SERVER_PROBE_TIMEOUT_MS, () => request.destroy());
    request.on("error", () => resolveOnce(null));
    request.on("close", () => resolveOnce(null));
    request.end();
  });

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
