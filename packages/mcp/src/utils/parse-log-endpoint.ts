const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

// The debug tools fetch a model-supplied endpoint, so confine it to a loopback
// `/ingest/<id>` URL — the exact shape `debug_serve` returns — so a prompt
// injection can't turn `debug_read_logs`/`debug_clear_logs` into an SSRF
// primitive against an arbitrary host. Throws (surfaced as a tool error by
// `runTool`) on anything else.
export const parseLogEndpoint = (endpoint: string): URL => {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error(`Invalid endpoint URL: ${endpoint}`);
  }
  if (!LOOPBACK_HOSTNAMES.has(url.hostname)) {
    throw new Error(`Refusing to fetch a non-loopback endpoint: ${url.hostname}`);
  }
  if (!url.pathname.startsWith("/ingest/")) {
    throw new Error(`Not a debug log endpoint (expected /ingest/<id>): ${url.pathname}`);
  }
  return url;
};
