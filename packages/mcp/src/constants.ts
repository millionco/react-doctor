export const MCP_SERVER_NAME = "react-doctor";

// Loopback CDP endpoint the browser tools attach to by default, surfaced in
// tool descriptions so an agent knows what the `cdp` argument overrides.
export const DEFAULT_CDP_ENDPOINT_HINT = "http://127.0.0.1:9222";

// Cap on diagnostics returned inline by `doctor_scan` so a large codebase's
// scan stays a readable tool result rather than a multi-megabyte dump; the
// summary still reports the full counts and a `truncated` flag.
export const MAX_INLINE_DIAGNOSTICS = 100;

// Upper bound on an emulated viewport dimension, so a typo can't push an
// absurd device-metrics override into CDP (mirrors the CLI's --viewport guard).
export const MAX_VIEWPORT_PX = 10_000;
