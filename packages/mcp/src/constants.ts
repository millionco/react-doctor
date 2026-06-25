export const MCP_SERVER_NAME = "react-doctor";

// Loopback CDP endpoint the browser tools attach to by default, surfaced in
// tool descriptions so an agent knows what the `cdp` argument overrides.
export const DEFAULT_CDP_ENDPOINT_HINT = "http://127.0.0.1:9222";

// Cap on diagnostics returned inline by `doctor_scan` so a large codebase's
// scan stays a readable tool result rather than a multi-megabyte dump; the
// summary still reports the full counts and a `truncated` flag.
export const MAX_INLINE_DIAGNOSTICS = 100;

// Cap on the debug tools' HTTP calls to the local log server, so a hung or
// unresponsive endpoint can't block the MCP tool turn indefinitely.
export const DEBUG_FETCH_TIMEOUT_MS = 5000;
