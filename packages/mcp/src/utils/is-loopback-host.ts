const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

// `debug_serve` is agent-driven, so a prompt injection could ask it to bind the
// log server to a routable interface (e.g. 0.0.0.0) and expose captured runtime
// logs to the LAN. Confine the MCP bind to loopback; the CLI's `debug serve`
// keeps its `--host` flexibility for on-device debugging.
export const isLoopbackHost = (host: string): boolean =>
  LOOPBACK_HOSTS.has(host.trim().toLowerCase());
